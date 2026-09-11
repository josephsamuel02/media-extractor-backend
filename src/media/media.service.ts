import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { execa } from 'execa';
import { existsSync } from 'node:fs';
import {
  ExtractionResultDto,
  MediaFormatDto,
} from './dto/extraction-result.dto';
import {
  filterPlayableFormats,
  guessImageExt,
  normalizePlatform,
} from './utils/format-filter';
import { YoutubeCookiesService } from './cookies/youtube-cookies.service';

const YTDLP_TIMEOUT_MS = 30000;
// Absolute path override for environments where the binary isn't on PATH
// (e.g. Render native runtime, Windows dev). Docker image has it on PATH.
const YTDLP_BIN = process.env.YTDLP_PATH ?? 'yt-dlp';
// PO-token plugin ships inside the Docker image only; absent in local dev.
const PLUGIN_DIR = '/usr/local/bin/yt-dlp-plugins';
const PLUGIN_ARGS = existsSync(PLUGIN_DIR) ? ['--plugin-dirs', PLUGIN_DIR] : [];
// YTDLP_VERBOSE=1 adds -v (debug lines land in the failure log) for diagnosis.
const VERBOSE_ARGS = process.env.YTDLP_VERBOSE === '1' ? ['-v'] : [];

export class YtDlpExecutionError extends Error {
  exitCode?: number;
  stderr?: string;
  timedOut?: boolean;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly cookies: YoutubeCookiesService) {}

  async extract(rawUrl: string): Promise<ExtractionResultDto> {
    const url = rawUrl.trim();
    let stdout: string;
    try {
      const result = await execa(
        YTDLP_BIN,
        [
          '--dump-json',
          '--no-warnings',
          '--no-playlist',
          '--skip-download',
          // Namespaced to the youtube extractor: ignored for X/Facebook/
          // TikTok/Instagram. tv + web_safari clients draw far less
          // bot-scrutiny than the default web client on datacenter IPs.
          '--extractor-args',
          'youtube:player_client=tv,web_safari',
          ...PLUGIN_ARGS,
          ...VERBOSE_ARGS,
          ...this.cookies.buildCookieArgs(),
          url,
        ],
        { timeout: YTDLP_TIMEOUT_MS },
      );
      stdout = result.stdout;
    } catch (err: any) {
      throw this.mapYtDlpError(err);
    }

    let data: any;
    try {
      stdout = stdout.trim();
      // --dump-json prints one JSON object per line; take the first non-empty line
      // for the single-post case.
      const firstLine = stdout.split('\n').find((l) => l.trim().length > 0) ?? '';
      data = JSON.parse(firstLine);
    } catch (err) {
      this.logger.error(`Failed to parse yt-dlp output: ${err}`);
      throw new UnprocessableEntityException(
        "Couldn't extract media from this post",
      );
    }

    return this.normalize(data);
  }

  private normalize(data: any): ExtractionResultDto {
    const platform = normalizePlatform(data?.extractor_key ?? data?.extractor);
    const rawFormats = Array.isArray(data?.formats) ? data.formats : [];
    this.logger.log(
      `formats: platform=${platform} raw=${rawFormats.length} ` +
        rawFormats
          .slice(0, 12)
          .map(
            (f: any) =>
              `[${f?.format_id ?? '?'}|${f?.ext ?? '?'}|v=${f?.vcodec ?? '?'}|a=${f?.acodec ?? '?'}|${f?.protocol ?? '?'}]`,
          )
          .join(''),
    );
    const title: string | undefined =
      typeof data?.title === 'string' ? data.title : undefined;
    const thumbnail: string | undefined =
      typeof data?.thumbnail === 'string'
        ? data.thumbnail
        : Array.isArray(data?.thumbnails) && data.thumbnails.length > 0
          ? data.thumbnails[data.thumbnails.length - 1]?.url
          : undefined;
    const durationSeconds: number | undefined =
      typeof data?.duration === 'number'
        ? Math.round(data.duration)
        : undefined;

    // Multi-image / multi-entry posts (IG carousels, X threads).
    // Even with --no-playlist yt-dlp can return _type: 'playlist' + entries.
    if (data?._type === 'playlist' && Array.isArray(data?.entries)) {
      const images: string[] = data.entries
        .map((e: any) => {
          if (typeof e?.url === 'string' && this.looksLikeImage(e.url, e))
            return e.url as string;
          if (typeof e?.thumbnail === 'string') return e.thumbnail as string;
          if (
            Array.isArray(e?.thumbnails) &&
            e.thumbnails.length > 0 &&
            typeof e.thumbnails[e.thumbnails.length - 1]?.url === 'string'
          )
            return e.thumbnails[e.thumbnails.length - 1].url as string;
          return null;
        })
        .filter((u: string | null): u is string => !!u);
      const unique = [...new Set(images)];
      if (unique.length > 0) {
        const formats: MediaFormatDto[] = unique.map((img) => ({
          quality: 'image',
          ext: guessImageExt(img),
          url: img,
        }));
        return {
          platform,
          type: unique.length > 1 ? 'carousel' : 'image',
          title,
          thumbnail: thumbnail ?? unique[0],
          durationSeconds: undefined,
          formats,
          images: unique,
        };
      }
      // Playlist with no usable images — fall through to format handling
      // so we still return a clean 422 instead of an empty success.
    }

    const formats = filterPlayableFormats(data?.formats);
    if (formats.length > 0) {
      return {
        platform,
        type: 'video',
        title,
        thumbnail,
        durationSeconds,
        formats,
      };
    }

    // Single-image fallback: formats empty, direct URL lives under
    // `url` or the last thumbnail entry.
    const directUrl: string | undefined =
      typeof data?.url === 'string' ? data.url : undefined;
    if (directUrl && this.looksLikeImage(directUrl, data)) {
      return {
        platform,
        type: 'image',
        title,
        thumbnail: thumbnail ?? directUrl,
        durationSeconds: undefined,
        formats: [
          { quality: 'image', ext: guessImageExt(directUrl), url: directUrl },
        ],
        images: [directUrl],
      };
    }
    if (thumbnail) {
      return {
        platform,
        type: 'image',
        title,
        thumbnail,
        durationSeconds: undefined,
        formats: [
          { quality: 'image', ext: guessImageExt(thumbnail), url: thumbnail },
        ],
        images: [thumbnail],
      };
    }

    // Audio-only fallback (e.g. SoundCloud-style extractors).
    const audioOnly = (Array.isArray(data?.formats) ? data.formats : []).filter(
      (f: any) =>
        !!f?.url && f?.vcodec === 'none' && f?.acodec && f.acodec !== 'none',
    );
    if (audioOnly.length > 0) {
      audioOnly.sort((a: any, b: any) => (b.abr ?? 0) - (a.abr ?? 0));
      const best = audioOnly[0];
      return {
        platform,
        type: 'audio',
        title,
        thumbnail,
        durationSeconds,
        formats: [
          {
            quality: 'audio',
            ext: best.ext ?? 'mp3',
            url: best.url,
            approxFilesizeBytes:
              best.filesize ?? best.filesize_approx ?? undefined,
            headers: best.http_headers ?? undefined,
          },
        ],
      };
    }

    throw new UnprocessableEntityException(
      "Couldn't extract media from this post",
    );
  }

  private looksLikeImage(url: string, entry?: any): boolean {
    if (typeof entry?.vcodec === 'string' && entry.vcodec !== 'none')
      return false;
    if (entry?.height && entry?.vcodec) return false;
    return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || !/\.mp4|\.m3u8/i.test(url);
  }

  private mapYtDlpError(err: any): Error {
    if (err?.timedOut) {
      return new GatewayTimeoutException('Extraction timed out');
    }
    const stderr: string = String(err?.stderr ?? '');
    const exitCode: number | undefined = err?.exitCode;
    const code: string | undefined = err?.code;
    const short: string = String(err?.shortMessage ?? err?.message ?? err);
    const snip = process.env.YTDLP_VERBOSE === '1' ? 3000 : 500;
    this.logger.error(
      `yt-dlp failed (bin=${YTDLP_BIN} code=${code} exit=${exitCode}): ${short.slice(0, 300)} | stderr: ${stderr.slice(0, snip)}`,
    );

    // Binary missing on this machine (e.g. host without yt-dlp installed).
    if (code === 'ENOENT') {
      return new InternalServerErrorException(
        'Media extractor binary (yt-dlp) is not installed on the server',
      );
    }

    if (exitCode != null && exitCode !== 0) {
      const lower = stderr.toLowerCase();
      if (
        lower.includes('unsupported url') ||
        lower.includes('unknown url') ||
        lower.includes('not supported') ||
        lower.includes('no video outputs') ||
        lower.includes('unsupported')
      ) {
        return new BadRequestException("This platform/URL isn't supported");
      }
      // YouTube bot-challenges datacenter IPs ("Sign in to confirm you're not
      // a bot"). Cookie auth usually fixes that — unless the cookies
      // themselves are stale (YouTube rotates them) or the IP is throttled.
      if (lower.includes('no longer valid')) {
        return new UnprocessableEntityException(
          "Couldn't extract media: the server's YouTube cookies expired or were rotated — re-export fresh cookies",
        );
      }
      if (lower.includes('http error 429') || lower.includes('too many requests')) {
        return new HttpException(
          'YouTube rate-limited this server — wait a minute and retry',
          429,
        );
      }
      if (lower.includes('not a bot') || lower.includes('cookies-from-browser')) {
        return new UnprocessableEntityException(
          "Couldn't extract media: YouTube flagged this server as bot traffic (cookie login required)",
        );
      }
      // Private / deleted / geo-blocked / login-gated and friends.
      return new UnprocessableEntityException(
        "Couldn't extract media from this post",
      );
    }
    if (err instanceof Error && !(err as any).exitCode) {
      return new InternalServerErrorException('Extraction failed');
    }
    return new InternalServerErrorException('Extraction failed');
  }
}
