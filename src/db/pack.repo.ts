import { Prisma, ContentPack, NarrationClip, MediaAsset } from '@prisma/client';
import { prisma } from './content.repo';

// Data access for content packs (stories / poems / ABC) and their recorded
// narration clips. Same house rules as content.repo.ts: plain exported
// functions, clamped list limits, updates that return null instead of throwing
// when the row is gone.
//
// Serving policy matches the rest of the content tables — only `published`
// packs reach kids, dated packs surface on their day, evergreen packs always,
// least-used first so fresh content shows before repeats.

/** Write shape. The JSON columns take Prisma.InputJsonValue (not the
 *  ContentPack output types) so create/update type-check. */
export interface ContentPackInput {
  slug: string;
  kind: string;
  schemaVersion?: string;
  title: Prisma.InputJsonValue;
  availableLangs: Prisma.InputJsonValue;
  ageBand: string;
  category: string;
  concepts: Prisma.InputJsonValue;
  moral: Prisma.InputJsonValue;
  estimatedDuration: number;
  cover: Prisma.InputJsonValue;
  audio: Prisma.InputJsonValue;
  reward: Prisma.InputJsonValue;
  assetManifest: Prisma.InputJsonValue;
  moments: Prisma.InputJsonValue;
  topic: string | null;
  letter: string | null;
  /** ABC only: the structured letter card. `Prisma.DbNull` clears it — plain
   *  `null` is not assignable to a nullable Json column. */
  letterSpec?: Prisma.InputJsonValue | typeof Prisma.DbNull;
  date: string | null;
  source: string;
  published: boolean;
}

const today = (): string => new Date().toISOString().split('T')[0];

