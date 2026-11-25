import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { ViewerProvider, type ViewerInput } from '@formless63/viewers';

import { authAdapter, DEMOS, registry } from '../demos.tsx';

const VIAS = ['url', 'blob', 'buffer', 'auth'] as const;
type Via = (typeof VIAS)[number];

export const Route = createFileRoute('/viewer/$id')({
  validateSearch: (search: Record<string, unknown>): { via: Via } => ({
    via: VIAS.find((via) => via === search['via']) ?? 'url',
  }),
  loader: ({ params }) => {
    if (!DEMOS.some((demo) => demo.id === params.id)) throw notFound();
  },
  component: Demo,
  notFoundComponent: () => <p>No such demo.</p>,
});

function Demo() {
  const { id } = Route.useParams();
  const { via } = Route.useSearch();
  const demo = DEMOS.find((candidate) => candidate.id === id)!;
  const [status, setStatus] = useState('idle');
  return (
    <ViewerProvider adapter={via === 'auth' ? authAdapter : undefined} registry={registry}>
      <h2>{demo.title}</h2>
      <p>{demo.note}</p>
      {demo.file ? (
        <div className='options'>
          <span>Read from:</span>
          {VIAS.map((option) => (
            <Link key={option} params={{ id }} search={{ via: option }} to='/viewer/$id'>
              {option}
            </Link>
          ))}
        </div>
      ) : null}
      <div className='panel' data-status={status} data-testid='panel' key={`${id}:${via}`}>
        {demo.file ? (
          <Sourced
            file={demo.file}
            render={(source) => demo.render({ source, onStatusChange: setStatus })}
            via={via}
          />
        ) : (
          demo.render({ source: '', onStatusChange: setStatus })
        )}
      </div>
    </ViewerProvider>
  );
}

function Sourced({
  file,
  via,
  render,
}: {
  file: string;
  via: Via;
  render: (source: ViewerInput) => React.ReactNode;
}) {
  const [source, setSource] = useState<ViewerInput | null>(
    via === 'url' ? `/fixtures/${file}` : via === 'auth' ? `/api/secure/${file}` : null,
  );
  useEffect(() => {
    if (via !== 'blob' && via !== 'buffer') return;
    void fetch(`/fixtures/${file}`)
      .then((response): Promise<ViewerInput> =>
        via === 'blob' ? response.blob() : response.arrayBuffer(),
      )
      .then(setSource);
  }, [file, via]);
  return source === null ? null : render(source);
}
