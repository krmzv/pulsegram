# CLAUDE.md

## Response Style

- Answer first, explain after (if needed)
- No preamble, no "Great question!", no restating the question
- Prefer one sentence over one paragraph
- Skip obvious caveats ("note that...", "keep in mind...")
- If the answer is a command, just give the command
- Don't summarize what you just said at the end
- When in doubt, say less
- When asked explicitly, explain deeper
- Keep it as complex as necessary, as simple as possible

---

## Project

Self-hostable uptime monitor. Telegram bot is the product. `docker compose up`, `/add https://yoursite.com`, get pinged when it goes down.

## Stack

- **Runtime**: Bun
- **Monorepo**: Bun workspaces + Turborepo
- **API**: Fastify (single process: API + bot + scheduler)
- **Bot**: grammY, long polling (no webhook, works behind NAT)
- **ORM**: Drizzle (SQLite default, Postgres via `DATABASE_URL`)
- **Validation**: Zod everywhere (env, bot args, API bodies)
- **Auth**: better-auth (Fastify plugin, auto-generated secret)

## Structure

```
packages/shared/src/   # types, constants, schemas, utils (single source of truth)
api/src/
  index.ts             # boot: config -> migrate -> plugins -> scheduler -> bot -> listen
  config.ts            # Zod-validated env, auto-generated auth secret
  db/
    schema.sqlite.ts   # canonical Drizzle schema
    schema.pg.ts       # Postgres mirror (same column/table names)
    index.ts           # driver factory: sqlite or postgres by DATABASE_URL
    migrate.ts         # runs on boot (idempotent)
  lib/
    ssrf-guard.ts      # DNS resolve + IP validation (v4/v6, CIDR block lists)
    http-check.ts      # fetch with manual redirect following, SSRF re-check per hop
    telegram.ts        # MarkdownV2 escaping, message formatting
  bot/
    bot.ts             # grammY instance
    commands/           # /start /add /remove /list /status /mute /upgrade
    notifications.ts   # down/recovery alerts
  scheduler/
    scheduler.ts       # 10s tick, batch checks (20 concurrent), nightly cleanup
    state-machine.ts   # UP->DOWN after N fails, DOWN->UP on recovery
  modules/
    monitors/           # monitor service layer
  plugins/              # cors, rate-limit, error-handler
dash/                  # React + shadcn (stub, Phase 2)
status/                # Astro SSR status page (stub, Phase 3)
landing/               # Astro landing page (stub, Phase 4)
```

## Commands

```bash
bun install             # install all workspaces
bun run dev             # start API with hot reload (reads .env from root)
bun run build           # turbo build all workspaces
bun run typecheck       # turbo typecheck all workspaces
bun test                # run all tests (ssrf-guard, state-machine, utils)
bun run db:generate     # drizzle-kit generate (SQLite schema)
bun run db:migrate      # run migrations
```

## Environment

```
TELEGRAM_BOT_TOKEN=     # required, from @BotFather
BASE_URL=http://localhost:3000
PORT=3000
DATABASE_URL=./data/pulsegram.db   # or postgres://...
SELF_HOSTED=false               # true -> no limits, no billing
BETTER_AUTH_SECRET=             # auto-generated + persisted to data/ if empty
ALLOW_PRIVATE_TARGETS=false     # SSRF override, keep false
```

## Database

- SQLite by default (WAL mode), single file in `./data/pulsegram.db`
- Postgres when `DATABASE_URL` starts with `postgres`
- Both schemas are identical in column/table names. SQLite schema is canonical; PG is cast to match
- Migrations run automatically on boot via `migrate.ts`
- Tables: `users`, `monitors`, `heartbeats`, `incidents`, `ssl_info`
- Every query scoped by `user_id` (resolved from `telegram_id`)

## Security (non-negotiable)

SSRF is the dominant risk. The app fetches arbitrary user-supplied URLs on a schedule.

- `ssrf-guard.ts`: resolve DNS, reject any reserved/private IP (v4+v6, IPv4-mapped). Only `http`/`https`
- Redirects: `redirect:'manual'`, follow max 3 hops, re-run SSRF guard on each hop
- `ALLOW_PRIVATE_TARGETS=true` is the only override (default off)
- Response body capped at 256KB, `AbortSignal.timeout`, batch concurrency capped at 20
- Telegram injection: escape MarkdownV2 for dynamic content, cap error length
- Auth secret auto-generated (32 bytes hex) and persisted to data volume

## Bot Commands

| Command | What it does |
|---|---|
| `/start` | Welcome + quick guide |
| `/add <url>` | Add a monitor (plan-limited) |
| `/remove <url>` | Remove a monitor |
| `/list` | All monitors with status |
| `/status` | Quick health summary |
| `/mute <duration>` | Silence alerts for N hours |
| `/upgrade` | Show upgrade link |

## Plan Limits

| | Free | Pro | Self-hosted |
|---|---|---|---|
| Monitors | 1 | 25 | unlimited |
| Min interval | 60s | 30s | 60s |
| Retention | 7d | 90d | 90d |

`SELF_HOSTED=true` lifts all limits.

## Copy Rules

- Never use em dashes. Use periods, colons, or rewrite the sentence instead.
- Use sentence case, not title case. Capitalize only the first word and proper nouns.
