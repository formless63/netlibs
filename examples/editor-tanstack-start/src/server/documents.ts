import {
  createDocumentService,
  importMarkdown,
  MemoryDocumentStore,
  type DocumentService
} from '@formless63/editor-core';

// Replace MemoryDocumentStore with a DocumentStore over your database.
const service: DocumentService = createDocumentService({ store: new MemoryDocumentStore() });

const ready = service.create({
  id: 'welcome',
  title: 'Welcome',
  actorId: 'system',
  content: importMarkdown(`## Server rendered

This page is produced by \`RenderDocument\` with **no editor code** loaded.

> [!TIP]
> Open *Edit* to load the editor in the browser.

\`\`\`ts
const answer: number = 42;
\`\`\``).document
});

export async function getDocumentService(): Promise<DocumentService> {
  await ready;
  return service;
}
