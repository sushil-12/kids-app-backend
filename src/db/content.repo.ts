import { PrismaClient, Prisma, Story, Poem, AbcLesson, CrawlSource, ColoringPage, CinematicStory } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

export async function getStoryForToday(ageBand: string, today: string): Promise<Story | null> {
  return prisma.$queryRaw<Story[]>`
    SELECT * FROM stories
    WHERE "ageBand" = ${ageBand}
      AND ("date" = ${today} OR "date" IS NULL)
    ORDER BY "usedCount" ASC, RANDOM()
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}

export async function getOldestEvergreenStory(ageBand: string): Promise<Story | null> {
  return prisma.story.findFirst({
    where: { ageBand, date: null },
    orderBy: { createdAt: 'asc' },
  });
}

/** Single story by id — used by GET /v1/stories/:id/sources for attribution. */
export async function getStoryById(id: string): Promise<Story | null> {
  return prisma.story.findUnique({ where: { id } });
}

export async function createStory(data: Prisma.StoryUncheckedCreateInput): Promise<Story> {
  return prisma.story.create({ data });
}

export async function incrementStoryUsedCount(id: string): Promise<void> {
  await prisma.story.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

export async function getPoem(topic: string): Promise<Poem | null> {
  return prisma.$queryRaw<Poem[]>`
    SELECT * FROM poems
    WHERE topic = ${topic}
    ORDER BY "usedCount" ASC, RANDOM()
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}

export async function createPoem(data: Prisma.PoemUncheckedCreateInput): Promise<Poem> {
  return prisma.poem.create({ data });
}

