import { createFileRoute } from '@tanstack/react-router';

/** Stand-in for an authenticated file route: no header, no bytes. */
export const Route = createFileRoute('/api/secure/$name')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (request.headers.get('authorization') !== 'Bearer playground') {
          return new Response('Unauthorized', { status: 401 });
        }
        const upstream = await fetch(
          new URL(`/fixtures/${encodeURIComponent(params.name)}`, request.url),
        );
        return new Response(await upstream.arrayBuffer(), { status: upstream.status });
      },
    },
  },
});
