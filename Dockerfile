# Debian-slim base keeps ffmpeg install + yt-dlp binary simple.
FROM node:20-slim

# Pinned PO-token provider release — bump deliberately after checking the
# upstream releases page, never track latest implicitly.
ARG BGUTIL_VERSION=2.0.0

# System deps: ffmpeg for yt-dlp format handling; python3 as the yt-dlp
# binary's interpreter; Deno for the PO-token provider server.
# curl/ca-certificates/unzip/git exist only to fetch third-party bits in this
# layer and are purged at the end of it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates unzip git \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && curl -fsSL https://deno.land/install.sh | sh \
  && git clone --depth 1 --branch "${BGUTIL_VERSION}" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-pot \
  && mkdir -p /usr/local/bin/yt-dlp-plugins \
  && curl -L "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
    -o /usr/local/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip \
  && apt-get purge -y --auto-remove curl unzip git \
  && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.deno/bin:${PATH}"

# Fail the image build early if a third-party download broke.
RUN yt-dlp --version \
  && deno --version \
  && ffmpeg -version | head -n 1 \
  && python3 -c "import zipfile; print(zipfile.ZipFile('/usr/local/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip').namelist())"

# PO-token provider JS dependencies (own layer so app rebuilds don't refetch).
WORKDIR /opt/bgutil-pot/server
RUN deno install --allow-scripts=npm:canvas --frozen
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "start.sh"]
