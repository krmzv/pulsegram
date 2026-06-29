package state_test

import (
	"testing"

	"github.com/krmzv/pulsegram/probe/internal/state"
)

func TestDecide(t *testing.T) {
	cases := []struct {
		prev      string
		check     string
		failCount int
		retries   int
		want      state.Transition
	}{
		// ── up check ─────────────────────────────────────────────
		{"unknown", "up", 0, 3, state.StayUp},
		{"up", "up", 0, 3, state.StayUp},
		{"down", "up", 0, 3, state.Recovered},

		// ── down check, not yet at threshold ─────────────────────
		{"unknown", "down", 1, 3, state.PendingDown},
		{"up", "down", 1, 3, state.PendingDown},
		{"up", "down", 2, 3, state.PendingDown},

		// ── down check, threshold reached ────────────────────────
		{"unknown", "down", 3, 3, state.WentDown},
		{"up", "down", 3, 3, state.WentDown},
		{"up", "down", 10, 3, state.WentDown}, // failCount > retries

		// ── already down, still down ──────────────────────────────
		{"down", "down", 1, 3, state.StayDown},
		{"down", "down", 99, 3, state.StayDown},

		// ── retries = 1 (fail once → went-down immediately) ──────
		{"up", "down", 1, 1, state.WentDown},

		// ── retries = 0 (every fail → went-down) ─────────────────
		{"up", "down", 1, 0, state.WentDown},
	}

	for _, c := range cases {
		got := state.Decide(c.prev, c.check, c.failCount, c.retries)
		if got != c.want {
			t.Errorf("Decide(%q, %q, fails=%d, retries=%d) = %q, want %q",
				c.prev, c.check, c.failCount, c.retries, got, c.want)
		}
	}
}
