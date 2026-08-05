import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import svgpath from 'svgpath';
import type { TracedArt, TracedRegion } from './coloring.trace';

// Imports a vector SVG ILLUSTRATION straight into the app's coloring format —
// no rasterizing, no tracing. Each colored shape in the SVG becomes a fillable
// `region` with its EXACT geometry (so the page renders pixel-perfect), the
// dark ink shapes become solid `details`, and every fillable shape is also
// outlined so an uncolored page reads like a coloring book.
//
// This only works when the SVG is built as filled shapes (one per colorable
// area) — i.e. a real illustration. A pure line-art SVG (just strokes, no fills)
// has no region geometry to import; the caller falls back to raster tracing
// (see coloring.trace.ts) for those. `wouldImport()` reports which case applies.

const VIEW_BOX = 100; // app canvas is a 100x100 viewBox
const MAX_REGIONS = 16; // cap fillable cells so kids get a sane number of taps
const DARK_LUM = 0.28; // fill darker than this is "ink" (details), not a fill area
const MIN_REGIONS = 4; // below this we don't consider the SVG a usable illustration

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0]; // placeholder, replaced below
const ID: Matrix = [1, 0, 0, 1, 0, 0];

/** Multiply two SVG affine matrices: result applies `m2` then `m1` (m1 ∘ m2). */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Parse a `transform` attribute (matrix/translate/scale/rotate/skew, possibly
 *  several in one attribute) into a single affine matrix. */
function parseTransform(value: string | undefined): Matrix {
  if (!value) return ID;
  let m: Matrix = ID;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const fn = match[1];
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Matrix = ID;
    switch (fn) {
      case 'matrix':
        if (args.length === 6) t = args as Matrix;
        break;
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((args[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          const cx = args[1];
          const cy = args[2];
          t = multiply([1, 0, 0, 1, cx, cy], multiply(rot, [1, 0, 0, 1, -cx, -cy]));
        } else {
          t = rot;
        }
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

/** Relative luminance (0=black, 1=white) of an SVG color, or null if no paint. */
function luminance(color: string | undefined): number | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c === 'none' || c === 'transparent') return null;
  const named: Record<string, number> = { black: 0, white: 1 };
  if (c in named) return named[c];
  let r = 0;
  let g = 0;
  let b = 0;
  let mm: RegExpMatchArray | null;
  if ((mm = c.match(/^#([0-9a-f]{3})$/))) {
    r = parseInt(mm[1][0] + mm[1][0], 16);
    g = parseInt(mm[1][1] + mm[1][1], 16);
    b = parseInt(mm[1][2] + mm[1][2], 16);
  } else if ((mm = c.match(/^#([0-9a-f]{6})$/))) {
    r = parseInt(mm[1].slice(0, 2), 16);
    g = parseInt(mm[1].slice(2, 4), 16);
    b = parseInt(mm[1].slice(4, 6), 16);
  } else if ((mm = c.match(/rgba?\(([^)]+)\)/))) {
    const parts = mm[1].split(/[\s,]+/).map(Number);
    [r, g, b] = parts;
  } else {
    return 0.5; // unknown color → treat as a mid fill (a region, not ink)
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Read a presentation property from either the attribute or the inline style. */
function prop(el: Element, name: string): string | undefined {
  const attrs = el.attribs || {};
  const style = attrs.style;
  if (style) {
    const m = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, 'i'));
    if (m) return m[1].trim();
  }
  return attrs[name];
}

/** Convert basic shapes to a path `d`; passes <path> through unchanged. */
function shapeToPath(el: Element): string | null {
  const a = el.attribs || {};
  const num = (v: string | undefined): number => (v ? parseFloat(v) : 0);
  switch (el.tagName) {
    case 'path':
      return a.d || null;
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      if (w <= 0 || h <= 0) return null;
      return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    }
    case 'circle': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const r = num(a.r);
      if (r <= 0) return null;
      return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
    }
    case 'ellipse': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = num(a.rx);
      const ry = num(a.ry);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    case 'polygon':
    case 'polyline': {
      const pts = (a.points || '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length - 1; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
      return el.tagName === 'polygon' ? `${d} Z` : d;
    }
    case 'line':
      return `M${num(a.x1)} ${num(a.y1)} L${num(a.x2)} ${num(a.y2)}`;
    default:
      return null;
  }
}

/** Ensure every subpath of `d` ends with an explicit Z (the app validates it). */
function closeSubpaths(d: string): string {
  return d
    .trim()
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[zZ]\s*$/.test(s) ? s : `${s} Z`))
    .join(' ');
}

interface Collected {
  regions: string[]; // colored/light fills → fillable areas
  details: string[]; // dark fills → solid ink
  outlines: string[]; // stroked, no fill → line art
}

/** Parse the SVG into classified, 0..VIEW_BOX path strings. */
function collect(svg: string): Collected {
  const $ = cheerio.load(svg, { xmlMode: true });
  const root = $('svg').first();
  if (root.length === 0) throw new Error('No <svg> root element found');

  // Map the SVG's own coordinate space into the app's 0..VIEW_BOX box.
  const vb = (root.attr('viewBox') || '').split(/[\s,]+/).map(Number);
  let minX = 0;
  let minY = 0;
  let srcW = parseFloat(root.attr('width') || '') || VIEW_BOX;
  let srcH = parseFloat(root.attr('height') || '') || VIEW_BOX;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    [minX, minY, srcW, srcH] = vb;
  }
  const s = VIEW_BOX / Math.max(srcW, srcH);
  const base: Matrix = [s, 0, 0, s, -minX * s, -minY * s];

  const out: Collected = { regions: [], details: [], outlines: [] };
  const skipTags = new Set(['defs', 'clippath', 'mask', 'symbol', 'metadata', 'title', 'desc', 'style']);

  const walk = (node: Element, m: Matrix, fill?: string, stroke?: string): void => {
    if (node.type !== 'tag') return;
    const tag = node.tagName.toLowerCase();
    if (skipTags.has(tag)) return;

    const m2 = multiply(m, parseTransform(node.attribs?.transform));
    const fill2 = prop(node, 'fill') ?? fill;
    const stroke2 = prop(node, 'stroke') ?? stroke;

    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const child of node.children as Element[]) walk(child, m2, fill2, stroke2);
      return;
    }

    const rawD = shapeToPath(node);
    if (!rawD) return;

    // Skip a full-canvas background rectangle (it's the page, not a fill area).
    if (tag === 'rect') {
      const w = parseFloat(node.attribs.width || '0');
      const h = parseFloat(node.attribs.height || '0');
      if (w >= srcW * 0.98 && h >= srcH * 0.98) return;
    }

    let d: string;
    try {
      d = svgpath(rawD).matrix(m2).unarc().abs().round(3).toString();
    } catch {
      return; // unparseable path — skip rather than fail the whole import
    }
    if (!d) return;

    const fillLum = luminance(fill2 === undefined ? '#000' : fill2); // SVG default fill is black
    const strokeLum = luminance(stroke2);

    if (fillLum !== null) {
      if (fillLum < DARK_LUM) out.details.push(d);
      else out.regions.push(closeSubpaths(d));
    } else if (strokeLum !== null) {
      out.outlines.push(d); // stroked outline, no fill
    }
  };

  walk(root.get(0) as Element, base, undefined, undefined);
  return out;
}

