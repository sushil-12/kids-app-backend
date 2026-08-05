import sharp from 'sharp';
import { Potrace, PotraceOptions } from 'potrace';
import pino from 'pino';
import { config } from '../config';
import { svgToColoringPage } from './svg.import';

// Dedicated logger for the SVG/raster → coloring-page transform. The concise
// one-line summary always logs at info; the per-element classification trace is
// gated behind DEBUG_SVG_IMPORT=true so it doesn't spam production logs.
const logger = pino({ level: config.LOG_LEVEL }).child({ module: 'coloring.trace' });
const VERBOSE = process.env.DEBUG_SVG_IMPORT === 'true';
const dbg = (obj: Record<string, unknown>, msg: string): void => {
  if (VERBOSE) logger.debug(obj, msg);
};

// Turns a generated coloring-book IMAGE (black line art on white) into the
// vector shape the BrightMind app needs: closed fillable `regions` (the white
// cells a child taps), plus the line art itself as solid-black `details` drawn
// on top. This is what lets an image model — which can actually draw a
// recognizable subject — feed the app's tap-to-fill (`Path.contains`) model.
//
// Pipeline: threshold → seal hairline gaps → label the enclosed white cells
// (connected components) → trace each cell and the line art with potrace,
// scaled straight into the app's 0..VIEW_BOX coordinate space.

const VIEW_BOX = 100; // app canvas is a 100x100 viewBox
const WORK = 1024; // working raster resolution (px); matches the generated image
                   // so bold outlines aren't downsampled into hairline gaps that
                   // merge cells. Flood-fill/dilate stay O(n) so cost is linear.
const MAX_REGIONS = 14; // cap tappable cells so kids get a sane number of taps
const MIN_REGION_FRAC = 0.0015; // ignore cells smaller than this fraction of canvas
const MAX_INK_FRAC = 0.3; // above this the image is filled/silhouette art, not
                          // outline line art (outline ~13%, silhouette ~48%)
const SEAL_ITERS = Math.round(WORK / 512); // dilation passes to close hairline gaps,
                                           // scaled to resolution (2 at 1024px)
const TURD = Math.round(8 * (WORK / 512) ** 2); // potrace speckle area (px²), scales
                                                // with resolution so dust is dropped

export interface TracedRegion {
  id: string;
  d: string;
  byNumber: number;
}

export interface TracedArt {
  regions: TracedRegion[];
  outlines: string[];
  details: string[];
}

/** Promise wrapper around a single potrace run that returns just the `d`
 *  attribute, scaled from `srcSize` px into the 0..VIEW_BOX space and with
 *  every subpath explicitly closed (potrace omits the closing `Z`). */
function tracePathD(png: Buffer, srcSize: number, params: PotraceOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = new Potrace(params);
    // potrace invokes this as `callback.call(self, err)`: `this` is the Potrace
    // instance and the ONLY argument is the error (null on success). The shipped
    // typings wrongly declare a `(potrace, error)` two-arg callback, so we take
    // the single real arg as `err`, use the captured `p`, and cast to satisfy
    // the stale type. Using a `self` parameter would bind it to the (null) error
    // and crash on `.getPathTag`.
    const onLoad = (err: Error | null): void => {
      if (err) return reject(err);
      const s = VIEW_BOX / srcSize;
      // getPathTag's `scale` is actually a {x,y} object internally; the typings
      // say `number`, so cast. This emits coords already in the 0..100 viewBox.
      const tag = p.getPathTag('#000', { x: s, y: s } as unknown as number);
      const m = tag.match(/ d="([^"]*)"/);
      resolve(m ? closeSubpaths(m[1]) : '');
    };
    p.loadImage(png, onLoad as unknown as (potrace: Potrace, error: Error | null) => void);
  });
}

/** potrace renders each contour as `M … C … L …` with no terminator. The app
 *  parses paths into Flutter `Path`s (even-odd) and validates a trailing `Z`,
 *  so close every subpath. */