export async function listPacks(opts: {
  kind?: string;
  ageBand?: string;
  topic?: string;
  letter?: string;
  published?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ContentPack[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.contentPack.findMany({
    where: {
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.ageBand ? { ageBand: opts.ageBand } : {}),
      ...(opts.topic ? { topic: opts.topic } : {}),
      ...(opts.letter ? { letter: opts.letter.toUpperCase() } : {}),
      ...(opts.published !== undefined ? { published: opts.published } : {}),
      ...(opts.search ? { slug: { contains: opts.search, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ kind: 'asc' }, { letter: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    skip: offset,
  });
}

/** Packs the app may serve today: published, dated-for-today or evergreen. */
export async function listPublishedPacks(opts: {
  kind?: string;
  ageBand?: string;
}): Promise<ContentPack[]> {
  const t = today();
  return prisma.contentPack.findMany({
    where: {
      published: true,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.ageBand ? { ageBand: opts.ageBand } : {}),
      OR: [{ date: t }, { date: null }],
    },
    orderBy: [{ letter: 'asc' }, { usedCount: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getPackBySlug(slug: string): Promise<ContentPack | null> {
  return prisma.contentPack.findUnique({ where: { slug } });
}

/** Accepts either the cuid or the slug — the admin UI addresses packs by id,
 *  the app by slug, and both hit some of the same handlers. */
export async function getPackById(id: string): Promise<ContentPack | null> {
  return prisma.contentPack.findFirst({ where: { OR: [{ id }, { slug: id }] } });
}

/** Today's pick for a kind + band, least-used first. Mirrors the story/coloring
 *  rotation so a child doesn't get the same tale two days running. */
export async function getDailyPack(
  kind: string,
  ageBand: string,
): Promise<ContentPack | null> {
  return prisma.$queryRaw<ContentPack[]>`
    SELECT * FROM content_packs
    WHERE "kind" = ${kind}
      AND "ageBand" = ${ageBand}
      AND "published" = true
      AND ("date" = ${today()} OR "date" IS NULL)
    ORDER BY "usedCount" ASC, RANDOM()
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}

export async function createPack(data: ContentPackInput): Promise<ContentPack> {
  return prisma.contentPack.create({ data });
}

export async function upsertPack(data: ContentPackInput): Promise<ContentPack> {
  return prisma.contentPack.upsert({
    where: { slug: data.slug },
    update: { ...data, version: { increment: 1 } },
    create: data,
  });
}

/// Full replace from the admin editor. Bumps `version` so the app's on-device
/// cache key (`pack_<slug>_<version>`) changes and the edit is picked up on the
/// next open — no cache-busting header, no stale picture.
export async function replacePack(
  id: string,
  data: ContentPackInput,
): Promise<ContentPack | null> {
  try {
    return await prisma.contentPack.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  } catch {
    return null;
  }
}

/// Partial update for the metadata fields the list view edits inline. Content
/// (moments/assetManifest) always goes through replacePack so it's validated.
export async function updatePackMeta(
  id: string,
  data: Partial<
    Pick<ContentPack, 'ageBand' | 'category' | 'date' | 'source' | 'topic' | 'letter' | 'published'>
  >,
): Promise<ContentPack | null> {
  try {
    return await prisma.contentPack.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  } catch {
    return null;
  }
}

/// Approve/unapprove a pack. Like coloring pages and cinematic stories, a dated
/// pack approved after its date would publish into the past and never surface,
/// so on approval any dated pack is re-stamped to today. Evergreen packs
/// (date: null) are left alone; unpublishing never touches the date.
export async function setPackPublished(
  id: string,
  published: boolean,
): Promise<ContentPack | null> {
  const existing = await prisma.contentPack.findUnique({ where: { id } });
  if (!existing) return null;
  const reDate = published && existing.date !== null;
  return prisma.contentPack.update({
    where: { id },
    data: {
      published,
      version: { increment: 1 },
      ...(reDate ? { date: today() } : {}),
    },
  });
}

export async function deletePack(id: string): Promise<boolean> {
  const result = await prisma.contentPack.deleteMany({ where: { id } });
  return result.count > 0;
}

export async function incrementPackUsedCount(id: string): Promise<void> {
  await prisma.contentPack.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

export async function getPackCounts(): Promise<Record<string, number>> {
  const rows = await prisma.contentPack.groupBy({
    by: ['kind'],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.kind, r._count._all]));
}

// ───────────────────────────── Narration clips ─────────────────────────────

export interface NarrationClipInput {
  packId: string;
  momentId: string;
  lang: string;
  kind: string;
  mime: string;
  /** The audio itself. Null once the clip lives in object storage. */
  bytes: Buffer | null;
  byteLength: number;
  contentHash: string;
  voiceId: string;
  /** Object key, when stored in a bucket. */
  storageKey?: string | null;
  /** Public URL written into the pack, when stored in a bucket. */
  url?: string | null;
  /** [{ w, t }] word start times inside the clip, when the synthesis reported
   *  alignment. Kept alongside the audio so a skipped (hash-matched) re-run can
   *  restore the timings without re-synthesising the line. `Prisma.DbNull`
   *  clears it — plain `null` is not assignable to a nullable Json column. */
  marks?: Prisma.InputJsonValue | typeof Prisma.DbNull;
  /** Clip length in ms. */
  durationMs?: number | null;
}

/** The word timings behind sing-along highlighting. */
export interface WordMark {
  /** The word as it should be highlighted on screen. */
  w: string;
  /** Its start time in seconds from the beginning of the clip. */
  t: number;
}

/** Clip metadata for a pack (no bytes — the admin list would be megabytes). */
export async function listClipsForPack(
  packId: string,
): Promise<Omit<NarrationClip, 'bytes'>[]> {
  return prisma.narrationClip.findMany({
    where: { packId },
    select: {
      id: true,
      packId: true,
      momentId: true,
      lang: true,
      kind: true,
      mime: true,
      byteLength: true,
      storageKey: true,
      url: true,
      contentHash: true,
      voiceId: true,
      marks: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: [{ momentId: 'asc' }, { lang: 'asc' }],
  });
}

export async function getClipById(id: string): Promise<NarrationClip | null> {
  return prisma.narrationClip.findUnique({ where: { id } });
}

/** Existing clip for a slot, used to skip re-synthesis when the text is
 *  unchanged (the caller compares `contentHash`). */
export async function findClip(
  packId: string,
  momentId: string,
  lang: string,
  kind: string,
): Promise<NarrationClip | null> {
  return prisma.narrationClip.findUnique({
    where: { packId_momentId_lang_kind: { packId, momentId, lang, kind } },
  });
}

export async function upsertClip(data: NarrationClipInput): Promise<NarrationClip> {
  const { packId, momentId, lang, kind, ...rest } = data;
  return prisma.narrationClip.upsert({
    where: { packId_momentId_lang_kind: { packId, momentId, lang, kind } },
    update: rest,
    create: data,
  });
}

/** Drops clips for moments that no longer exist, so a pack whose scenes were
 *  reordered/deleted in the admin editor doesn't keep orphaned audio around.
 *  Returns the storage keys removed so the caller can clear the bucket too. */
export async function deleteOrphanClips(
  packId: string,
  keepMomentIds: string[],
): Promise<string[]> {
  const doomed = await prisma.narrationClip.findMany({
    where: { packId, momentId: { notIn: keepMomentIds } },
    select: { storageKey: true },
  });
  await prisma.narrationClip.deleteMany({
    where: { packId, momentId: { notIn: keepMomentIds } },
  });
  return doomed
    .map((c) => c.storageKey)
    .filter((k): k is string => Boolean(k));
}

// ────────────────────────────── Media library ──────────────────────────────
// Artwork uploaded through the portal. A pack references pictures by URL, so
// these rows aren't required for a pack to work — they exist so an admin can
// reuse an upload across packs, and so an object in the bucket can be found
// and deleted rather than lingering forever.

export interface MediaAssetInput {
  storageKey: string;
  url: string;
  mime: string;
  byteLength: number;
  originalName: string;
  folder: string;
}

export async function createMediaAsset(data: MediaAssetInput): Promise<MediaAsset> {
  return prisma.mediaAsset.create({ data });
}

export async function listMediaAssets(opts: {
  folder?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<MediaAsset[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.mediaAsset.findMany({
    where: {
      ...(opts.folder ? { folder: opts.folder } : {}),
      ...(opts.search
        ? { originalName: { contains: opts.search, mode: 'insensitive' } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  return prisma.mediaAsset.findUnique({ where: { id } });
}

export async function deleteMediaAsset(id: string): Promise<boolean> {
  const result = await prisma.mediaAsset.deleteMany({ where: { id } });
  return result.count > 0;
}

/** Packs whose manifest (or cover) still points at a URL — so the portal can
 *  warn before deleting a picture that is still on screen somewhere. */
export async function packsUsingUrl(url: string): Promise<{ slug: string }[]> {
  return prisma.$queryRaw<{ slug: string }[]>`
    SELECT "slug" FROM content_packs
    WHERE "assetManifest"::text LIKE ${'%' + url + '%'}
    ORDER BY "slug" ASC
    LIMIT 50
  `;
}
