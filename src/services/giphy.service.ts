// Animated art for rhymes: search Giphy in the portal, re-host what an admin picks.
//
// ── Why this is admin-only, and why we copy the bytes ──────────────────────
// A nursery rhyme wants motion — a bee that actually buzzes, a star that
// twinkles — and commissioning original animation for 45 rhymes is not a
// week-one option. Giphy has the art. It also has everything else, and its own
// `rating=g` filter is documented as leaky, so it cannot be the safety
// boundary for a children's app.
//
// So the boundary is a person:
//
//   1. The search runs SERVER-SIDE from the content portal. The API key never
//      reaches the app, and no child's device ever contacts Giphy.
//   2. An adult looks at the clip and picks it.
//   3. We download it and store it in OUR bucket. The pack points at our URL.
//
// Step 3 matters beyond safety. Hotlinking a third-party CDN means a published
// pack can silently change or 404 when someone else edits their library, and
// it puts a children's-app request on a host we don't control. A copied file
// can't be swapped out from under a child mid-story.
//
// `rating=g` is still passed — it costs nothing and thins the haystack — but it
// is a convenience, not the guarantee.

import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.LOG_LEVEL });

const GIPHY_SEARCH = 'https://api.giphy.com/v1/gifs/search';

/** What we accept back from an import. Anything else — HTML, video, an SVG that
 *  could carry script — is refused even if Giphy served it. */
const IMPORTABLE_MIMES = ['image/gif', 'image/webp'] as const;

/** Hosts an import may fetch from. An import URL comes from our own search
 *  response, but the endpoint takes a URL, so it is pinned rather than trusted:
 *  without this the route would be an open server-side fetch proxy. */
const ALLOWED_HOSTS = ['media.giphy.com', 'i.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com', 'media3.giphy.com', 'media4.giphy.com'];

export class GiphyUnavailableException extends Error {
  constructor() {
    super('GIPHY_API_KEY is not configured');
    this.name = 'GiphyUnavailableException';
  }
}

export class GifImportRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GifImportRejected';
  }
}

/** One search hit, trimmed to what the portal grid needs. */
export interface GifResult {
  id: string;
  title: string;
  /** Small looping preview for the result grid — cheap to render 24 of. */
  previewUrl: string;
  /** The file an import would copy: downsized, still animated. */
  importUrl: string;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
}

interface GiphyImage {
  url?: string;
  webp?: string;
  width?: string;
  height?: string;
  size?: string;
  webp_size?: string;
}

interface GiphyItem {
  id?: string;
  title?: string;
  images?: Record<string, GiphyImage>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Picks the rendition to import: WebP when Giphy offers one (a third the
 *  bytes of the equivalent GIF, and Flutter animates both), else the GIF. */
function renditionOf(item: GiphyItem): { url: string; mime: string; byteLength: number } | null {
  const images = item.images ?? {};
  // `downsized` is capped around 2 MB by Giphy and keeps the animation; the
  // `original` is frequently 8 MB+ for no visible gain at phone size.
  for (const name of ['downsized', 'fixed_height', 'original']) {
    const image = images[name];
    if (!image) continue;
    if (image.webp) {
      return { url: image.webp, mime: 'image/webp', byteLength: num(image.webp_size) };
    }
    if (image.url) {
      return { url: image.url, mime: 'image/gif', byteLength: num(image.size) };
    }
  }
  return null;
}

export class GiphyService {
  get isConfigured(): boolean {
    return Boolean(config.GIPHY_API_KEY);
  }

  /** Search, trimmed to importable results. A hit with no usable rendition is
   *  dropped rather than shown — an admin clicking it would only get an error. */
  async search(query: string, limit = 24): Promise<GifResult[]> {
    if (!config.GIPHY_API_KEY) throw new GiphyUnavailableException();

    const url = new URL(GIPHY_SEARCH);
    url.searchParams.set('api_key', config.GIPHY_API_KEY);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set('rating', 'g');
    url.searchParams.set('lang', 'en');

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Giphy ${response.status}: ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as { data?: GiphyItem[] };
    const results: GifResult[] = [];

    for (const item of body.data ?? []) {
      const rendition = renditionOf(item);
      if (!rendition) continue;
      const preview = item.images?.['fixed_width_small'] ?? item.images?.['preview_gif'];
      const size = item.images?.['downsized'] ?? item.images?.['original'];
      results.push({
        id: String(item.id ?? ''),
        title: String(item.title ?? '').trim() || 'Untitled',
        previewUrl: preview?.webp ?? preview?.url ?? rendition.url,
        importUrl: rendition.url,
        mime: rendition.mime,
        width: num(size?.width),
        height: num(size?.height),
        byteLength: rendition.byteLength,
      });
    }
    return results;
  }

  /**
   * Downloads one approved clip into memory, ready to be stored.
   *
   * Everything here is a refusal, not a repair: an unexpected host, an
   * unexpected type or an oversized file is rejected outright rather than
   * truncated or converted. This is the one place the server fetches a URL a
   * client handed it, so it stays deliberately narrow.
   */
  async fetchForImport(rawUrl: string): Promise<{ bytes: Buffer; mime: string; filename: string }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new GifImportRejected('That is not a valid URL');
    }

    if (url.protocol !== 'https:') {
      throw new GifImportRejected('Only https URLs can be imported');
    }
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
      throw new GifImportRejected(
        `Imports are limited to Giphy media hosts — ${url.hostname} is not one`,
      );
    }

    const response = await fetch(url, {
      // Never follow a redirect off the allowlisted host we just checked.
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new GifImportRejected(`Could not download that clip (${response.status})`);
    }

    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!(IMPORTABLE_MIMES as readonly string[]).includes(mime)) {
      throw new GifImportRejected(`Expected an animated GIF or WebP, got "${mime || 'nothing'}"`);
    }

    const maxBytes = config.GIF_MAX_IMPORT_MB * 1024 * 1024;
    // Trust the header when it's there so an oversized file is refused before
    // it's read; re-check afterwards because the header is only a claim.
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      throw new GifImportRejected(`That clip is larger than the ${config.GIF_MAX_IMPORT_MB} MB limit`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new GifImportRejected(`That clip is larger than the ${config.GIF_MAX_IMPORT_MB} MB limit`);
    }

    const extension = mime === 'image/webp' ? 'webp' : 'gif';
    const stem = url.pathname.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'clip';
    logger.info({ host: url.hostname, mime, bytes: bytes.length }, 'gif imported');

    return { bytes, mime, filename: `${stem}.${extension}` };
  }
}

export const giphyService = new GiphyService();
