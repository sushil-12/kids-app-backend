// SVG ports of the 4 bundled Flutter pages (see the app's coloring_templates.dart).
// The geometry here mirrors the Dart helpers exactly so a seeded page renders
// identically to the offline one — this proves the backend->app pipeline.
// Each builder returns an SVG path "d" string in the 100x100 viewBox.

type Pt = { x: number; y: number };

function n(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

// A full circle as two semicircle arcs (path_drawing parses 'A' on the app side).
function circle(cx: number, cy: number, r: number): string {
  return `M ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`;
}

function oval(cx: number, cy: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`;
}

function rect(l: number, t: number, w: number, h: number): string {
  return `M ${n(l)} ${n(t)} H ${n(l + w)} V ${n(t + h)} H ${n(l)} Z`;
}

function triangle(a: Pt, b: Pt, c: Pt): string {
  return `M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)} L ${n(c.x)} ${n(c.y)} Z`;
}

// Mirrors Flutter's Path.addArc(rect, startAngle, sweepAngle) for a single arc.
function arc(cx: number, cy: number, r: number, start: number, sweep: number): string {
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  const ex = cx + r * Math.cos(start + sweep);
  const ey = cy + r * Math.sin(start + sweep);
  const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
  const sweepFlag = sweep >= 0 ? 1 : 0;
  return `M ${n(sx)} ${n(sy)} A ${n(r)} ${n(r)} 0 ${largeArc} ${sweepFlag} ${n(ex)} ${n(ey)}`;
}

const fullBackground = (): string => rect(0, 0, 100, 100);

// ---- SUN ----
function sunRays(): string {
  const cx = 50;
  const cy = 47;
  const count = 12;
  let d = '';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 2 * Math.PI;
    const tx = cx + 42 * Math.cos(a);
    const ty = cy + 42 * Math.sin(a);
    const b1x = cx + 26 * Math.cos(a - 0.14);
    const b1y = cy + 26 * Math.sin(a - 0.14);
    const b2x = cx + 26 * Math.cos(a + 0.14);
    const b2y = cy + 26 * Math.sin(a + 0.14);
    d += `M ${n(b1x)} ${n(b1y)} L ${n(tx)} ${n(ty)} L ${n(b2x)} ${n(b2y)} Z `;
  }
  return d.trim();
}

// ---- FLOWER ----
function flowerPetals(): string {
  const cx = 50;
  const cy = 38;
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 2 * Math.PI;
    d += oval(cx + 15 * Math.cos(a), cy + 15 * Math.sin(a), 18, 18) + ' ';
  }
  return d.trim();
}

export interface SeedRegion {
  id: string;
  d: string;
  byNumber?: number;
}

export interface SeedColoringPage {
  slug: string;
  title: string;
  isPremium: boolean;
  stickerRewardId: string;
  regions: SeedRegion[];
  outlines: string[];
  details: string[];
}

export const coloringSeedPages: SeedColoringPage[] = [
  {
    slug: 'sun',
    title: 'Happy Sun',
    isPremium: false,
    stickerRewardId: 'sun',
    regions: [
      { id: 'sky', d: fullBackground(), byNumber: 5 },
      { id: 'rays', d: sunRays(), byNumber: 2 },
      { id: 'body', d: circle(50, 47, 24), byNumber: 1 },
    ],
    outlines: [circle(50, 47, 24), sunRays(), arc(50, 49, 12, 0.25 * Math.PI, 0.5 * Math.PI)],
    details: [circle(42, 44, 2.4), circle(58, 44, 2.4)],
  },
  {
    slug: 'fish',
    title: 'Splashy Fish',
    isPremium: false,
    stickerRewardId: 'fish',
    regions: [
      { id: 'water', d: fullBackground(), byNumber: 5 },
      { id: 'tail', d: triangle({ x: 34, y: 52 }, { x: 14, y: 38 }, { x: 14, y: 66 }), byNumber: 2 },
      { id: 'fin', d: triangle({ x: 54, y: 38 }, { x: 44, y: 24 }, { x: 66, y: 32 }), byNumber: 1 },
      { id: 'body', d: oval(54, 52, 50, 32), byNumber: 3 },
      { id: 'eye', d: circle(68, 46, 5), byNumber: 6 },
    ],
    outlines: [
      oval(54, 52, 50, 32),
      triangle({ x: 34, y: 52 }, { x: 14, y: 38 }, { x: 14, y: 66 }),
      triangle({ x: 54, y: 38 }, { x: 44, y: 24 }, { x: 66, y: 32 }),
      circle(68, 46, 5),
      arc(76, 54, 5, 1.1 * Math.PI, 0.8 * Math.PI),
      `${circle(84, 36, 3)} ${circle(90, 28, 2)}`,
    ],
    details: [circle(69, 46, 2.2)],
  },
  {
    slug: 'flower',
    title: 'Sunny Flower',
    isPremium: true,
    stickerRewardId: 'flower',
    regions: [
      { id: 'sky', d: fullBackground(), byNumber: 5 },
      { id: 'stem', d: 'M 47 48 L 47 92 L 53 92 L 53 48 Z', byNumber: 4 },
      { id: 'leftLeaf', d: oval(36, 70, 22, 12), byNumber: 4 },
      { id: 'rightLeaf', d: oval(64, 78, 22, 12), byNumber: 4 },
      { id: 'petals', d: flowerPetals(), byNumber: 2 },
      { id: 'center', d: circle(50, 38, 10), byNumber: 1 },
    ],
    outlines: [
      flowerPetals(),
      circle(50, 38, 10),
      'M 47 48 L 47 92 L 53 92 L 53 48 Z',
      oval(36, 70, 22, 12),
      oval(64, 78, 22, 12),
    ],
    details: [],
  },
  {
    slug: 'house',
    title: 'Cozy House',
    isPremium: true,
    stickerRewardId: 'house',
    regions: [
      { id: 'sky', d: fullBackground(), byNumber: 5 },
      { id: 'sun', d: circle(84, 18, 9), byNumber: 1 },
      { id: 'wall', d: rect(28, 48, 44, 40), byNumber: 4 },
      { id: 'roof', d: triangle({ x: 22, y: 48 }, { x: 78, y: 48 }, { x: 50, y: 22 }), byNumber: 2 },
      { id: 'door', d: rect(44, 68, 12, 20), byNumber: 3 },
      { id: 'win1', d: rect(33, 54, 10, 10), byNumber: 6 },
      { id: 'win2', d: rect(57, 54, 10, 10), byNumber: 6 },
    ],
    outlines: [
      rect(28, 48, 44, 40),
      triangle({ x: 22, y: 48 }, { x: 78, y: 48 }, { x: 50, y: 22 }),
      rect(44, 68, 12, 20),
      rect(33, 54, 10, 10),
      rect(57, 54, 10, 10),
      circle(84, 18, 9),
    ],
    details: [circle(54, 79, 1.4)],
  },
];
