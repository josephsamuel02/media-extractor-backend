import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const COOKIES_ENV_VAR = 'YTDLP_COOKIES_B64';
export const COOKIES_REPO_ROOT = 'YOUTUBE_COOKIES_REPO_ROOT';
const TMP_COOKIE_FILENAME = 'yt-dlp-youtube-cookies.txt';
const LOCAL_COOKIE_FILENAME = 'cookies.txt';

export type CookieSource = 'env' | 'local-file' | 'none';

/**
 * Materializes YouTube auth cookies for yt-dlp without ever persisting a
 * secret in the repo, the image, logs, or HTTP traffic.
 *
 * Precedence: YTDLP_COOKIES_B64 -> local cookies.txt (development only) ->
 * no cookies. The decoded bytes always land in the OS temp directory
 * (recreated on every start; Render-safe) and the file is reused across
 * extractions instead of rewritten per download.
 */
@Injectable()
export class YoutubeCookiesService implements OnModuleInit {
  private readonly logger = new Logger(YoutubeCookiesService.name);
  private cookieFilePath?: string;

  // Note: reads process.env directly (same as the other YTDLP_* settings in
  // MediaService) instead of ConfigService, because @nestjs/config ships
  // ESM-only and breaks the CommonJS jest suite. ConfigModule still loads
  // .env into process.env at boot, so values are identical.
  constructor(
    @Optional()
    @Inject(COOKIES_REPO_ROOT)
    private readonly repoRoot?: string,
  ) {}

  onModuleInit() {
    const source = this.getStatus();
    if (source === 'env') {
      this.logger.log(
        'YouTube yt-dlp cookies: configured (environment variable)',
      );
    } else if (source === 'local-file') {
      this.logger.log(
        'YouTube yt-dlp cookies: configured (local cookies.txt, development only)',
      );
    } else {
      this.logger.log('YouTube yt-dlp cookies: not configured');
    }
  }

  /** `['--cookies', tmpPath]` when cookies exist, otherwise `[]`. Never throws. */
  buildCookieArgs(): string[] {
    const path = this.ensureCookieFile();
    return path ? ['--cookies', path] : [];
  }

  getStatus(): CookieSource {
    if (this.readEnvB64()) return 'env';
    if (this.localFallbackAllowed() && this.localCookiePath()) {
      return 'local-file';
    }
    return 'none';
  }

  private ensureCookieFile(): string | undefined {
    if (this.cookieFilePath && existsSync(this.cookieFilePath)) {
      return this.cookieFilePath;
    }
    const fromEnv = this.readEnvB64();
    if (fromEnv) {
      let decoded: Buffer;
      try {
        decoded = Buffer.from(fromEnv, 'base64');
      } catch {
        this.logger.warn(
          'YouTube yt-dlp cookies: ignoring invalid Base64 value',
        );
        return undefined;
      }
      if (decoded.length === 0) {
        this.logger.warn(
          'YouTube yt-dlp cookies: ignoring empty decoded value',
        );
        return undefined;
      }
      return this.writeTmp(decoded);
    }
    if (this.localFallbackAllowed()) {
      const local = this.localCookiePath();
      if (local) return this.writeTmp(readFileSync(local));
    }
    return undefined;
  }

  private readEnvB64(): string | undefined {
    const raw = process.env[COOKIES_ENV_VAR];
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value.length > 0 ? value : undefined;
  }

  private localFallbackAllowed(): boolean {
    return (process.env.NODE_ENV ?? 'development') !== 'production';
  }

  private localCookiePath(): string | undefined {
    const candidate = join(this.repoRoot ?? process.cwd(), LOCAL_COOKIE_FILENAME);
    return existsSync(candidate) ? candidate : undefined;
  }

  private writeTmp(bytes: Buffer): string | undefined {
    try {
      const path = join(tmpdir(), TMP_COOKIE_FILENAME);
      writeFileSync(path, bytes, { mode: 0o600 });
      this.cookieFilePath = path;
      return path;
    } catch {
      this.logger.warn(
        'YouTube yt-dlp cookies: could not write temporary cookie file',
      );
      return undefined;
    }
  }
}
