import { Logger } from '@nestjs/common';
import { execa } from 'execa';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaService } from '../media.service';
import { YoutubeCookiesService } from './youtube-cookies.service';

jest.mock('execa', () => ({ execa: jest.fn() }));
const mockExeca = execa as unknown as jest.Mock;

// Obviously fake — never real credentials.
const ENV_FIXTURE = [
  '# Netscape HTTP Cookie File',
  '# Fake fixture for unit tests',
  '.example.test\tTRUE\t/\tFALSE\t0\tenv_cookie\tUNITTEST_FAKE_ENV_9f8e',
  '',
].join('\n');
const LOCAL_FIXTURE = [
  '# Netscape HTTP Cookie File',
  '# Fake fixture for unit tests',
  '.example.test\tTRUE\t/\tFALSE\t0\tlocal_cookie\tUNITTEST_FAKE_LOCAL_7a1b',
  '',
].join('\n');
const ENV_B64 = Buffer.from(ENV_FIXTURE, 'utf8').toString('base64');
const TMP_NAME = 'yt-dlp-youtube-cookies.txt';
const ENV_KEY = 'YTDLP_COOKIES_B64';

let savedCookieEnv: string | undefined;
let savedNodeEnv: string | undefined;

function setEnv(cookieB64?: string, nodeEnv?: string) {
  if (cookieB64 === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = cookieB64;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}

function restoreEnv() {
  if (savedCookieEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedCookieEnv;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
}

function tmpCookiePath(): string {
  return join(tmpdir(), TMP_NAME);
}

function cleanTmp() {
  const p = tmpCookiePath();
  if (existsSync(p)) rmSync(p);
}

describe('YoutubeCookiesService', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    cleanTmp();
    savedCookieEnv = process.env[ENV_KEY];
    savedNodeEnv = process.env.NODE_ENV;
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanTmp();
    restoreEnv();
    jest.restoreAllMocks();
  });

  it('decodes Base64 and creates a reusable tmp cookie file with identical contents (A,B,C)', () => {
    setEnv(ENV_B64, 'test');
    const svc = new YoutubeCookiesService();
    const args = svc.buildCookieArgs();
    expect(args[0]).toBe('--cookies');
    expect(args[1]).toContain(TMP_NAME);
    expect(existsSync(args[1])).toBe(true);
    expect(readFileSync(args[1], 'utf8')).toBe(ENV_FIXTURE);
    // Reused, not rewritten per call.
    expect(svc.buildCookieArgs()[1]).toBe(args[1]);
    expect(svc.getStatus()).toBe('env');
  });

  it('returns no args when nothing is configured (D)', () => {
    setEnv(undefined, 'production');
    const svc = new YoutubeCookiesService();
    expect(svc.buildCookieArgs()).toEqual([]);
    expect(svc.getStatus()).toBe('none');
  });

  it('ignores an invalid Base64 value without throwing (D)', () => {
    setEnv('!!!', 'production');
    const svc = new YoutubeCookiesService();
    expect(svc.buildCookieArgs()).toEqual([]);
  });

  it('prefers the env var over a local cookies.txt and supports dev fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cookies-test-'));
    try {
      writeFileSync(join(dir, 'cookies.txt'), LOCAL_FIXTURE);
      // Env wins when both exist.
      setEnv(ENV_B64, 'test');
      const withEnv = new YoutubeCookiesService(dir);
      expect(withEnv.getStatus()).toBe('env');
      expect(readFileSync(withEnv.buildCookieArgs()[1], 'utf8')).toBe(ENV_FIXTURE);
      cleanTmp();
      // Local file used only outside production.
      setEnv(undefined, 'test');
      const devOnly = new YoutubeCookiesService(dir);
      expect(devOnly.getStatus()).toBe('local-file');
      expect(readFileSync(devOnly.buildCookieArgs()[1], 'utf8')).toBe(LOCAL_FIXTURE);
      cleanTmp();
      // Production never touches the local file.
      setEnv(undefined, 'production');
      const prod = new YoutubeCookiesService(dir);
      expect(prod.getStatus()).toBe('none');
      expect(prod.buildCookieArgs()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never logs cookie contents or the Base64 value (F)', () => {
    setEnv(ENV_B64, 'test');
    const svc = new YoutubeCookiesService();
    svc.onModuleInit();
    svc.buildCookieArgs();
    setEnv('!!!', 'production');
    const bad = new YoutubeCookiesService();
    bad.onModuleInit();
    bad.buildCookieArgs();
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((c) => String(c[0] ?? ''))
      .join('\n');
    expect(logged).not.toContain('UNITTEST_FAKE_ENV_9f8e');
    expect(logged).not.toContain('UNITTEST_FAKE_LOCAL_7a1b');
    expect(logged).not.toContain(ENV_B64);
  });
});

describe('MediaService cookie wiring', () => {
  beforeEach(() => {
    cleanTmp();
    savedCookieEnv = process.env[ENV_KEY];
    savedNodeEnv = process.env.NODE_ENV;
    mockExeca.mockReset();
  });

  afterEach(() => {
    cleanTmp();
    restoreEnv();
  });

  const cannedStdout = JSON.stringify({
    extractor_key: 'youtube',
    title: 'fake video',
    formats: [
      {
        format_id: '18',
        ext: 'mp4',
        url: 'https://example.test/v.mp4',
        vcodec: 'avc1',
        acodec: 'mp4a',
        protocol: 'https',
        height: 360,
      },
    ],
  });

  it("passes --cookies to yt-dlp when configured (E)", async () => {
    setEnv(ENV_B64, 'test');
    mockExeca.mockResolvedValue({ stdout: cannedStdout });
    const svc = new MediaService(new YoutubeCookiesService());
    const result = await svc.extract('https://www.youtube.com/watch?v=fake');
    const args: string[] = mockExeca.mock.calls[0][1];
    const i = args.indexOf('--cookies');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toContain(TMP_NAME);
    expect(result.type).toBe('video');
  });

  it('omits --cookies when nothing is configured', async () => {
    setEnv(undefined, 'production');
    mockExeca.mockResolvedValue({ stdout: cannedStdout });
    const svc = new MediaService(new YoutubeCookiesService());
    await svc.extract('https://www.youtube.com/watch?v=fake');
    const args: string[] = mockExeca.mock.calls[0][1];
    expect(args).not.toContain('--cookies');
  });
});
