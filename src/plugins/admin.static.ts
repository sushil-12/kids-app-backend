import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import { FastifyPluginAsync } from 'fastify';
import { config } from '../config';

// Serves the built content portal (admin/) at /admin.
//
// The portal is a separate npm package with its own Vite toolchain, so the
// server has no build-time dependency on React — it just hands out the files
// `npm --prefix admin run build` produced. If they aren't there, /admin
// explains how to build them instead of 404ing at someone who just cloned the
// repo.
//
// The legacy vanilla page stays at /v1/admin for Coloring / Crawl / RAG / Jobs.
// Neither page is authenticated: both prompt for the admin key and send it as
// x-admin-key on every API call, which is where the real check happens.

const ADMIN_DIST = join(__dirname, '..', '..', 'admin', 'dist');

const NOT_BUILT = `<!doctype html>
<meta charset="utf-8">
<title>Content portal not built</title>
<body style="font-family:system-ui;max-width:34rem;margin:4rem auto;line-height:1.6;color:#332E40">
<h1>Content portal not built</h1>
<p>The stories / poems / ABC portal is a separate front-end package. Build it once:</p>
<pre style="background:#f6f4f1;padding:12px 14px;border-radius:8px">npm --prefix admin install
npm --prefix admin run build</pre>
<p>Then reload this page. During development, <code>npm --prefix admin run dev</code>
serves it on :5173 with live reload.</p>
<p><a href="/v1/admin">← Coloring, crawl, RAG and jobs admin</a></p>
</body>`;

const adminStaticPluginFn: FastifyPluginAsync = async (fastify) => {
  // The dev server runs on a different origin, so it needs CORS to reach this
  // API. Locked to development — in production the portal is same-origin and
  // no cross-origin caller should be able to use an admin key.
  if (config.NODE_ENV === 'development') {
    const cors = await import('@fastify/cors');
    await fastify.register(cors.default, {
      origin: [/^http:\/\/localhost:\d+$/],
      allowedHeaders: ['Content-Type', 'x-admin-key', 'x-api-key'],
    });
  }

  if (!existsSync(join(ADMIN_DIST, 'index.html'))) {
    fastify.get('/admin', async (_request, reply) =>
      reply.type('text/html').send(NOT_BUILT),
    );
    fastify.log.warn(
      'admin/dist not found — /admin will explain how to build the content portal',
    );
    return;
  }

  await fastify.register(fastifyStatic, {
    root: ADMIN_DIST,
    prefix: '/admin/',
    // Hashed asset filenames are immutable; index.html must not be, or an
    // updated portal would keep loading the previous bundle.
    setHeaders: (res, path) => {
      if (path.endsWith('index.html')) {
        res.setHeader('cache-control', 'no-cache');
      } else {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  });

  // The portal routes on the hash, but a bare /admin (no trailing slash) still
  // has to land on index.html.
  fastify.get('/admin', async (_request, reply) => reply.redirect(302, '/admin/'));
};

export const adminStaticPlugin = fp(adminStaticPluginFn);
