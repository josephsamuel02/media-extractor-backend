#!/bin/sh
# The PO-token provider must already be listening before yt-dlp is invoked.
cd /opt/bgutil-pot/server
deno run --allow-env --allow-net --allow-ffi=. --allow-read=. --allow-sys ./src/main.ts --port 4416 &
cd /app
node dist/main.js
