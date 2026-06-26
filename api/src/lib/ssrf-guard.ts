import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BLOCKED_IPV4_CIDRS, BLOCKED_IPV6_CIDRS } from "@pulsegram/shared";

/**
 * SSRF protection. The whole product fetches user-supplied URLs on a schedule,
 * so a monitor pointed at `http://169.254.169.254/` (cloud metadata) or an
 * internal host would be a credential-exfiltration / internal-scan vector.
 *
 * This guard:
 *   - allows only http/https
 *   - resolves the hostname to its IP addresses
 *   - rejects any address in a private/reserved/link-local range (v4 + v6)
 *   - is re-run on every check and on every redirect hop (no TOCTOU gap)
 *
 * Set ALLOW_PRIVATE_TARGETS=true only on a trusted network where monitoring
 * internal addresses is the explicit intent.
 */

export class SsrfError extends Error {
  override readonly name = "SsrfError";
}

interface Ipv4 {
  type: "v4";
  bytes: [number, number, number, number];
}
interface Ipv6 {
  type: "v6";
  // 8 16-bit groups
  groups: number[];
}

function parseIpv4(ip: string): Ipv4 | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    bytes.push(n);
  }
  return { type: "v4", bytes: bytes as [number, number, number, number] };
}

function parseIpv6(ip: string): Ipv6 | null {
  // strip zone id (e.g. fe80::1%eth0)
  const addr = ip.split("%")[0] ?? ip;
  const hasDouble = addr.includes("::");
  const [headRaw, tailRaw = ""] = hasDouble ? addr.split("::") : [addr, undefined];
  const head = headRaw ? headRaw.split(":") : [];
  const tail = tailRaw ? tailRaw.split(":") : [];

  const expand = (segs: string[]): number[] | null => {
    const out: number[] = [];
    for (const s of segs) {
      if (s === "") continue;
      // embedded IPv4 (e.g. ::ffff:1.2.3.4)
      if (s.includes(".")) {
        const v4 = parseIpv4(s);
        if (!v4) return null;
        out.push((v4.bytes[0] << 8) | v4.bytes[1], (v4.bytes[2] << 8) | v4.bytes[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(s)) return null;
      out.push(parseInt(s, 16));
    }
    return out;
  };

  const headGroups = expand(head);
  const tailGroups = expand(tail);
  if (headGroups === null || tailGroups === null) return null;

  let groups: number[];
  if (hasDouble) {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...headGroups, ...Array(missing).fill(0), ...tailGroups];
  } else {
    groups = headGroups;
  }
  if (groups.length !== 8) return null;
  return { type: "v6", groups };
}

/** If a v6 address is IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible, return the v4. */
function unwrapMappedV4(v6: Ipv6): Ipv4 | null {
  const g = v6.groups;
  const firstSixZero = g.slice(0, 5).every((x) => x === 0);
  if (firstSixZero && (g[5] === 0xffff || g[5] === 0)) {
    const a = (g[6]! >> 8) & 0xff;
    const b = g[6]! & 0xff;
    const c = (g[7]! >> 8) & 0xff;
    const d = g[7]! & 0xff;
    // ignore ::/96 all-zero (unspecified handled elsewhere)
    if (g[5] === 0 && a === 0 && b === 0 && c === 0 && d === 0) return null;
    return { type: "v4", bytes: [a, b, c, d] };
  }
  return null;
}

function v4InCidr(ip: Ipv4, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const baseParsed = parseIpv4(base!);
  if (!baseParsed) return false;
  const prefix = Number(prefixStr);
  const toInt = (b: number[]) => ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (toInt(ip.bytes) & mask) === (toInt(baseParsed.bytes) & mask);
}

function v6InCidr(ip: Ipv6, cidr: string): boolean {
  const [base, prefixStr] = cidr.split("/");
  const baseParsed = parseIpv6(base!);
  if (!baseParsed) return false;
  let prefix = Number(prefixStr);
  for (let i = 0; i < 8; i++) {
    const bits = Math.min(16, Math.max(0, prefix - i * 16));
    if (bits === 0) break;
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((ip.groups[i]! & mask) !== (baseParsed.groups[i]! & mask)) return false;
  }
  return true;
}

/** True if the resolved IP literal is private/reserved and must be blocked. */
export function isBlockedIp(ipLiteral: string): boolean {
  const fam = isIP(ipLiteral);
  if (fam === 4) {
    const v4 = parseIpv4(ipLiteral);
    return v4 ? BLOCKED_IPV4_CIDRS.some((c) => v4InCidr(v4, c)) : true;
  }
  if (fam === 6) {
    const v6 = parseIpv6(ipLiteral);
    if (!v6) return true;
    const mapped = unwrapMappedV4(v6);
    if (mapped) return BLOCKED_IPV4_CIDRS.some((c) => v4InCidr(mapped, c));
    return BLOCKED_IPV6_CIDRS.some((c) => v6InCidr(v6, c));
  }
  return true; // not a valid IP literal → block
}

export interface SafeTarget {
  url: URL;
  /** resolved address we validated (and should connect to) */
  address: string;
  family: 4 | 6;
}

/**
 * Validate a URL is safe to fetch. Throws SsrfError on any violation.
 * Resolves DNS and checks every returned address.
 */
export async function assertSafeUrl(rawUrl: string, allowPrivate = false): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Invalid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfError("URLs with embedded credentials are not allowed.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (allowPrivate) {
    // Still resolve so we have an address to report, but skip the block check.
    if (isIP(host)) return { url, address: host, family: isIP(host) as 4 | 6 };
    const res = await lookup(host, { all: true });
    const first = res[0];
    if (!first) throw new SsrfError(`Could not resolve host: ${host}`);
    return { url, address: first.address, family: first.family as 4 | 6 };
  }

  // Literal IP in the URL — check directly, no DNS.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError("Target resolves to a private or reserved address.");
    return { url, address: host, family: isIP(host) as 4 | 6 };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SsrfError(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0) throw new SsrfError(`Could not resolve host: ${host}`);

  // Block if ANY resolved address is private (defends against split-horizon /
  // rebinding tricks where one record is public and another internal).
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new SsrfError("Target resolves to a private or reserved address.");
    }
  }
  const first = addresses[0]!;
  return { url, address: first.address, family: first.family as 4 | 6 };
}
