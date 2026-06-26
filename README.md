# Pulsegram

> Self-hosted uptime monitor. The Telegram bot **is** the product. Know when your site goes down, get a ping. That's it.

## Quick start (self-host)

1. Get a bot token from [@BotFather](https://t.me/BotFather).
2. Run:

```bash
docker run -d \
  --name pulsegram \
  -p 3000:3000 \
  -v pulsegram-data:/app/data \
  -e TELEGRAM_BOT_TOKEN=your_token_here \
  -e SELF_HOSTED=true \
  -e BASE_URL=https://your-public-domain.com \
  ghcr.io/krmzv/pulsegram:latest
```

Or with compose:

```bash
cp .env.example .env   # set TELEGRAM_BOT_TOKEN, SELF_HOSTED=true, BASE_URL
docker compose up -d
```

3. Message your bot: `/start` → `/add https://yoursite.com`. Done — you're monitoring.

**Key env vars:**

| Variable | Default | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Required. From @BotFather |
| `SELF_HOSTED` | `false` | Set `true` — removes all limits |
| `BASE_URL` | `http://localhost:3000` | Set to your public URL; used in bot links |
| `DATABASE_URL` | `./data/pulsegram.db` | SQLite path or `postgres://` connection string |
| `BETTER_AUTH_SECRET` | auto-generated | Set explicitly for stability across restarts |
| `ALLOW_PRIVATE_TARGETS` | `false` | Set `true` only on trusted internal networks |

Data persists in the `pulsegram-data` named volume (`/app/data` inside the container). The container runs as an unprivileged user; only `/app/data` is writable.

## Local development

```bash
bun install
cp .env.example .env        # set TELEGRAM_BOT_TOKEN (add SELF_HOSTED=true to remove limits)
bun run dev                 # starts API + bot (long polling) + scheduler on :3000
```

`bun run dev` starts only the API workspace. The `dash`, `status`, and `landing` packages are separate apps and are not started by this command.

Alternatively, run the dev environment in Docker (mounts your source for live reload):

```bash
docker compose -f docker-compose.dev.yml up
```

## Bot commands

| Command | Does |
|---|---|
| `/start` | Welcome + quick guide |
| `/add <url>` | Add a monitor |
| `/list` | All monitors with status |
| `/status` | Quick health summary |
| `/remove <url>` | Remove a monitor |
| `/mute <hours>` | Silence alerts for N hours |
| `/upgrade` | Upgrade link (hosted only) |

## Security

Pulsegram fetches arbitrary URLs on a schedule, so it defends against SSRF by default: only
`http`/`https`, DNS is resolved and private/reserved/cloud-metadata IPs are rejected (v4 +
v6), and redirects are followed manually with each hop re-validated. To intentionally
monitor private addresses on a trusted network, set `ALLOW_PRIVATE_TARGETS=true`.

## Status

v1 in progress: working Telegram bot (monitor + alert). Dashboard, public status page, and
landing site are scaffolded and planned — see [`PLAN_V1.md`](./PLAN_V1.md).

## License

MIT
