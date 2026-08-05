BrightMind Kids — Content API Backend
This is the server side of the BrightMind Kids app (the Flutter client is described in CLAUDE.md). It's a content-generation + content-serving API that feeds the coloring app and the brain-games' text content (stories, poems, ABC lessons) to the Flutter client. It's the backend that the CLAUDE.md says doesn't exist in Phase 1 — clearly it now does.

Tech stack
Fastify 4 (HTTP server) + Prisma (Postgres ORM) + Redis (cache + BullMQ queues)
OpenAI SDK (gpt-4o-mini for text, gpt-image-1/dall-e-3 for images)
sharp (image processing) + potrace (raster→vector tracing) + cheerio (HTML/SVG parsing) + svgpath (SVG transforms)
TypeScript + tsx (dev) + vitest (tests), pino logging
The two jobs of the backend
1. Serve content to the app (src/routes/v1/)

GET /v1/stories/daily?ageBand=junior|senior — daily story (randomized; daily cache currently disabled)
GET /v1/poems / GET /v1/abc — poems & phonics lessons
GET /v1/coloring — list of today's published coloring pages (Redis-cached 1h)
GET /v1/coloring/:slug — single page
Auth via x-api-key header (app); admin routes via x-admin-key (src/plugins/auth.ts)
2. Produce content (so the library is never empty)

Two production pipelines feed the DB:

Crawl pipeline — CrawlerService (src/services/crawler.service.ts) fetches trusted kids-content sites, RSS-first, polite rate-limited. Discovered pages get fed to OpenAI to transform raw HTML into structured JSON (story/poem/abc). Runs via a BullMQ crawl worker + a 4-hourly sweep.
Generation pipeline — ContentService calls OpenAI directly to make stories, poems, ABC lessons, and coloring pages. Scheduled by cron jobs in src/jobs/generate.job.ts (stories 02:00 UTC daily, poems weekly, coloring 02:30 UTC daily).
The interesting part: coloring page generation
Text models can't draw SVG geometry, so coloring pages are produced image-first then vectorized:

OpenAIService.generateImage() asks gpt-image-1 for "bold black outlines on white, fully-closed regions" line art (src/services/openai.service.ts).
imageToColoringPage() (src/services/coloring.trace.ts) traces the raster into the app's vector format:
threshold → dilate to seal hairline gaps → flood-fill-label enclosed white cells (connected components) → potrace-trace each cell into a closed region path → trace the line art itself as solid-black details.
Guards: rejects filled/silhouette art (>30% ink), caps to 14 tappable cells, scales into the 100×100 viewBox.
importColoringImage() writes it to Postgres unpublished (published=false) — AI output always lands in a review queue.
There's also src/services/svg.import.ts — a faster, lossless path that imports a filled SVG illustration directly (each colored shape → exact region), no rasterizing.
The human-review gate
Because traced quality varies, AI/manual pages go through an admin review queue:

GET /v1/coloring/pending — list unpublished
PATCH /v1/coloring/:slug/publish — approve (re-stamps dated pages to today so they don't publish "into the past")
DELETE /v1/coloring/:slug — reject
GET /v1/coloring/review — a self-contained HTML admin UI (src/routes/v1/coloring.review.ts) that renders each pending page as SVG (mirroring the Flutter painter) and lets you approve/reject/generate/upload from the browser.
Data model (prisma/schema.prisma)
Story, Poem, AbcLesson — text content with usedCount for least-used-first rotation
ColoringPage — slug (stable id ↔ Flutter's ColoringTemplate.id), regions/outlines/details as JSON (SVG path strings in a 100×100 viewBox), date for daily surfacing, published gate, isPremium for paywall
CrawlSource — index/page crawl tracking with discoveredFrom lineage
Cross-cutting concerns
Cost guard: OpenAIService enforces a daily call budget (DAILY_OPENAI_CALL_LIMIT, default 50) via a Redis counter; throws DailyLimitReachedException which workers swallow gracefully. JSON-mode is forced on text calls to avoid parse-failures → paid BullMQ retries.
Caching: coloring list cached 1h in Redis; busted on publish/delete/manual upload.
App wire format: the serialize() in coloring.ts is kept in lockstep with the Flutter ColoringTemplate.fromJson parser — pages are pure data, so new art ships without an app release.
Graceful shutdown on SIGTERM/SIGINT.
Repo layout

src/
 config.ts          # zod-validated env
 index.ts           # Fastify bootstrap + workers
 plugins/ auth.ts, redis.ts
 db/ content.repo.ts  # Prisma queries (single DAO module)
 services/
   content.service.ts   # generation orchestrator
   openai.service.ts    # OpenAI + cost guard
   crawler.service.ts   # RSS-first web crawler
   coloring.trace.ts    # raster → vector regions (image path)
   svg.import.ts        # filled-SVG → vector regions (lossless path)
 jobs/
   queue.ts, generate.job.ts, crawl.job.ts   # BullMQ cron + workers
routes/v1/ stories, poems, abc, coloring, coloring.review, health
prisma/ schema.prisma, seed.ts, coloring-art.ts, migrations/
tests/ vitest