function closeSubpaths(d: string): string {
  return d
    .trim()
    .split(/(?=M)/)
    .map((sub) => sub.trim())
    .filter(Boolean)
    .map((sub) => (/[zZ]\s*$/.test(sub) ? sub : `${sub} Z`))
    .join(' ');
}

/** Encodes a 1-channel raster (0 = black, 255 = white) as a PNG for potrace. */
function maskToPng(mask: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(mask), { raw: { width: WORK, height: WORK, channels: 1 } })
    .png()
    .toBuffer();
}

// ===== MAIN EXPORT =====

/** Rasterize-then-trace pipeline: threshold → seal hairline gaps → label the
 *  enclosed white cells (connected components) → trace each cell and the line
 *  art with potrace, scaled into the app's 0..VIEW_BOX space. Used for raw
 *  PNG/JPEG uploads AND as the fallback when a structured SVG import isn't a
 *  fillable illustration (e.g. pure stroke line-art). sharp accepts SVG
 *  buffers directly, so the SVG fallback just hands the SVG buffer in here. */
async function rasterToColoringPage(image: Buffer): Promise<TracedArt> {
  const { data } = await sharp(image, { density: 384 })
    .resize(WORK, WORK, { fit: 'fill' })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = WORK * WORK;
  const isLine = new Uint8Array(n);
  let darkCount = 0;
  for (let i = 0; i < n; i++) {
    const dark = data[i] < 128 ? 1 : 0;
    isLine[i] = dark;
    darkCount += dark;
  }

  const inkFrac = darkCount / n;
  logger.debug({ inkFrac: Number(inkFrac.toFixed(4)), maxInkFrac: MAX_INK_FRAC }, 'raster ink fraction');
  if (inkFrac > MAX_INK_FRAC) {
    logger.error({ inkPct: Math.round(inkFrac * 100), maxInkPct: Math.round(MAX_INK_FRAC * 100) }, 'raster reject: too much ink (silhouette/fill, not line art)');
    throw new Error(
      `Image is ${Math.round(inkFrac * 100)}% black — that's a filled/silhouette ` +
        `picture, not line art. Use an outline-only coloring page (white inside, ` +
        `thin black outlines).`
    );
  }

  let sealed: Uint8Array = isLine;
  for (let s = 0; s < SEAL_ITERS; s++) sealed = dilate(sealed);

  const { labels, components } = labelWhiteComponents(sealed);

  const minArea = Math.floor(n * MIN_REGION_FRAC);
  const cells = components
    .filter((c) => !c.touchesBorder && c.size >= minArea)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_REGIONS);

  logger.debug(
    { whiteComponents: components.length, touchesBorder: components.filter((c) => c.touchesBorder).length, belowMinArea: components.length - cells.length, candidateCells: cells.length, minAreaPx: minArea },
    'raster connected components',
  );

  const regions: TracedRegion[] = [
    { id: 'background', d: `M0 0 H${VIEW_BOX} V${VIEW_BOX} H0 Z`, byNumber: 5 },
  ];

  let idx = 0;
  let traceFailures = 0;
  for (const cell of cells) {
    const mask = new Uint8Array(n).fill(255);
    for (let i = 0; i < n; i++) if (labels[i] === cell.label) mask[i] = 0;
    const d = await tracePathD(await maskToPng(mask), WORK, {
      turdSize: Math.round(TURD * 0.6),
      optCurve: true,
      blackOnWhite: true,
      threshold: 128,
    });
    if (d) {
      idx += 1;
      regions.push({ id: `region-${idx}`, d, byNumber: 1 + (idx % 6) });
      dbg({ region: idx, cellSize: cell.size }, 'raster cell traced');
    } else {
      traceFailures++;
    }
  }

  const lineMask = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) if (isLine[i]) lineMask[i] = 0;
  const detailsD = await tracePathD(await maskToPng(lineMask), WORK, {
    turdSize: TURD,
    optCurve: true,
    blackOnWhite: true,
    threshold: 128,
  });

  logger.info(
    { kind: 'raster', fillableRegions: regions.length - 1, candidateCells: cells.length, traceFailures, outlines: 0, details: detailsD ? 1 : 0, inkPct: Math.round(inkFrac * 100) },
    'raster transform done',
  );

  return {
    regions,
    outlines: [],
    details: detailsD ? [detailsD] : [],
  };
}

