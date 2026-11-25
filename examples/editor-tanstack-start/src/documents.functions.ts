import { DocumentConflictError } from '@formless63/editor-core/model';
import { createServerFn } from '@tanstack/react-start';

// Documents cross the wire as JSON text: the content tree is open-ended, and
// the service validates it again on arrival anyway.

export const readDocument = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { getDocumentService } = await import('./server/documents.ts');
    const record = await (await getDocumentService()).get(id);
    return {
      id: record.id,
      title: record.title,
      version: record.version,
      content: JSON.stringify(record.content)
    };
  });

interface SaveInput {
  id: string;
  expectedVersion: number;
  content: string;
}

export const saveDocument = createServerFn({ method: 'POST' })
  .validator((input: SaveInput) => input)
  .handler(async ({ data }) => {
    // Authorize here and derive actorId from the session.
    const { getDocumentService } = await import('./server/documents.ts');
    try {
      const saved = await (await getDocumentService()).save({
        id: data.id,
        expectedVersion: data.expectedVersion,
        content: JSON.parse(data.content) as unknown,
        actorId: 'demo'
      });
      return { version: saved.version };
    } catch (error) {
      // Error classes do not survive the wire, so a conflict is returned as data.
      if (error instanceof DocumentConflictError) return { conflict: true as const };
      throw error;
    }
  });
