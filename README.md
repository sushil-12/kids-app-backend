# BrightMind Kids Backend

A Node.js 20 + TypeScript + Fastify v4 + PostgreSQL 16 (Prisma) + Redis 7 + BullMQ + OpenAI content API backend for the BrightMind Kids educational app.

---

## Local Dev Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 20+

### 1. Clone and configure environment

```bash
cp .env.example .env
# Edit .env and fill in real values for OPENAI_API_KEY, API_KEY, ADMIN_API_KEY
```

### 2. Start infrastructure

```bash
docker-compose up postgres redis -d
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run database migration

```bash
npx prisma migrate dev --name init
```

### 5. Seed the database

```bash
npm run db:seed
```

### 6. Start the dev server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

### 7. Build the content portal

The stories / poems / ABC authoring portal is a separate front-end package
(`admin/`) served by Fastify at `/admin`:

```bash
npm run admin:install
npm run admin:build      # then open http://localhost:3000/admin
```

While working on the portal itself, `npm run admin:dev` serves it on :5173 with
live reload, proxying `/v1` to the backend on :3000.

---

## Content packs

Everything the app's **Learn** section shows — cinematic stories, poems and ABC
letters — is one document type, the `ContentPack` (schema v3). One schema, one
editor, one player in the app.

A pack is an ordered list of **moments** (scene, narration, timed beats, camera
drift) plus an **assetManifest** of externally hosted pictures. Moments reference
a picture *by id*, so swapping artwork is a single URL edit that every scene
using it follows. Text fields are bilingual `{ en, hi }` maps served verbatim;
the app collapses them per read, which is why its in-player EN ⇄ हिन्दी pill is
instant.

The point of all this: **changing what children see no longer needs an app
release.** Edit a pack in `/admin`, and it is live on the next open.

- Contract + validator: `src/services/pack.schema.ts` (mirrors the Dart models in
  `brightmind_kids/lib/src/features/learn/data/cinematic_story_v3.dart`)
- App API: `src/routes/v1/packs.ts` · Authoring API: `src/routes/v1/admin.packs.ts`
- Recorded narration: `src/services/narration.service.ts` (ElevenLabs), served
  from `src/routes/v1/media.ts`
- Seeded library: `npm run db:seed:packs` — the Thirsty Crow reference story plus
  the 26 letters and 5 poems that used to be hardcoded in the app

The app is a lenient reader (it applies its own defaults and skips vocabulary it
doesn't know), so the validator here is deliberately the strict one: a moment
pointing at a missing picture is rejected at save time, in front of the person
who can fix it, rather than degrading silently in front of a child.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key (gpt-4o-mini) |
| `API_KEY` | Yes | — | Shared secret for client requests (`x-api-key` header) |
| `ADMIN_API_KEY` | Yes | — | Admin secret for management endpoints (`x-admin-key` header) |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `DAILY_OPENAI_CALL_LIMIT` | No | `50` | Maximum OpenAI API calls per day |
| `PUBLIC_BASE_URL` | No | `http://localhost:3000` | Origin baked into narration-clip URLs stored inside packs — must be reachable **by the app**, so set it in any deployed environment |
| `ELEVENLABS_API_KEY` | No | — | Recorded narration. Without it, packs simply play with the app's on-device voice |
| `ELEVEN_VOICE_EN` | No | `21m00Tcm4TlvDq8ikWAM` | ElevenLabs voice id for English |
| `ELEVEN_VOICE_HI` | No | `21m00Tcm4TlvDq8ikWAM` | Voice id for Hindi — the default is an English voice, pick a native one |
| `ELEVENLABS_DAILY_CHAR_LIMIT` | No | `20000` | Characters/day cap (ElevenLabs bills per character) |
| `S3_BUCKET` | No | — | Media bucket. Set this **and** both AWS keys to turn on artwork uploads and bucket-backed narration |
| `S3_REGION` | No | `us-east-2` | Bucket region |
| `AWS_ACCESS_KEY_ID` | No | — | Credentials for the bucket |
| `AWS_SECRET_ACCESS_KEY` | No | — | " |
| `S3_PUBLIC_BASE_URL` | No | — | CloudFront (or any CDN) origin in front of the bucket. Without it, objects use their virtual-hosted S3 URL |
| `S3_KEY_PREFIX` | No | `brightmind` | Key namespace, so a shared bucket stays tidy |
| `MEDIA_MAX_UPLOAD_MB` | No | `15` | Per-file upload cap, enforced in the presigned signature |
| `LOG_LEVEL` | No | `info` | Pino log level |

### Media storage

With S3 configured, uploaded artwork and recorded narration both live in the
bucket. Without it the backend still runs: narration falls back to inline
Postgres storage and artwork is paste-a-URL only, so a dev machine needs no
cloud credentials at all. Everything goes through one interface
(`src/services/media.store.ts`), which is why that fallback exists rather than
a hard requirement.

Switching S3 on later is safe. Clips recorded before the change keep their
inline bytes and keep serving from `/v1/media/narration/:id.mp3`, and packs
already published with that URL keep working — the route redirects to the CDN
for bucket-backed clips and serves bytes directly for the older ones.

