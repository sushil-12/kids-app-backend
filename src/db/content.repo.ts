import { PrismaClient, Story, Poem, AbcLesson, CrawlSource } from '@prisma/client';

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

export async function createStory(data: Omit<Story, 'id' | 'usedCount' | 'createdAt'>): Promise<Story> {
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

export async function createPoem(data: Omit<Poem, 'id' | 'usedCount' | 'createdAt'>): Promise<Poem> {
  return prisma.poem.create({ data });
}

export async function incrementPoemUsedCount(id: string): Promise<void> {
  await prisma.poem.update({ where: { id }, data: { usedCount: { increment: 1 } } });
}

export async function getAbcLesson(letter: string): Promise<AbcLesson | null> {
  return prisma.abcLesson.findUnique({ where: { letter: letter.toUpperCase() } });
}

export async function upsertAbcLesson(data: Omit<AbcLesson, 'id' | 'updatedAt'>): Promise<AbcLesson> {
  return prisma.abcLesson.upsert({
    where: { letter: data.letter },
    update: data,
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

export async function getPoemCountByTopic(topic: string): Promise<number> {
  return prisma.poem.count({ where: { topic } });
}

export async function getStoryExistsForDate(ageBand: string, date: string): Promise<boolean> {
  const count = await prisma.story.count({ where: { ageBand, date } });
  return count > 0;
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
