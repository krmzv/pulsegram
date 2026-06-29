package probe

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"time"
)

// Blocked IPv4 CIDRs — mirrors BLOCKED_IPV4_CIDRS in packages/shared/src/constants.ts
var blockedV4 = mustParseCIDRs([]string{
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"255.255.255.255/32",
})

// Blocked IPv6 CIDRs — mirrors BLOCKED_IPV6_CIDRS in packages/shared/src/constants.ts
var blockedV6 = mustParseCIDRs([]string{
	"::1/128",
	"::/128",
	"fc00::/7",
	"fe80::/10",
	"ff00::/8",
	"2001:db8::/32",
	"64:ff9b::/96",
	"100::/64",
})

func mustParseCIDRs(cidrs []string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, ipNet, err := net.ParseCIDR(c)
		if err != nil {
			panic("invalid CIDR: " + c)
		}
		out = append(out, ipNet)
	}
	return out
}

type SSRFError struct{ msg string }

func (e *SSRFError) Error() string { return e.msg }

func ssrfErr(msg string) error { return &SSRFError{msg} }

// IsBlockedIPStr is the exported version for testing.
func IsBlockedIPStr(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return true
	}
	return isBlockedIP(ip)
}

func isBlockedIP(ip net.IP) bool {
	// Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d) before checking.
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.To4() != nil {
		for _, n := range blockedV4 {
			if n.Contains(ip) {
				return true
			}
		}
		return false
	}
	for _, n := range blockedV6 {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// AssertSafeURL validates a URL's scheme and credentials only.
// IP-level SSRF checks happen in SafeDialContext at connection time
// to eliminate the TOCTOU gap between DNS resolution and connection.
func AssertSafeURL(rawURL string, allowPrivate bool) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ssrfErr("invalid URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ssrfErr(fmt.Sprintf("unsupported protocol: %s", u.Scheme))
	}
	if u.User != nil {
		return ssrfErr("URLs with embedded credentials are not allowed")
	}
	return nil
}

// SafeDialContext returns a DialContext that resolves DNS and checks IPs
// at connection time, preventing DNS rebinding attacks.
func SafeDialContext(allowPrivate bool) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("invalid address: %s", addr)
		}

		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(ips) == 0 {
			return nil, &SSRFError{msg: "could not resolve host: " + host}
		}

		if !allowPrivate {
			for _, ip := range ips {
				if isBlockedIP(ip.IP) {
					return nil, &SSRFError{msg: "target resolves to a private or reserved address"}
				}
			}
		}

		target := net.JoinHostPort(ips[0].IP.String(), port)
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, target)
	}
}
