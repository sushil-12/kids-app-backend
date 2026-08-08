# ---------- Builder ----------
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# The content portal is its own package with its own toolchain, built here so
# the server image ships the static bundle and never needs React at runtime.
COPY admin ./admin/
RUN npm --prefix admin ci && npm --prefix admin run build && rm -rf admin/node_modules

# ---------- Runner ----------
FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m brightmind

COPY --from=builder --chown=brightmind:nodejs /app/dist ./dist
COPY --from=builder --chown=brightmind:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=brightmind:nodejs /app/prisma ./prisma
COPY --from=builder --chown=brightmind:nodejs /app/admin/dist ./admin/dist
COPY --chown=brightmind:nodejs package*.json ./
RUN chmod -R 755 /app/node_modules/@prisma /app/node_modules/.prisma 2>/dev/null || true

USER brightmind

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]