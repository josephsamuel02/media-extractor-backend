import { MediaFormatDto } from '../dto/extraction-result.dto';

interface RawFormat {
  url?: string;
  ext?: string;
  height?: number;
  width?: number;
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
 * Keep only pre-muxed, directly downloadable formats:
 * both audio + video tracks present (acodec/vcodec !== 'none').
 * Sorts by height desc, then bitrate desc. Returns top N.
 */
export function filterPlayableFormats(
  rawFormats: RawFormat[] | undefined,
  limit = 4,
): MediaFormatDto[] {
  if (!Array.isArray(rawFormats) || rawFormats.length === 0) return [];

  const playable = rawFormats.filter(
    (f) =>
      !!f.url &&
      !isStoryboard(f) &&
      f.vcodec !== 'none' &&
      f.acodec !== 'none' &&
      f.vcodec != null &&
      f.acodec != null,
  );

  playable.sort((a, b) => {
    const ha = a.height ?? 0;
    const hb = b.height ?? 0;
    if (hb !== ha) return hb - ha;
    return (b.tbr ?? 0) - (a.tbr ?? 0);
  });

  return playable.slice(0, limit).map((f) => {
    let quality: string;
    if (f.height) {
      quality = `${f.height}p`;
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
  });
}

export function guessImageExt(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.gif')) return 'gif';
  return 'jpg';
}