**Bucket setup.** Uploads go straight from the browser to S3 via a presigned
PUT, so the bucket needs CORS that allows it — this is the one thing that will
bite you, and its symptom is an opaque network error in the portal:

```json
[{
  "AllowedOrigins": ["https://your-admin-origin", "http://localhost:5173"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

Objects must also be publicly readable, since the app fetches them directly —
either public-read on the prefix, or (better) keep the bucket private and put
CloudFront in front of it with an Origin Access Control, then set
`S3_PUBLIC_BASE_URL` to the distribution domain.

The presigned URL binds the content type **and** the content length, so a URL
issued for a 2 MB PNG can't be used to upload a 2 GB file or an HTML document.
It expires in 15 minutes.

---

## API Reference

### Authentication

All content endpoints require the `x-api-key` header:
```
x-api-key: your-shared-secret-here
```

Admin endpoints require the `x-admin-key` header:
```
x-admin-key: your-admin-secret-here
```

---

### Health Check

#### `GET /health`

No authentication required.

```bash
curl http://localhost:3000/health
```

**Response 200:**
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok"
}
```

**Response 503** (degraded):
```json
{
  "status": "degraded",
  "db": "error",
  "redis": "ok"
}
```

---

### Content packs

The app's Learn section reads from these three. See **Content packs** above.

#### `GET /v1/packs?kind=story|poem|abc&ageBand=junior|senior`

Catalog for one Learn surface — one row per pack, enough to render a shelf tile
without downloading it. Replaces the app's old hardcoded story shelf, poem topic
list and A–Z list. Redis-cached for an hour; admin writes drop the key.

```json
{ "items": [ { "slug": "thirsty-crow", "kind": "story",
  "title": { "en": "The Thirsty Crow", "hi": "प्यासा कौआ" },
  "emoji": "🐦‍⬛", "coverUrl": "https://…/cover.png", "minutes": 3,
  "langs": ["en","hi"], "ageBand": "junior", "moments": 8, "version": 4 } ] }
```

#### `GET /v1/packs/:slug`

The full playable document, **bilingual** — text fields keep their `{ en, hi }`
maps and the app collapses them to the playing language. Published packs only;
404 otherwise. `version` is part of the app's cache key, so an admin edit
invalidates the on-device copy by itself.

#### `GET /v1/packs/daily?kind=story&ageBand=junior`

Today's pick (dated-for-today or evergreen, least-used first). Returns **503**
when the library has nothing — the app falls back to its bundled offline pack
rather than showing a child an error.

#### `GET /v1/media/narration/:clipId.mp3`

A recorded narration clip. **Unauthenticated** by design: the URL is embedded in
a pack and streamed by the app's audio player, which can't reliably attach
headers. Ids are cuids, and the payload is a children's story being read aloud.
Clips are immutable (editing a line produces a new id), so they're served
`immutable` and support `Range` and `If-None-Match`.

---

### Stories

#### `GET /v1/stories/daily`

Returns the daily story for the given age band. Cached in Redis until midnight UTC.

**Query parameters:**
| Param | Values | Default |
|---|---|---|
| `ageBand` | `junior`, `senior` | `junior` |

```bash
curl -H "x-api-key: your-key" \
  "http://localhost:3000/v1/stories/daily?ageBand=junior"
```

**Response 200:**
```json
{
  "id": "clx...",
  "title": "The Magic Seed",
  "story": "Once upon a time...",
  "moral": "Hard work always pays off.",
  "emoji": "🌱",
  "source": "openai",
  "generatedAt": "2026-06-19T10:00:00.000Z"
}
```

**Response 503:** No content available yet (generation is enqueued).

---

### Poems

#### `GET /v1/poems`

Returns a poem for the requested topic. Cached in Redis for 1 hour.

**Query parameters:**
| Param | Values | Default |
|---|---|---|
| `topic` | `Animals`, `Seasons`, `Numbers`, `Colors`, `Nature` | `Animals` |

```bash
curl -H "x-api-key: your-key" \
  "http://localhost:3000/v1/poems?topic=Animals"
```

**Response 200:**
```json
{
  "id": "clx...",
  "title": "The Happy Frog",
  "poem": "A little green frog sat on a log,\nSinging his song through the morning fog,\n...",
  "emoji": "🐸",
  "topic": "Animals",
  "source": "manual"
}
```

---

### ABC Lessons

#### `GET /v1/abc/:letter`

Returns a phonics lesson for a single letter A-Z. Cached in Redis for 24 hours.

```bash
curl -H "x-api-key: your-key" \
  "http://localhost:3000/v1/abc/A"
```

**Response 200:**
```json
{
  "letter": "A",
  "word": "Apple",
  "emoji": "🍎",
  "phonics": "Say \"ah\" as in apple",
  "miniStory": "Amy found a big red apple under the old tree...",
  "source": "manual"
}
```

---

### Admin Endpoints

All require `x-admin-key`.

#### Content packs — `/v1/admin/packs`

