import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { FileViewer, ViewerProvider } from '@formless63/viewers';

import { registry } from '../demos.tsx';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <ViewerProvider registry={registry}>
      <h2>Open a local file</h2>
      <p>Nothing is uploaded. The file is read in this tab.</p>
      <label
        className='drop'
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setFile(event.dataTransfer.files[0] ?? null);
        }}
      >
        Drop a file here, or choose one:{' '}
        <input onChange={(event) => setFile(event.target.files?.[0] ?? null)} type='file' />
      </label>
      {file ? (
        <div className='panel'>
          <FileViewer header key={`${file.name}:${file.lastModified}`} source={file} />
        </div>
      ) : null}
    </ViewerProvider>
  );
}
