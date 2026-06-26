# Pinger v1 — Scaffold + Phase 1 Core (Bot that monitors & alerts)

## Context

We're building **Pinger** (PRD: `bbot-prd.md`), a self-hostable uptime monitor whose
primary interface is a Telegram bot. The v1 goal is a working slice: spin up one
container with a single env var (`TELEGRAM_BOT_TOKEN`), `/add https://site.com`, and get
a Telegram alert when it goes down and recovers. Dashboard, status page, and landing are
**planned in `PLAN_V1.md` but not implemented** in this pass.

This is a fresh directory (only `bbot-prd.md` + an empty `PLAN_V1.md`). Bun 1.1.43 and
Docker are installed.

**Decisions (confirmed with user):**
- Scope: scaffold the full monorepo + build Phase 1 (bot core). Other apps are stubs/planned.
- Bot transport: **long polling** (`bot.start()` / getUpdates) — no public URL, works behind NAT, zero onboarding friction. Bot layer abstracted so a webhook adapter can be added later.
- DB: **Drizzle with both SQLite and Postgres** wired from the start; driver chosen by `DATABASE_URL` (sqlite file path → better-sqlite3 in WAL; `postgres://` → node-postgres).

The user explicitly asked to **take security seriously**. For a "give us any URL and we'll
fetch it on a schedule" product, the dominant risk is **SSRF** — this plan treats a hardened
checker as a Phase-1 requirement, not a follow-up. The PRD's sample `checkUrl` (uses
`redirect: 'follow'` with no IP validation) is **insecure as written** and is replaced below.

The first build action is to write `PLAN_V1.md` (the user-facing deliverable) capturing this plan.

---

## Security model (drives Phase 1, not deferred)

| Threat | Mitigation (where) |
|---|---|
| **SSRF** — monitor URL points at `localhost`, `169.254.169.254` (cloud metadata), RFC1918/link-local/CGNAT, IPv6 ULA/`::1`, `0.0.0.0` | `lib/ssrf-guard.ts`: allow only `http`/`https`; reject userinfo/non-standard ports optionally; resolve DNS, reject any resolved IP in a blocklist of private/reserved CIDRs (v4 + v6, incl. IPv4-mapped). Override only via `ALLOW_PRIVATE_TARGETS=true` (off by default, even when self-hosted). |
| **DNS rebinding** (resolve-public-then-connect-private) | Resolve to IPs first, validate them, then connect to the **validated IP** with `Host`/SNI set to the original hostname (pin the IP). Re-validate on every check. |
| **Redirect-based SSRF** | `redirect: 'manual'`; follow ≤3 hops **manually**, re-running the SSRF guard on every hop URL. |
| **Resource exhaustion / huge responses** | Hard `AbortSignal.timeout`; cap body read (~256 KB, we only need status) and abort; max concurrency in scheduler (batch of 20). |
| **Becoming a DDoS amplifier** (25 monitors @ 30s at a victim) | Min interval enforced by plan; global per-host check throttle; document acceptable-use. (Full abuse handling is post-v1; note it.) |
| **IDOR / tenant isolation** | Every monitor/heartbeat/incident query scoped by `user_id`; bot resolves user from `telegram_id`; never trust client-supplied user id. |
| **Telegram link hijack** | Web↔Telegram linking uses a single-use, expiring, cryptographically-random token — never the raw `telegram_id`. |
| **Auth secrets** | `BETTER_AUTH_SECRET` auto-generated (32-byte random) and **persisted to the data volume** on first run if empty, so sessions survive restarts; never logged. |
| **Telegram message injection** | All dynamic content (URLs, error messages) escaped for MarkdownV2 / sent as plain text; cap error-message length. |
| **Secret hygiene** | Tokens/secrets only via env; redacted from logs; `.env` git-ignored; `.env.example` has placeholders only. |
| **Container hardening** | Run as non-root `bun` user; `data/` the only writable volume; slim image; no secrets baked into image. |
| **Input validation** | Zod schemas (`packages/shared/schemas.ts`) on every bot arg and API body; URL normalization + length caps. |
| **Rate limiting** | `@fastify/rate-limit` on API; per-chat command throttle in bot middleware. |

The SSRF guard + manual-redirect fetch is the single most important piece of code in v1.

---

## Phase 0 — Scaffold (monorepo skeleton, all apps)

Create the full structure from the PRD so later phases drop in cleanly, but only `api/` is
implemented now; `dash/`, `status/`, `landing/` get minimal placeholder scaffolds.

