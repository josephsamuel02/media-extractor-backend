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
# YTDLP_PATH=/usr/local/bin/yt-dlp   # optional: absolute path to the yt-dlp
                                     # binary when it isn't on PATH
# YTDLP_VERBOSE=1                    # optional: pass -v to yt-dlp so failure
                                     # logs include debug lines (e.g. whether
                                     # the PO-token plugin engaged)
```

## Deploy

Build from the `Dockerfile` (Railway / Render / Fly.io). On Render the service
**Runtime must be Docker** — with the default Node runtime Render ignores the
Dockerfile, so `yt-dlp`/`ffmpeg` never get installed and every
`/media/extract` call fails with `Media extractor binary (yt-dlp) is not
installed on the server`. Do not target Vercel
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

## YouTube bot-check workaround (PO-token provider)

YouTube flags datacenter IPs and demands proof-of-origin tokens. Two layers
mitigate this, no login involved:

1. Every request passes `--extractor-args youtube:player_client=tv,web_safari`
   (namespaced — ignored for other platforms).
2. The Docker image bundles the
   [`bgutil-ytdlp-pot-provider`](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
   server (**pinned to `2.0.0`** via `ARG BGUTIL_VERSION` in the Dockerfile)
   plus its yt-dlp plugin. `start.sh` boots the token server on localhost:4416
   before Nest starts; the service passes `--plugin-dirs` only when that folder
   exists (i.e. inside the image, never local dev).

Verify the plugin is engaged: set `YTDLP_VERBOSE=1` on the service, trigger a
failing YouTube extraction, and look for
`[youtube] [pot] PO Token Providers: bgutil:http-... (external)` in the error
log. `(external, unavailable)` means the plugin can't reach the server.

Maintenance: bump `BGUTIL_VERSION` deliberately when YouTube changes detection
again — never track the provider's default branch. The 2.0.0 pin also carries
a localhost-binding security fix (same-container traffic only, which is exactly
our topology). If this ever proves too fragile, dropping back to layer 1 only
is fine — X/Facebook/TikTok/Instagram never had this problem.

## YouTube cookies (required for YouTube, optional otherwise)

YouTube bot-challenges datacenter IPs, so YouTube extraction needs an
authenticated cookie jar. Everything else works without it. The secret travels
as `YTDLP_COOKIES_B64` (Base64 of a Netscape `cookies.txt` export) and is
materialized into the OS temp dir at runtime — never committed, never logged,
never returned by the API.

Local setup:

1. Export your YouTube cookies (browser extension, Netscape format) to
   `cookies.txt` in the project root (already Git-ignored — verify with
   `git check-ignore -v cookies.txt`).
2. Run `npm run cookies:encode` — the Base64 value is copied to your clipboard
   (the script never prints or modifies the original file).
3. Paste it into your local `.env` as `YTDLP_COOKIES_B64=<paste>`.
4. Start the app — startup logs `YouTube yt-dlp cookies: configured
   (environment variable)`. Without the variable it logs `not configured` and
   keeps running; YouTube URLs then return the bot-traffic 422.

   Dev shortcut: if the variable is missing but `cookies.txt` exists (and
   `NODE_ENV` isn't `production`), the local file is used automatically.

Render setup:

1. Open the service → Environment Variables.
2. Add key `YTDLP_COOKIES_B64`, paste the Base64 value, save (redeploys).
3. The app recreates the temp cookie file on every boot — nothing to persist,
   and `cookies.txt` must never be committed for this to work (it isn't needed
   on the server at all).

## Scope notes

Public posts only — no login, no private/friends-only content, no proxying or
storing media files.
