package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

// DB wraps *sql.DB with dialect-aware placeholder replacement.
type DB struct {
	*sql.DB
	isPostgres bool
}

// q replaces $N placeholders with ? for SQLite.
func (d *DB) q(query string) string {
	if d.isPostgres {
		return query
	}
	// Replace $1, $2, ... with ? for SQLite.
	// Simple pass: replace each $N token in left-to-right order.
	out := query
	for i := 20; i >= 1; i-- {
		out = strings.ReplaceAll(out, fmt.Sprintf("$%d", i), "?")
	}
	return out
}

type Monitor struct {
	ID          string
	URL         string
	Method      string
	IntervalSec int
	TimeoutMs   int
	Retries     int
	Status      string
	LastCheckAt *int64
	MutedUntil  *int64
}

func OpenDB(databaseURL string) (*DB, error) {
	if strings.HasPrefix(databaseURL, "postgres") {
		raw, err := sql.Open("pgx", databaseURL)
		if err != nil {
			return nil, err
		}
		raw.SetMaxOpenConns(10)
		raw.SetConnMaxLifetime(5 * time.Minute)
		return &DB{DB: raw, isPostgres: true}, nil
	}

	raw, err := sql.Open("sqlite", databaseURL)
	if err != nil {
		return nil, err
	}
	raw.SetMaxOpenConns(1) // WAL: serialized writes
	if _, err := raw.Exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`); err != nil {
		return nil, fmt.Errorf("sqlite pragmas: %w", err)
	}
	return &DB{DB: raw, isPostgres: false}, nil
}

// LoadDueMonitors returns monitors whose next check is overdue.
func LoadDueMonitors(db *DB) ([]Monitor, error) {
	now := time.Now().Unix()
	rows, err := db.Query(db.q(`
		SELECT id, url, method, interval_sec, timeout_ms, retries, status, last_check_at, muted_until
		FROM monitors
		WHERE is_paused = 0
		  AND (last_check_at IS NULL OR last_check_at < $1 - interval_sec)`),
		now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Monitor
	for rows.Next() {
		var m Monitor
		if err := rows.Scan(&m.ID, &m.URL, &m.Method, &m.IntervalSec, &m.TimeoutMs,
			&m.Retries, &m.Status, &m.LastCheckAt, &m.MutedUntil); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// WriteHeartbeat inserts a raw check result.
func WriteHeartbeat(db *DB, monitorID, status string, statusCode *int, responseMs int64, message *string) error {
	_, err := db.Exec(db.q(`
		INSERT INTO heartbeats (monitor_id, status, status_code, response_ms, message, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)`),
		monitorID, status, statusCode, responseMs, message, time.Now().Unix())
	return err
}

// UpdateMonitorTick updates lastCheckAt, status, and lastResponseMs.
func UpdateMonitorTick(db *DB, monitorID, status string, responseMs int64) error {
	now := time.Now().Unix()
	_, err := db.Exec(db.q(`
		UPDATE monitors
		SET status = $1, last_check_at = $2, last_response_ms = $3, updated_at = $2
		WHERE id = $4`),
		status, now, responseMs, monitorID)
	return err
}

// IncidentPayload is the JSON blob for 'incident' pending_events.
type IncidentPayload struct {
	CheckedAt int64   `json:"checked_at"`
	Error     *string `json:"error"`
}

// RecoveryPayload is the JSON blob for 'recovery' pending_events.
type RecoveryPayload struct {
	RecoveredAt int64 `json:"recovered_at"`
}

// WriteEvent inserts a pending_event and returns its ID.
func WriteEvent(db *DB, monitorID, eventType string, payload any) (int64, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	now := time.Now().Unix()

	if db.isPostgres {
		var id int64
		err = db.QueryRow(`
			INSERT INTO pending_events (monitor_id, event_type, payload, status, created_at)
			VALUES ($1, $2, $3, 'pending', $4)
			RETURNING id`,
			monitorID, eventType, string(data), now).Scan(&id)
		return id, err
	}

	// SQLite: Exec + LastInsertId
	res, err := db.Exec(`
		INSERT INTO pending_events (monitor_id, event_type, payload, status, created_at)
		VALUES (?, ?, ?, 'pending', ?)`,
		monitorID, eventType, string(data), now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// MarkDelivered marks a pending_event as delivered.
func MarkDelivered(db *DB, eventID int64) error {
	now := time.Now().Unix()
	_, err := db.Exec(db.q(`
		UPDATE pending_events
		SET status = 'delivered', delivered_at = $1
		WHERE id = $2 AND status = 'pending'`),
		now, eventID)
	return err
}