```
pinger/
├── package.json            # Bun workspaces: ["packages/*","api","dash","status","landing"]
├── turbo.json              # dev (persistent) + build tasks
├── tsconfig.base.json
├── .env.example            # placeholders only
├── .gitignore              # node_modules, data/, .env, dist
├── .dockerignore
├── docker-compose.yml      # production (single image)
├── docker-compose.dev.yml  # hot-reload dev
├── Dockerfile              # multi-stage; non-root; v1 builds api (+ placeholder static)
├── README.md               # quick start + self-host
├── LICENSE                 # MIT
├── packages/shared/        # types, constants, zod schemas, utils  ← BUILT
├── api/                    # Fastify + bot + scheduler + db        ← BUILT (Phase 1)
├── dash/                   # Vite+React stub (index.html only)     ← scaffold only
├── status/                 # Astro stub                            ← scaffold only
├── landing/                # Astro stub                            ← scaffold only
└── scripts/setup.ts        # interactive first-run (optional)
```

Steps:
1. Root `package.json` (workspaces + scripts: `dev`, `build`, `db:generate`, `db:migrate`), `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.dockerignore`, `.env.example`.
2. `bun install` with the dependency sets below.
3. Placeholder `package.json` + minimal entry for `dash/`, `status/`, `landing/` so workspace resolves and Docker build stays valid.

**Dependencies**
- root (dev): `turbo`, `typescript`, `@types/bun`
- `api`: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`, `drizzle-orm`, `better-sqlite3`, `postgres` (pg driver), `grammy`, `better-auth`, `zod`; dev: `drizzle-kit`, `@types/better-sqlite3`
- `packages/shared`: `zod` (peer)

---

## Phase 1 — Core bot (the milestone)

**Milestone:** `docker compose up` → message the bot `/add https://example.com` → receive
🔴 when it goes down and 🟢 when it recovers.

### 1. `packages/shared` (built first — everything imports it)
- `types.ts` — `Monitor`, `Heartbeat`, `Incident`, `User`, `CheckResult`, `Plan`.
- `constants.ts` — defaults (interval 60s, timeout 5s, retries 3), plan limits (free=1 monitor/60s/7d retention; pro=25/30s/90d), scheduler tick 10s, batch size 20, max body bytes, SSRF CIDR blocklists (v4+v6).
- `schemas.ts` — zod: `addMonitorSchema` (URL normalize+validate http/https, length cap), `monitorPatchSchema`, slug schema (`^[a-z0-9-]{3,32}$`).
- `utils.ts` — uptime % from heartbeats, duration formatting (`3m 42s`), hostname→name, relative time (`1m ago`).

### 2. `api/db` — Drizzle, dual-driver
- `schema.ts` — tables per PRD: `users`, `monitors`, `heartbeats`, `incidents`, `ssl_info` (table created; SSL checks are a Pro/post-core nicety, wire the column + a stub). Use Drizzle in a dialect-portable way; keep one logical schema, generate per-dialect migrations.
- `index.ts` (db factory) — parse `DATABASE_URL`: file/empty → `better-sqlite3` (apply `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`); `postgres://` → `postgres`/drizzle-pg. Export a single typed `db` plus a `dialect` flag.
- `migrate.ts` — run migrations on boot (idempotent). `drizzle.config.ts` for `drizzle-kit generate`.
- In-process `fail_count` per monitor tracked in memory (or a column) for retry state machine.

### 3. `api/lib` — the secure checker
- `ssrf-guard.ts` — `assertSafeUrl(url)`: scheme check, DNS resolve (`dns.lookup` all addresses), reject any reserved/private IP via CIDR match (v4+v6, IPv4-mapped); returns validated `{host, ip, port}`. Honors `ALLOW_PRIVATE_TARGETS`.
- `http-check.ts` — `checkUrl(monitor)`: replaces the PRD snippet. `redirect:'manual'`, manual hop-following (≤3) each re-validated, connect to validated IP, `AbortSignal.timeout`, capped body read, `User-Agent: Pinger/1.0`. Returns `CheckResult { status, statusCode, responseMs, message }`. Up = 2xx/3xx final.
- `telegram.ts` — MarkdownV2 escaping + message builders (status list, down alert, recovery alert) matching PRD formats.

### 4. `api/scheduler/scheduler.ts`
- `setInterval` every 10s: select non-paused monitors due (`now - last_check_at >= interval_sec`), process in concurrency-limited batches (20), call `checkUrl`, write heartbeat, run the **state machine** (UP→fail++→DOWN+incident+alert; DOWN→pass→UP+close incident+recovery; respect mute). Guard against overlapping ticks.
- Nightly cleanup: delete heartbeats older than the user's retention window.

### 5. `api/bot` — grammY, long polling
- `bot.ts` — grammy instance; per-chat rate-limit middleware; error boundary; `bot.start()` (long polling) launched from `index.ts`.
- `commands/`: `start`, `add` (creates user from `telegram_id`, validates URL via shared schema + SSRF pre-check, enforces free limit unless `SELF_HOSTED`), `list`, `remove`, `status`, `mute`, `upgrade`.
- `notifications.ts` — `sendDown` / `sendRecovery` to the owning chat; central place the scheduler calls.
- Auth helper: resolve/lookup user by `telegram_id`; all monitor ops scoped to that user.

