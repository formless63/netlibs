/**
 * Languages highlighted by the live editor and the renderer. A small set, imported one by one to
 * limit bundle size; anything else is plain text. Keep both registrations in step with this list.
 */
export const RICH_CODE_BLOCK_LANGUAGE_NAMES = [
  'typescript',
  'javascript',
  'json',
  'bash',
  'python',
  'sql',
  'yaml',
  'css',
  'xml' // highlight.js registers HTML's grammar under "xml"; "html" is an alias.
] as const;

export const RICH_CODE_BLOCK_LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  typescript: ['ts', 'tsx'],
  javascript: ['js', 'jsx'],
  bash: ['sh', 'shell'],
  python: ['py'],
  yaml: ['yml'],
  xml: ['html']
};

export const RICH_CODE_BLOCK_DEFAULT_LANGUAGE = 'plaintext';
