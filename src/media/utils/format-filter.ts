import { MediaFormatDto } from '../dto/extraction-result.dto';

interface RawFormat {
  url?: string;
  ext?: string;
  height?: number;
  width?: number;
  resolution?: string;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  fps?: number;
  format_note?: string;
  format_id?: string;
  protocol?: string;
  http_headers?: Record<string, string>;
}

/**
 * Normalize yt-dlp's extractor_key into a stable platform slug.
 * e.g. "Twitter" -> "twitter", "YoutubeTab" -> "youtube", "TikTok" -> "tiktok"
 */
export function normalizePlatform(extractorKey?: string): string {
  if (!extractorKey) return 'unknown';
  const key = extractorKey.toLowerCase().split(':')[0];
  if (key.includes('youtube')) return 'youtube';
  if (key.includes('tiktok')) return 'tiktok';
  if (key.includes('twitter')) return 'twitter';
  if (key.includes('facebook')) return 'facebook';
  if (key.includes('instagram')) return 'instagram';
  return key;
}

function isStoryboard(f: RawFormat): boolean {
  if (f.ext === 'mhtml') return true;
  const note = (f.format_note ?? '').toLowerCase();
  return note.includes('storyboard');
}

/**
 * Keep only directly downloadable formats, in two tiers:
 *
 * Tier 1 — progressive direct files over plain https (single files the client
 * can download as-is). Some extractors (twitter, facebook) report NO
 * vcodec/acodec on these, so only exclude a direct file when we KNOW it is a
 * split stream (explicit 'none' on one side, real codec on the other).
 *
 * Tier 2 — explicitly muxed streams (both codecs present, not 'none'),
 * regardless of protocol (e.g. YouTube 360p/720p progressive, muxed HLS).
 *
 * Split-only streams (DASH video-only / audio-only, video-only HLS) are never
 * returned: they are not playable on their own and the client has no ffmpeg
 * to merge them. Sorts each tier by resolution, then size, then bitrate —
 * best first. Returns at most `limit` entries.
 */
export function filterPlayableFormats(
  rawFormats: RawFormat[] | undefined,
  limit = 4,
): MediaFormatDto[] {
  if (!Array.isArray(rawFormats) || rawFormats.length === 0) return [];

  const candidates = rawFormats.filter((f) => !!f.url && !isStoryboard(f));
  const picked = new Set<RawFormat>();

  const direct = candidates.filter((f) => {
    const proto = f.protocol ?? (f.url!.startsWith('http') ? 'https' : '');
    return (
      (proto === 'https' || proto === 'http') &&
      !isKnownVideoOnly(f) &&
      !isKnownAudioOnly(f)
    );
  });
  const muxed = candidates.filter(
    (f) =>
      f.vcodec != null &&
      f.vcodec !== 'none' &&
      f.acodec != null &&
      f.acodec !== 'none',
  );

  const ordered = [...sortFormats(direct), ...sortFormats(muxed)].filter((f) =>
    picked.has(f) ? false : (picked.add(f), true),
  );

  return ordered.slice(0, limit).map(toDto);
}

function isKnownVideoOnly(f: RawFormat): boolean {
  return f.vcodec != null && f.vcodec !== 'none' && f.acodec === 'none';
}

function isKnownAudioOnly(f: RawFormat): boolean {
  return f.acodec != null && f.acodec !== 'none' && f.vcodec === 'none';
}

function effectiveHeight(f: RawFormat): number {
  if (f.height) return f.height;
  const m = /(\d+)\s*x\s*(\d+)/.exec(f.resolution ?? '');
  return m ? Number(m[2]) : 0;
}

function effectiveSize(f: RawFormat): number {
  return f.filesize ?? f.filesize_approx ?? 0;
}

function sortFormats(formats: RawFormat[]): RawFormat[] {
  return [...formats].sort((a, b) => {
    const ha = effectiveHeight(a);
    const hb = effectiveHeight(b);
    if (hb !== ha) return hb - ha;
    const sa = effectiveSize(a);
    const sb = effectiveSize(b);
    if (sb !== sa) return sb - sa;
    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });
}

function toDto(f: RawFormat): MediaFormatDto {
  let quality: string;
  const h = effectiveHeight(f);
  if (h) {
    quality = `${h}p`;
  } else if (f.format_note && /\d+p/.test(f.format_note)) {
    quality = f.format_note.match(/\d+p/)![0];
  } else {
    quality = f.format_id ?? 'default';
  }
  return {
    quality,
    ext: f.ext ?? 'mp4',
    url: f.url!,
    approxFilesizeBytes: f.filesize ?? f.filesize_approx ?? undefined,
    headers: f.http_headers ?? undefined,
  };
}

export function guessImageExt(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.gif')) return 'gif';
  return 'jpg';
}
