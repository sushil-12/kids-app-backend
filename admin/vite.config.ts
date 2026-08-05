import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin portal is served by Fastify at /admin in production (see
// src/plugins/admin.static.ts), so the bundle must be built with that base
// path. In development Vite serves it and proxies the API to the running
// backend, so the same relative `/v1/...` fetches work in both modes.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.BACKEND_ORIGIN ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
