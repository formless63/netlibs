import { SearchAndReplace } from './vendor/search-and-replace.ts';

/**
 * Find & replace: decorations and commands only, no schema impact.
 *
 * `Mod-f` opens the panel from inside the editor (native browser Find would
 * otherwise fire) by dispatching a plain `window` CustomEvent — same
 * DOM-event-to-sibling-React-component bridge `table-grips.ts`/
 * `drag-handle.ts` already use — picked up by the panel component
 * (`../components/editor-find-replace.tsx`), which owns all the UI
 * and calls this extension's `setSearchTerm`/`setReplaceTerm`/
 * `nextSearchResult`/`previousSearchResult`/`replace`/`replaceAll` commands.
 */
export const RICH_FIND_REPLACE_TOGGLE_EVENT = 'rich-find-replace-toggle';

const RichFindReplace = SearchAndReplace.extend({
  addKeyboardShortcuts() {
    return {
      'Mod-f': () => {
        this.editor.view.dom.dispatchEvent(new CustomEvent(RICH_FIND_REPLACE_TOGGLE_EVENT));
        return true;
      }
    };
  }
});

export function createRichFindReplaceExtension() {
  return RichFindReplace.configure({ searchResultClass: 'rich-search-result' });
}