### 6. `api/index.ts` — Fastify entry
- Plugins: `@fastify/cors` (locked to dashboard origin / `BASE_URL`), `@fastify/rate-limit`, error handler (no stack leaks in prod), `@fastify/static` to serve `public/dash` + `public/status` (placeholders for now), health check `GET /healthz`.
- Boot sequence: load+validate env (zod) → ensure `BETTER_AUTH_SECRET` (generate+persist if empty) → run migrations → start scheduler → start bot → `listen` on `PORT`.
- API routes from PRD are **scaffolded** (`/api/v1/monitors...`) but only what the bot needs is fully wired in v1; better-auth plugin mounted but full dashboard auth flows land in Phase 2.

### 7. Config / env (`.env.example`)
```
TELEGRAM_BOT_TOKEN=        # required, from @BotFather
BASE_URL=http://localhost:3000
PORT=3000
DATABASE_URL=./data/pinger.db   # or postgres://user:pass@host/db
SELF_HOSTED=false               # true → no limits/billing/upgrade prompts
BETTER_AUTH_SECRET=             # auto-generated+persisted if empty
ALLOW_PRIVATE_TARGETS=false     # SSRF override — keep false
```

### 8. Docker
- Multi-stage `Dockerfile` (oven/bun base): install with frozen lockfile, build api, copy placeholder dash/status static into `api/public`. Production stage on `bun:1-slim`, **non-root user**, `VOLUME /app/data`, `EXPOSE 3000`, `CMD ["bun","run","api/dist/index.js"]` (or run source via bun if build step is trivial).
- `docker-compose.yml` matches PRD (single service, `pinger-data` volume, `restart: unless-stopped`).
- `docker-compose.dev.yml` for hot reload.

---

## Critical files to create

- `packages/shared/src/{types,constants,schemas,utils}.ts`
- `api/src/db/{schema.ts,index.ts,migrate.ts}`, `api/drizzle.config.ts`
- `api/src/lib/{ssrf-guard.ts,http-check.ts,telegram.ts}` ← **security core**
- `api/src/scheduler/scheduler.ts`
- `api/src/bot/bot.ts`, `api/src/bot/commands/*.ts`, `api/src/bot/notifications.ts`
- `api/src/index.ts`, `api/src/plugins/*`
- Root: `package.json`, `turbo.json`, `Dockerfile`, `docker-compose*.yml`, `.env.example`, `.gitignore`, `README.md`, `LICENSE`
- `PLAN_V1.md` (deliverable — written first, mirrors this plan)

## Reuse / consistency notes
- Single source of truth for limits/defaults in `packages/shared/constants.ts`; api and (later) dash import it — never hardcode plan limits in two places.
- One `checkUrl` used by both the scheduler and the bot's `/add` reachability pre-check.
- One `assertSafeUrl` guard used by `/add`, the checker, and every redirect hop.

---

## Verification (end-to-end)

1. **Build/typecheck:** `bun install` clean; `bun run build` (turbo) succeeds; no TS errors in `api` + `shared`.
2. **Unit tests** (`bun test`) for the security-critical bits:
   - `ssrf-guard`: blocks `http://localhost`, `http://127.0.0.1`, `http://169.254.169.254`, `http://10.0.0.1`, `http://[::1]`, IPv4-mapped IPv6, `0.0.0.0`, `file://`, non-http schemes; allows a normal public host; blocks a redirect that lands on a private IP.
   - state machine: UP→3 fails→DOWN (incident opened, alert fired once); DOWN→pass→UP (incident closed, recovery fired); mute suppresses alerts.
   - `utils`: uptime %, duration formatting.
3. **Local run:** export a real `TELEGRAM_BOT_TOKEN`, `bun run dev`. In Telegram: `/start` → `/add https://example.com` → `/list` shows 🟢. Point a monitor at a URL you can take down (or a local stub returning 500 — with `ALLOW_PRIVATE_TARGETS=true` only for the test) → within ~retry window get a 🔴 alert, restore → 🟢 recovery. Confirm second `/add` on free plan hits the paywall message; with `SELF_HOSTED=true` it doesn't.
4. **SSRF live check:** with defaults, `/add http://169.254.169.254/` and `/add http://localhost` are rejected with a clear message.
5. **Docker:** `docker compose up` with the token env → bot live, SQLite file in the volume, `GET /healthz` 200. Restart container → sessions/data persist (secret persisted).
6. **Postgres path (smoke):** set `DATABASE_URL=postgres://…` against a throwaway PG, boot, confirm migrations apply and `/add` works.

---

## Explicitly out of scope for v1 (planned in PLAN_V1.md, built later)
- Phase 2 dashboard (React/shadcn, better-auth flows, uptime bar, web add/remove, mock billing).
- Phase 3 status page (Astro SSR, 90-day bar, incident history, slug customization).
- Phase 4 landing site, GH Actions → GHCR, full docs.
- SSL expiry monitoring (table stubbed; check logic later), webhook bot transport, multi-region checks, advanced abuse/anti-amplification controls.
