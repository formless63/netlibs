import type { EditorDocument, EditorNode } from '../src/index.ts';

export const RESOURCE_ID = '11111111-1111-4111-8111-111111111111';

export const text = (value: string, ...marks: NonNullable<EditorNode['marks']>): EditorNode => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {})
});
export const p = (...content: Array<string | EditorNode>): EditorNode => {
  const nodes = content.map((part) => (typeof part === 'string' ? text(part) : part));
  return { type: 'paragraph', ...(nodes.length ? { content: nodes } : {}) };
};
export const li = (...content: EditorNode[]): EditorNode => ({ type: 'listItem', content });
export const ul = (...content: EditorNode[]): EditorNode => ({ type: 'bulletList', content });
export const ol = (...content: EditorNode[]): EditorNode => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content
});
export const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

/** A document that uses every reference type. */
export const sampleDocument = (): EditorDocument =>
  doc(
    {
      type: 'heading',
      attrs: { level: 2, anchorId: 'intro', blockId: 'b_0123456789ABCDEF' },
      content: [text('Intro')]
    },
    p(
      text('internal', {
        type: 'link',
        attrs: { href: 'rich-doc:abc#top', targetDocumentId: 'abc', targetAnchor: 'top' }
      }),
      { type: 'customEmoji', attrs: { name: 'octocat' } },
      {
        type: 'resourceChip',
        attrs: { resourceId: RESOURCE_ID, title: 'Part 7', kind: 'app_part', selector: 'live' }
      }
    ),
    {
      type: 'image',
      attrs: {
        src: `rich-resource:${RESOURCE_ID}`,
        resourceId: RESOURCE_ID,
        alt: 'Rack',
        title: 'rack.png',
        width: 480,
        align: 'center'
      }
    },
    {
      type: 'resourceCard',
      attrs: {
        resourceId: RESOURCE_ID,
        title: 'manual.pdf',
        kind: 'file',
        selector: 'live',
        presentation: 'preview',
        height: 400,
        caption: 'The manual'
      }
    },
    { type: 'taskReference', attrs: { taskId: 't1', fallbackTitle: 'Ship it' } }
  );
