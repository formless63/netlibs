/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import katexCss from 'katex/dist/katex.min.css?url';
import contentCss from '@formless63/editor-renderer/styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Rich text editor example' }
    ],
    links: [
      { rel: 'stylesheet', href: contentCss },
      { rel: 'stylesheet', href: katexCss }
    ]
  }),
  component: () => (
    <html lang='en'>
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: '2rem auto', maxWidth: '60rem', padding: '0 1rem', fontFamily: 'system-ui' }}>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
});
