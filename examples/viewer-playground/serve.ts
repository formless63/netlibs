/** Serve the production build: static client files, then the SSR handler. */
import { join } from 'node:path';

const client = join(import.meta.dir, 'dist/client');
const entry = (await import(join(import.meta.dir, 'dist/server/server.js'))) as {
  default: { fetch: (request: Request) => Response | Promise<Response> };
};

const server = Bun.serve({
  port: Number(process.env['PORT'] ?? 4310),
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (!path.includes('..') && path !== '/') {
      const file = Bun.file(join(client, path));
      if (await file.exists()) return new Response(file);
    }
    return entry.default.fetch(request);
  },
});
console.log(`Playground on ${server.url}`);