export async function imageToColoringPage(image: Buffer): Promise<TracedArt> {
  // DETECT INPUT TYPE
  const isSvg = image.length > 0 &&
    (image.toString('utf8', 0, 100).includes('<svg') ||
     image.toString('utf8', 0, 100).includes('<?xml'));

  logger.info({ bytes: image.length, kind: isSvg ? 'svg' : 'raster' }, 'coloring transform start');

  if (isSvg) {
    const svgContent = image.toString('utf8');
    // Prefer the structured importer (svg.import.ts): it walks the tree,
    // accumulates every <g>/element transform, normalizes the SVG viewBox
    // into the app's 0..100 space, and classifies shapes by fill luminance
    // (light fills → regions, dark fills → details, strokes → outlines, and
    // a full-canvas background rect is skipped). This is what makes a real
    // multi-group illustration render correctly — the old flattening parser
    // dropped group transforms and squashed everything into the wrong coords.
    try {
      const art = svgToColoringPage(svgContent);
      logger.info(
        { kind: 'svg', via: 'structured', fillableRegions: art.regions.length - 1, outlines: art.outlines.length, details: art.details.length },
        'SVG transform done',
      );
      return art;
    } catch (err) {
      // Not a fillable illustration (pure stroke line-art, or a single
      // silhouette with <4 light-fill regions) — rasterize via sharp, which
      // respects the viewBox + transforms, and run the potrace tracer.
      logger.warn(
        { reason: err instanceof Error ? err.message : String(err), svgLen: svgContent.length },
        'SVG structured import failed; falling back to raster trace',
      );
      return rasterToColoringPage(Buffer.from(svgContent));
    }
  }

  return rasterToColoringPage(image);
}

/** 1px morphological dilation of the black mask (4-neighborhood). */
function dilate(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < WORK; y++) {
    for (let x = 0; x < WORK; x++) {
      const i = y * WORK + x;
      if (
        src[i] ||
        (x > 0 && src[i - 1]) ||
        (x < WORK - 1 && src[i + 1]) ||
        (y > 0 && src[i - WORK]) ||
        (y < WORK - 1 && src[i + WORK])
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

interface Component {
  label: number;
  size: number;
  touchesBorder: boolean;
}

/** Flood-fills connected white (non-line) cells, 4-connectivity. */
function labelWhiteComponents(line: Uint8Array): {
  labels: Int32Array;
  components: Component[];
} {
  const labels = new Int32Array(line.length).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < line.length; start++) {
    if (line[start] || labels[start] !== -1) continue;
    const label = components.length;
    let size = 0;
    let touchesBorder = false;
    stack.push(start);
    labels[start] = label;

    while (stack.length) {
      const i = stack.pop() as number;
      size += 1;
      const x = i % WORK;
      const y = (i / WORK) | 0;
      if (x === 0 || y === 0 || x === WORK - 1 || y === WORK - 1) touchesBorder = true;

      if (x > 0 && !line[i - 1] && labels[i - 1] === -1) {
        labels[i - 1] = label;
        stack.push(i - 1);
      }
      if (x < WORK - 1 && !line[i + 1] && labels[i + 1] === -1) {
        labels[i + 1] = label;
        stack.push(i + 1);
      }
      if (y > 0 && !line[i - WORK] && labels[i - WORK] === -1) {
        labels[i - WORK] = label;
        stack.push(i - WORK);
      }
      if (y < WORK - 1 && !line[i + WORK] && labels[i + WORK] === -1) {
        labels[i + WORK] = label;
        stack.push(i + WORK);
      }
    }

    components.push({ label, size, touchesBorder });
  }

  return { labels, components };
}
