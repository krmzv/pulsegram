package probe_test

import (
	"context"
	"testing"
	"time"

	"github.com/krmzv/pulsegram/probe/internal/probe"
)

func TestAssertSafeURL_blocked(t *testing.T) {
	blocked := []string{
		// embedded credentials
		"http://user:pass@example.com/",
		// wrong scheme
		"ftp://example.com/",
		"file:///etc/passwd",
	}

	for _, u := range blocked {
		if err := probe.AssertSafeURL(u, false); err == nil {
			t.Errorf("AssertSafeURL(%q) expected error, got nil", u)
		}
	}
}

func TestAssertSafeURL_invalid(t *testing.T) {
	invalid := []string{
		"not-a-url",
		"://missing-scheme",
		"",
	}
	for _, u := range invalid {
		if err := probe.AssertSafeURL(u, false); err == nil {
			t.Errorf("AssertSafeURL(%q) expected error, got nil", u)
		}
	}
}

func TestSafeDialContext_blocked(t *testing.T) {
	dial := probe.SafeDialContext(false)
	blocked := []string{
		"127.0.0.1:80",
		"[::1]:80",
		"10.0.0.1:80",
		"172.16.0.1:80",
		"192.168.1.1:80",
		"169.254.169.254:80",
		"100.64.0.1:80",
		"[fc00::1]:80",
		"[fe80::1]:80",
	}

	for _, addr := range blocked {
		conn, err := dial(context.Background(), "tcp", addr)
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Errorf("SafeDialContext(%q) expected error, got nil", addr)
		}
	}
}

func TestSafeDialContext_allowPrivate(t *testing.T) {
	dial := probe.SafeDialContext(true)
	// These should not be SSRF-blocked when allowPrivate=true.
	// Use a short context deadline since we can't actually connect.
	cases := []string{
		"127.0.0.1:19999",
	}
	for _, addr := range cases {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		_, err := dial(ctx, "tcp", addr)
		cancel()
		if err == nil {
			t.Errorf("SafeDialContext(%q, allowPrivate) expected connection error, got nil", addr)
			continue
		}
		if _, ok := err.(*probe.SSRFError); ok {
			t.Errorf("SafeDialContext(%q, allowPrivate) should not return SSRFError, got: %v", addr, err)
		}
	}
}

func TestIsBlockedIP(t *testing.T) {
	cases := []struct {
		ip      string
		blocked bool
	}{
		{"127.0.0.1", true},
		{"10.10.10.10", true},
		{"172.16.5.5", true},
		{"172.32.0.1", false}, // outside 172.16/12
		{"192.168.0.1", true},
		{"192.167.0.1", false}, // outside 192.168/16
		{"169.254.169.254", true},
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"::1", true},
		{"fc00::1", true},
		{"fe80::1", true},
		{"2001:db8::1", true},
		{"2606:4700::1", false}, // Cloudflare public
	}

	for _, c := range cases {
		got := probe.IsBlockedIPStr(c.ip)
		if got != c.blocked {
			t.Errorf("IsBlockedIP(%q) = %v, want %v", c.ip, got, c.blocked)
		}
	}
}
