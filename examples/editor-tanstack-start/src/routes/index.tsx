import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <main>
      <h1>Example</h1>
      <Link params={{ documentId: 'welcome' }} to='/docs/$documentId'>
        Read the welcome document
      </Link>
    </main>
  )
});
