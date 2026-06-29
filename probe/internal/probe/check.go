package probe

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	maxBodyBytes = 256 * 1024
	maxRedirects = 3
	userAgent    = "Pulsegram/1.0 (+https://github.com/krmzv/pulsegram)"
)

type CheckResult struct {
	Status     string // "up" | "down"
	StatusCode *int
	ResponseMs int64
	Message    *string
}

func CheckURL(rawURL string, timeoutMs int, allowPrivate bool, method string) CheckResult {
	start := time.Now()
	ms := func() int64 { return time.Since(start).Milliseconds() }

	if method == "" {
		method = "GET"
	}

	client := &http.Client{
		Timeout: time.Duration(timeoutMs) * time.Millisecond,
		Transport: &http.Transport{
			DialContext: SafeDialContext(allowPrivate),
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	current := rawURL

	for hop := 0; hop <= maxRedirects; hop++ {
		if err := AssertSafeURL(current, allowPrivate); err != nil {
			return downResult(nil, ms(), err.Error())
		}

		req, err := http.NewRequest(method, current, nil)
		if err != nil {
			return downResult(nil, ms(), "invalid URL")
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "*/*")

		resp, err := client.Do(req)
		if err != nil {
			return downResult(nil, ms(), describeError(err))
		}
		drainCapped(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			loc := resp.Header.Get("Location")
			if loc == "" {
				code := resp.StatusCode
				return downResult(&code, ms(), fmt.Sprintf("HTTP %d", code))
			}
			if hop == maxRedirects {
				code := resp.StatusCode
				return downResult(&code, ms(), "too many redirects")
			}
			base, _ := url.Parse(current)
			redirect, err := base.Parse(loc)
			if err != nil {
				return downResult(nil, ms(), "invalid redirect URL")
			}
			current = redirect.String()
			continue
		}

		code := resp.StatusCode
		elapsed := ms()
		if code >= 200 && code < 400 {
			return CheckResult{Status: "up", StatusCode: &code, ResponseMs: elapsed}
		}
		msg := fmt.Sprintf("HTTP %d", code)
		return downResult(&code, elapsed, msg)
	}

	return downResult(nil, ms(), "too many redirects")
}

func downResult(code *int, ms int64, msg string) CheckResult {
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return CheckResult{Status: "down", StatusCode: code, ResponseMs: ms, Message: &msg}
}

func drainCapped(body io.ReadCloser) {
	if body == nil {
		return
	}
	io.Copy(io.Discard, &io.LimitedReader{R: body, N: maxBodyBytes})
}

func describeError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded"):
		return "connection timeout"
	case strings.Contains(msg, "no such host") || strings.Contains(msg, "lookup"):
		return "DNS lookup failed"
	case strings.Contains(msg, "connection refused"):
		return "connection refused"
	case strings.Contains(msg, "certificate") || strings.Contains(msg, "tls") || strings.Contains(msg, "TLS"):
		return "TLS/certificate error"
	case strings.Contains(msg, "private or reserved"):
		return "target resolves to a private or reserved address"
	default:
		return msg
	}
}
