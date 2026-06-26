import { describe, expect, test } from "bun:test";
import { assertSafeUrl, isBlockedIp, SsrfError } from "./ssrf-guard";

describe("isBlockedIp", () => {
  const blocked = [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "::1", // ipv6 loopback
    "fe80::1", // ipv6 link-local
    "fc00::1", // ipv6 ULA
    "::ffff:127.0.0.1", // ipv4-mapped loopback
    "::ffff:169.254.169.254", // ipv4-mapped metadata
  ];
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  for (const ip of allowed) {
    test(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
});

describe("assertSafeUrl", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl("ftp://example.com")).rejects.toBeInstanceOf(SsrfError);
  });

  test("rejects embedded credentials", async () => {
    await expect(assertSafeUrl("http://user:pass@example.com")).rejects.toBeInstanceOf(SsrfError);
  });

  test("rejects literal private IPs without DNS", async () => {
    await expect(assertSafeUrl("http://127.0.0.1")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl("http://[::1]:8080")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl("http://10.0.0.5")).rejects.toBeInstanceOf(SsrfError);
  });

  test("rejects hostnames that resolve to localhost", async () => {
    // localhost resolves to 127.0.0.1 / ::1
    await expect(assertSafeUrl("http://localhost")).rejects.toBeInstanceOf(SsrfError);
  });

  test("allows a literal public IP", async () => {
    const target = await assertSafeUrl("https://1.1.1.1");
    expect(target.address).toBe("1.1.1.1");
  });

  test("allowPrivate=true bypasses the block", async () => {
    const target = await assertSafeUrl("http://127.0.0.1:3000", true);
    expect(target.address).toBe("127.0.0.1");
  });
});
