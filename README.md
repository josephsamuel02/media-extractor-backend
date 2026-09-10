# Media Extractor Backend

Stateless NestJS service: accept a **public** social media post URL, resolve it with
`yt-dlp` into direct downloadable media links, return JSON. No auth, no database,
no file storage — the mobile client downloads directly from the returned URLs.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/media/extract` | Body `{ "url": "https://..." }` → normalized media JSON |
| `GET` | `/health` | Health check for deploy probes |
| `GET` | `/docs` | Swagger UI (interactive API docs) |

## Run locally

Requires Node 20+ and, for actual extraction, the `yt-dlp` binary + `ffmpeg`
on PATH (the `Dockerfile` installs both — local dev without them still boots,
but `/media/extract` will fail).

```bash
npm install
npm run start:dev
# Swagger: http://localhost:3000/docs
```

## Test

```bash
curl -X POST http://localhost:3000/media/extract \
  -H "Content-Type: application/json" \
  -d '{"url":"<a public YouTube video URL>"}'
```

Repeat with a public TikTok, X/Twitter, and Facebook video URL. Expect a
normalized `{ platform, type, formats[] }` response with at least one pre-muxed
playable format. A broken/unsupported URL should return a clean 400/422, never
a stack trace.

Error map: bad URL → 400; unsupported platform → 400; private/deleted/geo-blocked
→ 422; extraction timeout (>30s) → 504.

## Config (`.env`)

```
PORT=3000
THROTTLE_TTL=60      # seconds, per-IP window
THROTTLE_LIMIT=20    # requests per window per IP
```

## Deploy

Build from the `Dockerfile` (Railway / Render / Fly.io). Do not target Vercel
serverless — native binaries + 30s extraction timeouts don't fit that model.

## Keeping yt-dlp current (important)

Platforms break extractors regularly; yt-dlp ships fixes fast. Update the binary:

```bash
yt-dlp -U
# or, matching the Dockerfile install:
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
```

Consider a weekly scheduled job that re-pulls the latest release binary.

## Scope notes

Public posts only — no login, no private/friends-only content, no proxying or
storing media files.
