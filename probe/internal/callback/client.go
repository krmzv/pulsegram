package callback

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type circuitState int

const (
	stateClosed   circuitState = iota
	stateOpen                  // stop sending, wait openUntil
	stateHalfOpen              // test with one request
)

// Client posts state-change events to the api with retry and circuit breaking.
type Client struct {
	apiURL string
	secret string
	http   *http.Client
	delays []time.Duration // retry delays; overridable in tests

	mu        sync.Mutex
	state     circuitState
	failures  int
	openUntil time.Time
}

var defaultDelays = []time.Duration{0, time.Second, 2 * time.Second, 4 * time.Second}

func New(apiURL, secret string) *Client {
	return &Client{
		apiURL: apiURL,
		secret: secret,
		http:   &http.Client{Timeout: 5 * time.Second},
		delays: defaultDelays,
	}
}

// NewWithDelays creates a client with custom retry delays. For use in tests.
func NewWithDelays(apiURL, secret string, delays []time.Duration) *Client {
	c := New(apiURL, secret)
	c.delays = delays
	return c
}

type IncidentBody struct {
	EventID   int64   `json:"event_id"`
	MonitorID string  `json:"monitor_id"`
	CheckedAt int64   `json:"checked_at"`
	Error     *string `json:"error"`
}

type RecoveryBody struct {
	EventID     int64  `json:"event_id"`
	MonitorID   string `json:"monitor_id"`
	RecoveredAt int64  `json:"recovered_at"`
}

func (c *Client) PostIncident(ctx context.Context, eventID int64, monitorID string, checkedAt int64, errMsg *string) error {
	return c.post(ctx, "/internal/incident", IncidentBody{
		EventID:   eventID,
		MonitorID: monitorID,
		CheckedAt: checkedAt,
		Error:     errMsg,
	})
}

func (c *Client) PostRecovery(ctx context.Context, eventID int64, monitorID string, recoveredAt int64) error {
	return c.post(ctx, "/internal/recovery", RecoveryBody{
		EventID:     eventID,
		MonitorID:   monitorID,
		RecoveredAt: recoveredAt,
	})
}

// post sends with exponential backoff (1s, 2s, 4s) and a circuit breaker.
// After 5 consecutive failures the circuit opens for 30s.
func (c *Client) post(ctx context.Context, path string, body any) error {
	if !c.allow() {
		return fmt.Errorf("circuit open")
	}

	var lastErr error

	for _, delay := range c.delays {
		if delay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}

		if err := c.doPost(ctx, path, body); err != nil {
			lastErr = err
			continue
		}

		c.recordSuccess()
		return nil
	}

	c.recordFailure()
	return lastErr
}

func (c *Client) doPost(ctx context.Context, path string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", c.secret)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("api returned %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) allow() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case stateOpen:
		if time.Now().After(c.openUntil) {
			c.state = stateHalfOpen
			return true
		}
		return false
	default:
		return true
	}
}

func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = stateClosed
	c.failures = 0
}

// ResetForTest resets the circuit breaker to closed state. For use in tests only.
func (c *Client) ResetForTest() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = stateClosed
	c.failures = 0
}

func (c *Client) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures++
	if c.failures >= 5 || c.state == stateHalfOpen {
		c.state = stateOpen
		c.openUntil = time.Now().Add(30 * time.Second)
	}
}