export async function incrementPoemUsedCount(id: string): Promise<void> {
  await prisma.poem.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

export async function getAbcLesson(letter: string): Promise<AbcLesson | null> {
  return prisma.abcLesson.findUnique({ where: { letter: letter.toUpperCase() } });
}

export async function upsertAbcLesson(data: Prisma.AbcLessonUncheckedCreateInput): Promise<AbcLesson> {
  return prisma.abcLesson.upsert({
    where: { letter: data.letter },
    update: data as Prisma.AbcLessonUncheckedUpdateInput,
    create: data,
  });
}

export async function getContentCounts(): Promise<{ stories: number; poems: number; abcLessons: number }> {
  const [stories, poems, abcLessons] = await Promise.all([
    prisma.story.count(),
    prisma.poem.count(),
    prisma.abcLesson.count(),
  ]);
  return { stories, poems, abcLessons };
}

/** Full table reads for corpus backfill (RAG). Used only by the admin backfill
 *  job — not hot-path. Returns everything so embeddings can be built once. */
export async function getAllStoriesAndPoemsAndLessons(): Promise<{
  stories: Story[];
  poems: Poem[];
  lessons: AbcLesson[];
}> {
  const [stories, poems, lessons] = await Promise.all([
    prisma.story.findMany(),
    prisma.poem.findMany(),
    prisma.abcLesson.findMany(),
  ]);
  return { stories, poems, lessons };
}

export async function getPoemCountByTopic(topic: string): Promise<number> {
  return prisma.poem.count({ where: { topic } });
}

/// Admin list views: filtered + paginated reads for the admin panel. Not used
/// by the app's hot paths — see src/routes/v1/admin.ts.
export async function listStories(opts: {
  ageBand?: string;
  source?: string;
  limit?: number;
  offset?: number;
}): Promise<Story[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.story.findMany({
    where: {
      ...(opts.ageBand ? { ageBand: opts.ageBand } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

export async function deleteStory(id: string): Promise<boolean> {
  const result = await prisma.story.deleteMany({ where: { id } });
  return result.count > 0;
}

/// Partial update for the admin editor. Only the editable text fields; id,
/// usedCount, createdAt, and sources provenance are left alone.
export async function updateStory(
  id: string,
  data: Partial<Pick<Story, 'ageBand' | 'title' | 'body' | 'moral' | 'emoji' | 'source' | 'date'>>,
): Promise<Story | null> {
  try {
    return await prisma.story.update({ where: { id }, data });
  } catch {
    return null;
  }
}

export async function listPoems(opts: {
  topic?: string;
  limit?: number;
  offset?: number;
}): Promise<Poem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.poem.findMany({
    where: { ...(opts.topic ? { topic: opts.topic } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

export async function deletePoem(id: string): Promise<boolean> {
  const result = await prisma.poem.deleteMany({ where: { id } });
  return result.count > 0;
}

export async function updatePoem(
  id: string,
  data: Partial<Pick<Poem, 'topic' | 'title' | 'lines' | 'emoji' | 'source'>>,
): Promise<Poem | null> {
  try {
    return await prisma.poem.update({ where: { id }, data });
  } catch {
    return null;
  }
}

export async function listAbcLessons(): Promise<AbcLesson[]> {
  return prisma.abcLesson.findMany({ orderBy: { letter: 'asc' } });
}

export async function deleteAbcLesson(letter: string): Promise<boolean> {
  const result = await prisma.abcLesson.deleteMany({
    where: { letter: letter.toUpperCase() },
  });
  return result.count > 0;
}

export async function updateAbcLesson(
  letter: string,
  data: Partial<Pick<AbcLesson, 'word' | 'emoji' | 'phonics' | 'miniStory' | 'source'>>,
): Promise<AbcLesson | null> {
  try {
    return await prisma.abcLesson.update({ where: { letter: letter.toUpperCase() }, data });
  } catch {
    return null;
  }
}

export async function getStoryExistsForDate(ageBand: string, date: string): Promise<boolean> {
  const count = await prisma.story.count({ where: { ageBand, date } });
  return count > 0;
}

// ───────────────────────── Cinematic stories ─────────────────────────
// Same serving policy as flat stories (today's dated + evergreen, least-used
// first) plus the coloring-style publish gate: only published scripts reach
// kids; AI output waits in the review queue.

export async function getCinematicStoryForToday(
  ageBand: string,
  lang: string,
  today: string,
): Promise<CinematicStory | null> {
  return prisma.$queryRaw<CinematicStory[]>`
    SELECT * FROM cinematic_stories
    WHERE "ageBand" = ${ageBand}
      AND "lang" = ${lang}
      AND "published" = true
      AND ("date" = ${today} OR "date" IS NULL)
    ORDER BY "usedCount" ASC, RANDOM()
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}

export async function getCinematicStoryById(id: string): Promise<CinematicStory | null> {
  return prisma.cinematicStory.findFirst({ where: { OR: [{ id }, { slug: id }] } });
}

export async function createCinematicStory(
  data: Prisma.CinematicStoryUncheckedCreateInput,
): Promise<CinematicStory> {
  return prisma.cinematicStory.create({ data });
}

export async function incrementCinematicStoryUsedCount(id: string): Promise<void> {
  await prisma.cinematicStory.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

export async function getCinematicStoryExists(
  ageBand: string,
  lang: string,
  date: string,
): Promise<boolean> {
  const count = await prisma.cinematicStory.count({ where: { ageBand, lang, date } });
  return count > 0;
}

export async function listCinematicStories(opts: {
  ageBand?: string;
  lang?: string;
  published?: boolean;
  limit?: number;
  offset?: number;
}): Promise<CinematicStory[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return prisma.cinematicStory.findMany({
    where: {
      ...(opts.ageBand ? { ageBand: opts.ageBand } : {}),
      ...(opts.lang ? { lang: opts.lang } : {}),
      ...(opts.published !== undefined ? { published: opts.published } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

/// Approve/unapprove a cinematic story. Like coloring pages, a dated story
/// approved late is re-stamped to today so it actually surfaces.
export async function setCinematicStoryPublished(
  id: string,
  published: boolean,
): Promise<CinematicStory | null> {
  const existing = await prisma.cinematicStory.findUnique({ where: { id } });
  if (!existing) return null;
  const reDate = published && existing.date !== null;
  return prisma.cinematicStory.update({
    where: { id },
    data: {
      published,
      ...(reDate ? { date: new Date().toISOString().split('T')[0] } : {}),
    },
  });
}

export async function deleteCinematicStory(id: string): Promise<boolean> {
  const result = await prisma.cinematicStory.deleteMany({ where: { id } });
  return result.count > 0;
}

/// Plain input shape for writes. We use Prisma.InputJsonValue (not the
/// ColoringPage output type) for the JSON columns so create/upsert type-check.
export interface ColoringPageInput {
  slug: string;
  title: string;
  viewBox: number;
  isPremium: boolean;
  stickerRewardId: string;
  regions: Prisma.InputJsonValue;
  outlines: Prisma.InputJsonValue;
  details: Prisma.InputJsonValue;
  date: string | null;
  source: string;
  published: boolean;
}

/// Pages to serve the app today: the day's dated pages plus all evergreen ones.
/// Only published pages reach kids. Least-used first so fresh art shows first.
export async function getColoringPages(today: string): Promise<ColoringPage[]> {
  return prisma.coloringPage.findMany({
    where: { published: true, OR: [{ date: today }, { date: null }] },
    orderBy: [{ usedCount: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function getColoringPageBySlug(slug: string): Promise<ColoringPage | null> {
  return prisma.coloringPage.findUnique({ where: { slug } });
}

/// Review queue: pages awaiting approval (newest first). Admin-only.
export async function getPendingColoringPages(): Promise<ColoringPage[]> {
  return prisma.coloringPage.findMany({
    where: { published: false },
    orderBy: { createdAt: 'desc' },
  });
}

/// Approve/unapprove a page. Returns null if the slug is unknown.
///
/// Dated pages only surface in the app on their own `date` (the list query is
/// `date = today OR date IS NULL`). A page generated days before it's approved
/// would otherwise publish straight into the past and never show, so on approval
/// we re-stamp any dated page to today. Evergreen pages (`date: null`) are left
/// alone. Unpublishing never touches the date.
export async function setColoringPagePublished(
  slug: string,
  published: boolean,
): Promise<ColoringPage | null> {
  const existing = await prisma.coloringPage.findUnique({ where: { slug } });
  if (!existing) return null;
  const reDate = published && existing.date !== null;
  return prisma.coloringPage.update({
    where: { slug },
    data: {
      published,
      ...(reDate ? { date: new Date().toISOString().split('T')[0] } : {}),
    },
  });
}

export async function upsertColoringPage(data: ColoringPageInput): Promise<ColoringPage> {
  return prisma.coloringPage.upsert({
    where: { slug: data.slug },
    update: data,
    create: data,
  });
}

/// Reject a page outright (used by the review UI to discard bad AI output).
/// Returns false if the slug didn't exist.
export async function deleteColoringPage(slug: string): Promise<boolean> {
  const result = await prisma.coloringPage.deleteMany({ where: { slug } });
  return result.count > 0;
}

export async function incrementColoringPageUsedCount(slug: string): Promise<void> {
  await prisma.coloringPage.update({ where: { slug }, data: { usedCount: { increment: 1 } } });
}

export async function getColoringPageCountForDate(date: string): Promise<number> {
  return prisma.coloringPage.count({ where: { date } });
}

export async function getPendingCrawlSources(limit: number): Promise<CrawlSource[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.crawlSource.findMany({
    where: {
      OR: [
        { status: 'pending' },
        { lastCrawled: { lt: sevenDaysAgo } },
      ],
    },
    take: limit,
  });
}

export async function updateCrawlSource(id: string, data: Partial<CrawlSource>): Promise<void> {
  await prisma.crawlSource.update({ where: { id }, data });
}

export async function createCrawlSource(data: Omit<CrawlSource, 'id' | 'lastCrawled'>): Promise<CrawlSource> {
  return prisma.crawlSource.create({ data });
}

/// Records a page discovered while crawling an index root. Returns the new
/// source's id, or `null` if the URL is already known — so re-sweeping a root
/// is idempotent and never re-queues a page that already exists.
export async function upsertDiscoveredPage(data: {
  url: string;
  contentType: string;
  discoveredFrom: string;
}): Promise<string | null> {
  const existing = await prisma.crawlSource.findUnique({ where: { url: data.url } });
  if (existing) return null;
  const created = await prisma.crawlSource.create({
    data: {
      url: data.url,
      contentType: data.contentType,
      mode: 'page',
      status: 'pending',
      discoveredFrom: data.discoveredFrom,
    },
  });
  return created.id;
}

export async function getAllCrawlSources(): Promise<CrawlSource[]> {
  return prisma.crawlSource.findMany({
    orderBy: [{ lastCrawled: 'desc' }, { url: 'asc' }],
  });
}
