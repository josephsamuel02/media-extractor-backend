# Debian-slim base keeps ffmpeg install + yt-dlp binary simple.
FROM node:20-slim

# System deps: ffmpeg for yt-dlp format handling, curl + ca-certificates
# to fetch the standalone yt-dlp binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y --auto-remove curl \
  && rm -rf /var/lib/apt/lists/*

# Fail the image build early if the yt-dlp download broke.
RUN yt-dlp --version && ffmpeg -version | head -n 1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main"]
