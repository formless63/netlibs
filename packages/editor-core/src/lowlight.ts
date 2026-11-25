import bashLanguage from 'highlight.js/lib/languages/bash';
import cssLanguage from 'highlight.js/lib/languages/css';
import javascriptLanguage from 'highlight.js/lib/languages/javascript';
import jsonLanguage from 'highlight.js/lib/languages/json';
import pythonLanguage from 'highlight.js/lib/languages/python';
import sqlLanguage from 'highlight.js/lib/languages/sql';
import typescriptLanguage from 'highlight.js/lib/languages/typescript';
import xmlLanguage from 'highlight.js/lib/languages/xml';
import yamlLanguage from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

import { RICH_CODE_BLOCK_LANGUAGE_ALIASES, RICH_CODE_BLOCK_LANGUAGE_NAMES } from './code-languages.ts';

// Grammar modules keyed by the same names `code-languages.ts` lists — the
// import specifiers must be static (bundlers can't tree-shake a dynamic
// `require`), but the *registration loop* below reads that shared list, so
// this map is the only place that has to grow if the curated set changes.
const LANGUAGE_MODULES: Record<(typeof RICH_CODE_BLOCK_LANGUAGE_NAMES)[number], unknown> = {
  typescript: typescriptLanguage,
  javascript: javascriptLanguage,
  json: jsonLanguage,
  bash: bashLanguage,
  python: pythonLanguage,
  sql: sqlLanguage,
  yaml: yamlLanguage,
  css: cssLanguage,
  xml: xmlLanguage
};

/**
 * Highlighter shared by the live editor and the renderer, registered with the small set in
 * `code-languages.ts`. Highlighting is decoration only and never changes the document.
 */
export function createRichLowlight() {
  const lowlight = createLowlight();
  for (const name of RICH_CODE_BLOCK_LANGUAGE_NAMES) {
    lowlight.register(name, LANGUAGE_MODULES[name] as never);
    const aliases = RICH_CODE_BLOCK_LANGUAGE_ALIASES[name];
    if (aliases?.length) lowlight.registerAlias({ [name]: [...aliases] });
  }
  return {
    ...lowlight,
    // Never guess: an unlisted language is plain text in the editor and the renderer alike.
    highlightAuto: (value: string): ReturnType<typeof lowlight.highlightAuto> => ({
      type: 'root',
      children: [{ type: 'text', value }],
      data: { language: undefined, relevance: 0 }
    })
  };
}

