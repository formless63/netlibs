import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import viewerStyles from '@formless63/viewers/styles.css?url';

import { DEMOS } from '../demos.tsx';
import styles from '../playground.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'File viewers' },
    ],
    links: [
      { rel: 'stylesheet', href: viewerStyles },
      { rel: 'stylesheet', href: styles },
    ],
  }),
  component: () => (
    <div className='shell'>
      <nav>
        <h1>File viewers</h1>
        <Link activeProps={{ className: 'active' }} to='/'>
          Open a local file
        </Link>
        {[...new Set(DEMOS.map((demo) => demo.group))].map((group) => (
          <section key={group}>
            <h2>{group}</h2>
            {DEMOS.filter((demo) => demo.group === group).map((demo) => (
              <Link
                activeProps={{ className: 'active' }}
                key={demo.id}
                params={{ id: demo.id }}
                search={{ via: 'url' }}
                to='/viewer/$id'
              >
                {demo.title}
              </Link>
            ))}
          </section>
        ))}
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  ),
  shellComponent: ({ children }: { children: ReactNode }) => (
    <html lang='en'>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
});
