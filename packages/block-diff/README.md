# @formless63/block-diff

Compare two revisions of a block document (or any ordered list of things) and
say which blocks were added, removed, changed, or moved.

Text diffs and token diffs report a moved paragraph as a deletion and an
insertion. When blocks carry stable ids, this matches them wherever they went,
and reports as few moves as possible. When they do not, it falls back to content.

```ts
import { diffBlocks, summarizeBlockDiff } from '@formless63/block-diff';
import { proseMirrorDiff } from '@formless63/block-diff/prosemirror';

const diff = diffBlocks(before.content, after.content, proseMirrorDiff({ idAttribute: 'blockId' }));

for (const entry of diff) {
  if (entry.status === 'modified') showChange(entry.before, entry.after, entry.moved);
}
summarizeBlockDiff(diff); // { unchanged, modified, moved, added, removed }
```

Any other shape needs two functions:

```ts
diffBlocks(before, after, {
  getId: (row) => row.id,
  getContent: (row) => JSON.stringify([row.title, row.body]), // without the id
});
```

## What you get

Every block appears exactly once, in the order of the new revision. A removed
block follows the block it used to follow. Both revisions can be rebuilt from the
result.

| Status             | Meaning                                               |
| ------------------ | ----------------------------------------------------- |
| `unchanged`        | Same content, same relative order                     |
| `moved`            | Same content, different relative order                |
| `modified`         | Different content. `moved` says whether it also moved |
| `added`, `removed` | Only in the new, only in the old                      |

`matchedBy` says why two blocks were paired: `id`, `content`, or `replaced` (an
unidentified block that took a removed one's place).

## Behaviour worth knowing

- Two blocks with different ids are never matched, even if identical.
- A duplicated id belongs to its first block. The rest count as added.
- If ids appeared between the revisions, content is matched, so the change is not
  reported as a full rewrite.
- ProseMirror: ids at any depth are not content. Compare editor JSON with imported
  JSON using `ignoreNullAttrs`.
- Cost is dominated by unidentified blocks: exact up to about 4 million cells
  (2,000 × 2,000), anchored on unique content beyond that, so 20,000 blocks take
  well under a second.

It compares one level. For nested blocks call it again on the children of a
`modified` entry. For word-level changes inside one, use a text differ such as
[`diff`](https://www.npmjs.com/package/diff) on the two texts.

## Identity

```ts
import { ensureIds, renewIds } from '@formless63/block-diff';
import { proseMirrorTree } from '@formless63/block-diff/prosemirror';

const tree = proseMirrorTree(['paragraph', 'heading', 'listItem']);
ensureIds([doc], tree); // fill missing ids; the first of any duplicates keeps its id
renewIds([copy], tree); // give a copy its own identities
```

Both edit in place. Keeping ids stable while somebody types is the editor's job;
see Tiptap's `@tiptap/extension-unique-id`.
