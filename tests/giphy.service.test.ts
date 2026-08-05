import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GiphyService, GifImportRejected } from '../src/services/giphy.service';
import { config } from '../src/config';

// The import endpoint is the only place this server fetches a URL a client
// handed it, so most of what's worth testing here is what it REFUSES.

const original = { key: config.GIPHY_API_KEY, max: config.GIF_MAX_IMPORT_MB };

function giphyPayload(): unknown {
  return {
    data: [
      {
        id: 'abc',
        title: 'happy bee',
        images: {
          downsized: { url: 'https://media.giphy.com/media/abc/downsized.gif', size: '90000', width: '320', height: '240' },
          fixed_width_small: { webp: 'https://media.giphy.com/media/abc/small.webp' },
        },
      },
      {
        id: 'webp-preferred',
        title: 'twinkle star',
        images: {
          downsized: {
            url: 'https://media.giphy.com/media/star/downsized.gif',
            webp: 'https://media.giphy.com/media/star/downsized.webp',
            size: '400000',
            webp_size: '120000',
            width: '480',
            height: '480',
          },
        },
      },
      // No usable rendition — an admin clicking this would only get an error.
      { id: 'empty', title: 'nothing', images: {} },
    ],
  };
}

describe('GiphyService.search', () => {
  beforeEach(() => {
    config.GIPHY_API_KEY = 'test-key';
  });
  afterEach(() => {
    config.GIPHY_API_KEY = original.key;
    vi.unstubAllGlobals();
  });

  it('asks for g-rated results only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => giphyPayload() })));
    await new GiphyService().search('bee');

    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('rating')).toBe('g');
    expect(url.searchParams.get('q')).toBe('bee');
  });

  it('prefers the WebP rendition — same animation, a third the bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => giphyPayload() })));
    const results = await new GiphyService().search('star');

    const star = results.find((r) => r.id === 'webp-preferred');
    expect(star?.importUrl).toBe('https://media.giphy.com/media/star/downsized.webp');
    expect(star?.mime).toBe('image/webp');
    expect(star?.byteLength).toBe(120000);
  });

  it('drops hits with no importable file rather than showing a dead tile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => giphyPayload() })));
    const results = await new GiphyService().search('bee');
    expect(results.map((r) => r.id)).toEqual(['abc', 'webp-preferred']);
  });
});

describe('GiphyService.fetchForImport', () => {
  const gif = (bytes: number): unknown => ({
    ok: true,
    headers: new Headers({ 'content-type': 'image/gif', 'content-length': String(bytes) }),
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });

  afterEach(() => {
    config.GIF_MAX_IMPORT_MB = original.max;
    vi.unstubAllGlobals();
  });

  it('copies an approved clip into memory, ready to store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gif(1000)));
    const result = await new GiphyService().fetchForImport(
      'https://media.giphy.com/media/abc/downsized.gif',
    );

    expect(result.bytes).toHaveLength(1000);
    expect(result.mime).toBe('image/gif');
    // Named from the Giphy id, so the library listing is recognisable.
    expect(result.filename).toBe('abc.gif');
  });

  it('refuses a host that is not Giphy — this is not an open fetch proxy', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      new GiphyService().fetchForImport('https://evil.example.com/payload.gif'),
    ).rejects.toBeInstanceOf(GifImportRejected);
    // Refused before any request went out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses plain http', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      new GiphyService().fetchForImport('http://media.giphy.com/media/abc/downsized.gif'),
    ).rejects.toThrow(/https/);
  });

  it('refuses a file that is not an animated image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new Uint8Array(10).buffer,
      })),
    );
    await expect(
      new GiphyService().fetchForImport('https://media.giphy.com/media/abc/x.gif'),
    ).rejects.toThrow(/GIF or WebP/);
  });

  it('refuses an oversized clip before reading it', async () => {
    config.GIF_MAX_IMPORT_MB = 1;
    const arrayBuffer = vi.fn(async () => new Uint8Array(10).buffer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({
          'content-type': 'image/gif',
          'content-length': String(5 * 1024 * 1024),
        }),
        arrayBuffer,
      })),
    );

    await expect(
      new GiphyService().fetchForImport('https://media.giphy.com/media/abc/x.gif'),
    ).rejects.toThrow(/1 MB limit/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('still refuses when the declared length lied about the size', async () => {
    config.GIF_MAX_IMPORT_MB = 1;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        // Claims to be tiny, actually is not.
        headers: new Headers({ 'content-type': 'image/gif', 'content-length': '10' }),
        arrayBuffer: async () => new Uint8Array(3 * 1024 * 1024).buffer,
      })),
    );

    await expect(
      new GiphyService().fetchForImport('https://media.giphy.com/media/abc/x.gif'),
    ).rejects.toThrow(/1 MB limit/);
  });

  it('never follows a redirect off the host it just checked', async () => {
    const fetchSpy = vi.fn(async () => gif(10));
    vi.stubGlobal('fetch', fetchSpy);
    await new GiphyService().fetchForImport('https://media.giphy.com/media/abc/x.gif');

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
});