/** True when the SVG is a fillable illustration we can import directly (vs a
 *  line-art SVG that must be raster-traced). */
export function svgIsFillableIllustration(svg: string): boolean {
  try {
    return collect(svg).regions.length >= MIN_REGIONS;
  } catch {
    return false;
  }
}

/** Import a filled SVG illustration directly into the app's coloring format.
 *  Throws if it isn't a usable illustration (caller should raster-trace). */
export function svgToColoringPage(svg: string): TracedArt {
  const c = collect(svg);
  if (c.regions.length < MIN_REGIONS) {
    throw new Error(
      'SVG has no fillable color shapes to import directly (it looks like ' +
        'line art) — falling back to tracing.'
    );
  }

  const fills = c.regions.slice(0, MAX_REGIONS);
  const regions: TracedRegion[] = [
    // Full-canvas background, hit-tested last so real shapes win a tap.
    { id: 'background', d: `M0 0 H${VIEW_BOX} V${VIEW_BOX} H0 Z`, byNumber: 5 },
  ];
  fills.forEach((d, i) => {
    regions.push({ id: `region-${i + 1}`, d, byNumber: 1 + (i % 6) });
  });

  // Outline every fillable shape so an uncolored page reads like a coloring
  // book, then keep any genuine line-art outlines from the source too.
  const outlines = [...fills, ...c.outlines];

  return { regions, outlines, details: c.details };
}

// Silence unused-strict-import lint for the placeholder identity.
void IDENTITY;