The API behind the content portal. Every write is validated as a whole document
(a moment can't be checked for a missing picture without the manifest it points
into), bumps `version`, and drops the Redis keys so the edit is live immediately.

| Endpoint | Does |
|---|---|
| `GET /v1/admin/packs?kind=&published=&search=` | List with authoring state: `missingArt`, `clips` / `expectedClips`, `published` |
| `GET /v1/admin/packs/:id` | Full document + clip list. Ignores `published`, so drafts can be authored and previewed |
| `POST /v1/admin/packs` | Create (409 on a duplicate slug) |
| `PUT /v1/admin/packs/:id` | Full save. **Never** changes `published` — that has its own endpoint, so a content save can't push a half-finished draft live |
| `PATCH /v1/admin/packs/:id` | Metadata only (age band, date, topic, letter…) |
| `PATCH /v1/admin/packs/:id/publish` | Re-validates before going live; unpublishing never does, so a broken pack can always be pulled |
| `POST /v1/admin/packs/:id/moments/reorder` | `{ order: [momentId, …] }` — must be a permutation of the pack's moments |
| `POST /v1/admin/packs/:id/narrate` | `202 { jobId }`. Queued: a bilingual 8-moment story is 16 ElevenLabs calls. Body: `{ langs?, force?, momentIds? }` |
| `GET /v1/admin/packs/:id/clips` | Clip list + `expected`, for polling a narration run |
| `POST /v1/admin/packs/import` | Paste a v3 pack document; lands unpublished |
| `DELETE /v1/admin/packs/:id` | Deletes the pack and cascades its clips |

#### Media — `/v1/admin/media`

| Endpoint | Does |
|---|---|
| `GET /v1/admin/media/config` | Whether uploads are on, the size cap, accepted types — the portal shows an upload box or paste-a-URL accordingly |
| `POST /v1/admin/media/presign` | `{ filename, mime, byteLength, folder? }` → a presigned PUT. Bytes never pass through this API |
| `POST /v1/admin/media` | Called after the PUT succeeds, so the picture joins the reusable library |
| `GET /v1/admin/media` | The library, for picking an already-uploaded picture |
| `DELETE /v1/admin/media/:id` | `409` if a pack still points at it; `?force=true` to delete anyway |

#### `GET /v1/stats`

Returns content counts and usage stats.

```bash
curl -H "x-admin-key: your-admin-key" \
  http://localhost:3000/v1/stats
```

**Response 200:**
```json
{
  "stories": 42,
  "poems": 25,
  "abcLessons": 26,
  "openAiCallsToday": 7,
  "crawledThisWeek": 3
}
```

#### `POST /v1/crawl/trigger`

Triggers an immediate crawl of a URL to extract and store content.

```bash
curl -X POST \
  -H "x-admin-key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/story", "contentType": "story"}' \
  http://localhost:3000/v1/crawl/trigger
```

**Body:**
| Field | Values |
|---|---|
| `url` | Any valid URL |
| `contentType` | `story`, `poem`, `abc` |

**Response 202:**
```json
{ "jobId": "12" }
```

---

## How to Add a New Crawl Source

1. Use the admin endpoint directly:
```bash
curl -X POST \
  -H "x-admin-key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-source.com/stories", "contentType": "story"}' \
  http://localhost:3000/v1/crawl/trigger
```

2. Or seed it into the `crawl_sources` table via Prisma Studio:
```bash
npm run db:studio
```

The crawl worker will fetch the URL, extract the text, and use OpenAI to transform it into the appropriate content schema before storing it in the database. The automatic sweep job runs every 6 hours and re-crawls sources older than 7 days.

---

## How to Connect the Flutter App

1. Add the API base URL to your Flutter app's environment config:
```
https://your-api-host.com
```

2. Include the `x-api-key` header in all requests:
```dart
final headers = {'x-api-key': const String.fromEnvironment('API_KEY')};
```

3. Example Dart HTTP call:
```dart
final response = await http.get(
  Uri.parse('$baseUrl/v1/stories/daily?ageBand=junior'),
  headers: headers,
);
```

4. Parse the JSON response into your model classes matching the shapes described in this API reference.

---

## Cost Monitoring

OpenAI calls are tracked daily via a Redis counter keyed by date (`openai:calls:YYYY-MM-DD`).

- **Daily limit** is controlled by `DAILY_OPENAI_CALL_LIMIT` (default: 50).
- When 80% of the limit is reached, a warning is logged.
- When the limit is reached, `DailyLimitReachedException` is thrown and the request returns `503`.
- Check today's usage via the `/v1/stats` endpoint (`openAiCallsToday` field).
- Each call logs `tokens_used` and `cost_estimate` at the `info` level.

To increase the limit:
```bash
# In .env or environment:
DAILY_OPENAI_CALL_LIMIT=100
```

---

## Running Tests

```bash
npm test
```

With coverage:
```bash
npx vitest run --coverage
```

---

## Docker Deployment

```bash
# Build and start all services
docker-compose up --build -d

# Run migrations inside the container
docker-compose exec app npx prisma migrate deploy

# Seed the database
docker-compose exec app node -e "require('./dist/...')" # or run tsx seed
```
