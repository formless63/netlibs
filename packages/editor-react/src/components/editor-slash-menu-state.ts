import {
  RICH_CALLOUT_KINDS,
  type RichCalloutKind,
  type EditorDocument
} from '@formless63/editor-core';

/**
 * The slash-menu catalog. Commands with a UI step (image, resource, find) clear the query and emit
 * an event instead of inserting. Mermaid uses a code block with language `mermaid`.
 *
 * Tests run every command through `runRichSlashCommand()` on a live editor, so entries need no
 * sample documents.
 */

export type RichSlashCommandGroup = 'Basic' | 'Lists' | 'Alerts' | 'Insert' | 'Tools';

export const RICH_SLASH_COMMAND_GROUPS: readonly RichSlashCommandGroup[] = [
  'Basic',
  'Lists',
  'Alerts',
  'Insert',
  'Tools'
];

export interface RichSlashCommandDefinition {
  id: string;
  title: string;
  description: string;
  group: RichSlashCommandGroup;
  searchTerms: readonly string[];
}

const CALLOUT_TITLES: Record<RichCalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

const CALLOUT_DESCRIPTIONS: Record<RichCalloutKind, string> = {
  note: 'Blue note callout',
  tip: 'Green tip callout',
  important: 'Purple important callout',
  warning: 'Yellow warning callout',
  caution: 'Red caution callout'
};

function emptyParagraphDoc(): EditorDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export const RICH_SLASH_COMMANDS: readonly RichSlashCommandDefinition[] = [
  {
    id: 'heading-1',
    title: 'Heading 1',
    description: 'Big section title',
    group: 'Basic',
    searchTerms: ['h1', 'title', 'big']
  },
  {
    id: 'heading-2',
    title: 'Heading 2',
    description: 'Subsection title',
    group: 'Basic',
    searchTerms: ['h2']
  },
  {
    id: 'heading-3',
    title: 'Heading 3',
    description: 'Smaller heading',
    group: 'Basic',
    searchTerms: ['h3']
  },
  {
    id: 'heading-4',
    title: 'Heading 4',
    description: 'Smaller heading',
    group: 'Basic',
    searchTerms: ['h4']
  },
  {
    id: 'heading-5',
    title: 'Heading 5',
    description: 'Smaller heading',
    group: 'Basic',
    searchTerms: ['h5']
  },
  {
    id: 'heading-6',
    title: 'Heading 6',
    description: 'Smallest heading',
    group: 'Basic',
    searchTerms: ['h6']
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Block quote',
    group: 'Basic',
    searchTerms: ['blockquote']
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal line',
    group: 'Basic',
    searchTerms: ['hr', 'rule', 'line']
  },
  {
    id: 'code-block',
    title: 'Code block',
    description: 'Syntax-highlighted code',
    group: 'Basic',
    searchTerms: ['snippet', 'pre']
  },
  {
    id: 'mermaid',
    title: 'Mermaid diagram',
    description: 'Diagram source with a sandboxed preview',
    group: 'Basic',
    searchTerms: ['diagram', 'flowchart', 'sequence', 'graph']
  },
  {
    id: 'table',
    title: 'Table',
    description: '3x3 table',
    group: 'Basic',
    searchTerms: ['grid']
  },
  {
    id: 'bullet-list',
    title: 'Bullet list',
    description: 'Simple unordered list',
    group: 'Lists',
    searchTerms: ['ul', 'list']
  },
  {
    id: 'numbered-list',
    title: 'Numbered list',
    description: 'Ordered list',
    group: 'Lists',
    searchTerms: ['ol', 'list']
  },
  {
    id: 'task-list',
    title: 'Task list',
    description: 'Checkbox to-do list',
    group: 'Lists',
    searchTerms: ['todo', 'check']
  },
  ...RICH_CALLOUT_KINDS.map<RichSlashCommandDefinition>((kind) => ({
    id: `callout-${kind}`,
    title: `${CALLOUT_TITLES[kind]} callout`,
    description: CALLOUT_DESCRIPTIONS[kind],
    group: 'Alerts',
    searchTerms: [kind, 'callout', 'alert']
  })),
  {
    id: 'image',
    title: 'Image',
    description: 'Upload and insert an image',
    group: 'Insert',
    searchTerms: ['photo', 'picture', 'upload', 'img']
  },
  {
    id: 'resource',
    title: 'Resource',
    description: 'Insert a resource or a URL reference',
    group: 'Insert',
    searchTerms: ['file', 'link', 'attachment', 'card', 'reference', 'url']
  },
  {
    id: 'details',
    title: 'Toggle',
    description: 'Collapsible details block',
    group: 'Insert',
    searchTerms: ['toggle', 'collapse', 'accordion', 'expand', 'summary']
  },
  {
    id: 'math-block',
    title: 'Math block',
    description: 'KaTeX display equation',
    group: 'Insert',
    searchTerms: ['equation', 'latex', 'katex', 'formula']
  },
  {
    id: 'math-inline',
    title: 'Inline math',
    description: 'KaTeX expression inline with text',
    group: 'Insert',
    searchTerms: ['equation', 'latex', 'katex', 'formula', 'inline']
  },
  {
    id: 'children-index',
    title: 'Children index',
    description: 'Live list of child pages (/tree)',
    group: 'Insert',
    searchTerms: ['tree', 'children', 'index', 'pages', 'subpages']
  },
  {
    id: 'find-replace',
    title: 'Find & replace',
    description: 'Search and replace in this document',
    group: 'Tools',
    searchTerms: ['search', 'find', 'replace']
  },
  {
    id: 'invisible-characters',
    title: 'Toggle invisible characters',
    description: 'Show or hide spaces, paragraph marks, and line breaks',
    group: 'Tools',
    searchTerms: ['whitespace', 'spaces', 'paragraph marks', 'formatting marks']
  }
];

export function filterRichSlashCommands(
  items: readonly RichSlashCommandDefinition[],
  query: string
): RichSlashCommandDefinition[] {
  if (!query) return [...items];
  const q = query.toLowerCase();
  return items.filter((item) => {
    const haystack = [item.title, item.description, ...item.searchTerms].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function groupRichSlashCommands(
  items: readonly RichSlashCommandDefinition[]
): Record<RichSlashCommandGroup, RichSlashCommandDefinition[]> {
  const grouped: Record<RichSlashCommandGroup, RichSlashCommandDefinition[]> = {
    Basic: [],
    Lists: [],
    Alerts: [],
    Insert: [],
    Tools: []
  };
  for (const item of items) grouped[item.group].push(item);
  return grouped;
}

// Exported for tests.
export { emptyParagraphDoc as editorEmptyParagraphDocument };
