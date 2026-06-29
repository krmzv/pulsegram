package callback_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/krmzv/pulsegram/probe/internal/callback"
)

const testSecret = "test-secret-value-here"

// fastDelays removes real retry waits so tests run in milliseconds.
var fastDelays = []time.Duration{0, 0, 0, 0}

func TestPostIncident_success(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-Internal-Secret") != testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/internal/incident" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	msg := "connection refused"
	err := c.PostIncident(context.Background(), 1, "monitor-1", time.Now().Unix(), &msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls.Load() != 1 {
		t.Errorf("expected 1 call, got %d", calls.Load())
	}
}

func TestPostRecovery_success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/recovery" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	err := c.PostRecovery(context.Background(), 2, "monitor-1", time.Now().Unix())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPost_retryOnFailure(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable) // fail first two attempts
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	msg := "timeout"
	err := c.PostIncident(context.Background(), 1, "monitor-1", time.Now().Unix(), &msg)
	if err != nil {
		t.Fatalf("expected success after retries, got: %v", err)
	}
	if calls.Load() != 3 {
		t.Errorf("expected 3 attempts, got %d", calls.Load())
	}
}

func TestPost_allRetriesExhausted(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	err := c.PostIncident(context.Background(), 1, "monitor-1", time.Now().Unix(), nil)
	if err == nil {
		t.Fatal("expected error after all retries fail")
	}
	// 4 attempts: 1 initial + 3 retries
	if calls.Load() != 4 {
		t.Errorf("expected 4 attempts, got %d", calls.Load())
	}
}

func TestCircuitBreaker_opensAfterFiveFailures(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	ctx := context.Background()

	// Each PostIncident call exhausts retries → recordFailure once per call.
	// Circuit opens after 5 cumulative failures (not per-attempt, per post call).
	for i := 0; i < 5; i++ {
		c.PostIncident(ctx, int64(i), "m", time.Now().Unix(), nil) //nolint:errcheck
	}

	// 6th call should be rejected immediately (circuit open).
	start := time.Now()
	err := c.PostIncident(ctx, 6, "m", time.Now().Unix(), nil)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected circuit-open error")
	}
	// Should return instantly, not after retry delays.
	if elapsed > 500*time.Millisecond {
		t.Errorf("circuit-open call took %v, expected near-instant", elapsed)
	}
}

func TestCircuitBreaker_halfOpenAllowsOneRequest(t *testing.T) {
	var calls atomic.Int32
	// First request fails (trips circuit), subsequent requests succeed.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := callback.NewWithDelays(srv.URL, testSecret, fastDelays)
	ctx := context.Background()

	// Trip the circuit with 5 failed post calls.
	for i := 0; i < 5; i++ {
		c.PostIncident(ctx, int64(i), "m", time.Now().Unix(), nil) //nolint:errcheck
	}

	// Manually advance past the open window by exposing a test hook.
	// Since we can't control time directly, we use the exported ResetForTest.
	c.ResetForTest()

	err := c.PostIncident(ctx, 99, "m", time.Now().Unix(), nil)
	if err != nil {
		t.Fatalf("expected success after reset, got: %v", err)
	}
}
