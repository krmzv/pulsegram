package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/krmzv/pulsegram/probe/internal/callback"
	"github.com/krmzv/pulsegram/probe/internal/probe"
	"github.com/krmzv/pulsegram/probe/internal/state"
	"github.com/krmzv/pulsegram/probe/internal/store"
)

type config struct {
	DatabaseURL    string
	APIURL         string
	InternalSecret string
	AllowPrivate   bool
	TickSec        int
	Concurrency    int
}

func loadConfig() config {
	cfg := config{
		DatabaseURL:    env("DATABASE_URL", "./data/pulsegram.db"),
		APIURL:         env("API_URL", "http://api:3000"),
		InternalSecret: env("INTERNAL_SECRET", ""),
		AllowPrivate:   env("ALLOW_PRIVATE_TARGETS", "false") == "true",
		TickSec:        envInt("PROBE_INTERVAL_SEC", 10),
		Concurrency:    envInt("PROBE_CONCURRENCY", 100),
	}
	if cfg.InternalSecret == "" {
		log.Fatal("[probe] INTERNAL_SECRET is required")
	}
	return cfg
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		resp, err := http.Get("http://localhost:8086/healthz")
		if err != nil || resp.StatusCode != 200 {
			os.Exit(1)
		}
		os.Exit(0)
	}

	cfg := loadConfig()

	db, err := store.OpenDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[probe] open db: %v", err)
	}
	defer db.Close()

	cb := callback.New(cfg.APIURL, cfg.InternalSecret)

	failCounts := &sync.Map{}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Health endpoint for Docker/K8s probes.
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
		srv := &http.Server{Addr: ":8086", Handler: mux}
		go func() {
			<-ctx.Done()
			srv.Close()
		}()
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Printf("[probe] health server: %v", err)
		}
	}()

	log.Printf("[probe] started (tick=%ds concurrency=%d)", cfg.TickSec, cfg.Concurrency)

	tick := func() {
		monitors, err := store.LoadDueMonitors(db)
		if err != nil {
			log.Printf("[probe] load monitors: %v", err)
			return
		}
		if len(monitors) == 0 {
			return
		}

		sem := make(chan struct{}, cfg.Concurrency)
		var wg sync.WaitGroup

		for _, m := range monitors {
			wg.Add(1)
			sem <- struct{}{}
			go func(m store.Monitor) {
				defer wg.Done()
				defer func() { <-sem }()
				if err := processMonitor(ctx, db, cb, cfg, failCounts, m); err != nil {
					log.Printf("[probe] monitor %s: %v", m.ID, err)
				}
			}(m)
		}
		wg.Wait()
	}

	tick()
	ticker := time.NewTicker(time.Duration(cfg.TickSec) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Println("[probe] shutting down")
			return
		case <-ticker.C:
			tick()
		}
	}
}

func processMonitor(
	ctx context.Context,
	db *store.DB,
	cb *callback.Client,
	cfg config,
	failCounts *sync.Map,
	m store.Monitor,
) error {
	result := probe.CheckURL(m.URL, m.TimeoutMs, cfg.AllowPrivate, m.Method)
	now := time.Now().Unix()

	// Write the raw heartbeat regardless of state.
	if err := store.WriteHeartbeat(db, m.ID, result.Status, result.StatusCode, result.ResponseMs, result.Message); err != nil {
		log.Printf("[probe] heartbeat write %s: %v", m.ID, err)
	}

	// Update consecutive-failure counter.
	var fails int
	if result.Status == "down" {
		v, _ := failCounts.LoadOrStore(m.ID, 0)
		fails = v.(int) + 1
		failCounts.Store(m.ID, fails)
	} else {
		failCounts.Delete(m.ID)
	}

	transition := state.Decide(m.Status, result.Status, fails, m.Retries)

	// Update the monitor's check fields. The probe owns lastCheckAt, status.
	newStatus := monitorStatusAfter(m.Status, transition)
	if err := store.UpdateMonitorTick(db, m.ID, newStatus, result.ResponseMs); err != nil {
		log.Printf("[probe] monitor update %s: %v", m.ID, err)
	}

	muted := m.MutedUntil != nil && *m.MutedUntil > now

	switch transition {
	case state.WentDown:
		eventID, err := store.WriteEvent(db, m.ID, "incident", store.IncidentPayload{
			CheckedAt: now,
			Error:     result.Message,
		})
		if err != nil {
			return err
		}
		if muted {
			return nil
		}
		if err := cb.PostIncident(ctx, eventID, m.ID, now, result.Message); err != nil {
			log.Printf("[probe] callback incident %s (event %d): %v — event-poller will retry", m.ID, eventID, err)
		}

	case state.Recovered:
		eventID, err := store.WriteEvent(db, m.ID, "recovery", store.RecoveryPayload{
			RecoveredAt: now,
		})
		if err != nil {
			return err
		}
		if muted {
			return nil
		}
		if err := cb.PostRecovery(ctx, eventID, m.ID, now); err != nil {
			log.Printf("[probe] callback recovery %s (event %d): %v — event-poller will retry", m.ID, eventID, err)
		}
	}

	return nil
}

// monitorStatusAfter maps a transition to the new monitor.status value.
func monitorStatusAfter(prev string, t state.Transition) string {
	switch t {
	case state.StayUp, state.Recovered:
		return "up"
	case state.WentDown, state.StayDown:
		return "down"
	default:
		return prev
	}
}
