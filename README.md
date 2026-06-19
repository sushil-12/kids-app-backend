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
| `LOG_LEVEL` | No | `info` | Pino log level |

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
