import {
  canonicalizeRichHref,
  RICH_CALLOUT_COLORS,
  RICH_CALLOUT_KINDS,
  RICH_IMAGE_ALIGNMENTS,
  RICH_IMAGE_WIDTH_MAX,
  richFileDownloadName,
  richFileExtensionLabel,
  richResourceCardViewerKey,
  richResourceChipKindLabel,
  childrenIndexChildCountLabel,
  CHILDREN_INDEX_EMPTY_LABEL,
  createRichLowlight,
  DEFAULT_CHILDREN_INDEX_SORT,
  formatRichFileSize,
  formatChildrenIndexDate,
  isRichCustomEmojiName,
  isSafeMediaUrl,
  nullResolver,
  openDocument,
  parseRichStableDocumentLink,
  resourceKindLabel,
  SAFE_ANCHOR_PATTERN,
  sortChildrenIndexRows,
  type RichCalloutKind,
  type RichChildrenIndexNodeRow,
  type EditorDocument,
  type EditorMark,
  type EditorNode,
  type EditorResolver
} from '@formless63/editor-core/model';
import type { ElementContent, Root } from 'hast';
import katex from 'katex';
import { Fragment, type ComponentType, type CSSProperties, type JSX, type ReactNode } from 'react';

/**
 * Read-only renderer. Plain synchronous React with no hooks, effects, browser
 * globals, Tiptap or ProseMirror, so it runs in any server renderer, in static
 * generation and as a React Server Component.
 *
 * It does not assume the document was validated: unknown nodes degrade to
 * their children and every URL is checked at the point of output.
 */

export interface NodeComponentProps {
  node: EditorNode;
  children: ReactNode;
  resolver: EditorResolver;
}

/** Replacements for individual node types, e.g. a hydrated PDF viewer for `resourceCard`. */
export type NodeComponents = Partial<Record<string, ComponentType<NodeComponentProps>>>;

export interface RenderDocumentProps {
  /** A `doc` in any supported schema version, or a versioned envelope. */
  document: unknown;
  resolver?: EditorResolver;
  components?: NodeComponents;
  className?: string;
  /** Rows for a `/tree` children index. Without them the index renders nothing. */
  childrenIndexRows?: readonly RichChildrenIndexNodeRow[] | null;
  /** Byte sizes for file cards, by resource id. */
  resourceSizes?: Readonly<Record<string, number>>;
  /** Added to every heading level, clamped to h6 (e.g. 1 when the page already has an h1). */
  headingOffset?: number;
  /** Give headings without an authored anchor a slug id. Default true. */
  autoHeadingIds?: boolean;
  /** Emit `blockId`s as element ids so block deep links scroll. Default false. */
  blockAnchors?: boolean;
  /** `rel` for links to other origins. */
  externalLinkRel?: string;
}

interface Context {
  resolver: EditorResolver;
  components: NodeComponents;
  childrenIndexRows: readonly RichChildrenIndexNodeRow[] | null;
  resourceSizes: Readonly<Record<string, number>>;
  headingOffset: number;
  headingIds: Map<EditorNode, string>;
  blockAnchors: boolean;
  externalLinkRel: string;
}

const CALLOUT_LABELS: Record<RichCalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};
const CALLOUT_ICONS: Record<RichCalloutKind, string> = {
  note: 'i',
  tip: '◆',
  important: '!',
  warning: '▲',
  caution: '■'
};

const lowlight = createRichLowlight();

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

function plainText(node: EditorNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plainText).join('');
}

export function slugifyHeading(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `section${slug ? `-${slug}` : ''}`;
}

export interface TableOfContentsEntry {
  id: string;
  level: number;
  text: string;
}

/** Authored anchors are kept verbatim; generated slugs are made unique around them. */
function assignHeadingIds(root: EditorNode, auto: boolean): Map<EditorNode, string> {
  const headings: EditorNode[] = [];
  const visit = (node: EditorNode): void => {
    if (node.type === 'heading') headings.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  const ids = new Map<EditorNode, string>();
  const used = new Set<string>();
  for (const heading of headings) {
    const anchor = str(heading.attrs?.anchorId);
    if (!SAFE_ANCHOR_PATTERN.test(anchor) || used.has(anchor)) continue;
    used.add(anchor);
    ids.set(heading, anchor);
  }
  if (!auto) return ids;
  for (const heading of headings) {
    if (ids.has(heading)) continue;
    const base = slugifyHeading(plainText(heading));
    let id = base;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
    used.add(id);
    ids.set(heading, id);
  }
  return ids;
}

/** Headings, in document order, with exactly the ids `RenderDocument` emits. */
export function getTableOfContents(
  document: unknown,
  options: { autoHeadingIds?: boolean } = {}
): TableOfContentsEntry[] {
  const root = openDocument(document);
  const ids = assignHeadingIds(root, options.autoHeadingIds ?? true);
  const entries: TableOfContentsEntry[] = [];
  const visit = (node: EditorNode): void => {
    const id = ids.get(node);
    if (id) entries.push({ id, level: Number(node.attrs?.level ?? 1), text: plainText(node) });
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  return entries;
}

interface ResolvedLink {
  href: string;
  external: boolean;
}

/** The URL to output for a stored href, or `null` when it must render as plain text. */
export function resolveDocumentHref(raw: unknown, resolver: EditorResolver): ResolvedLink | null {
  const canonical = typeof raw === 'string' ? canonicalizeRichHref(raw) : null;
  if (!canonical) return null;
  const target = parseRichStableDocumentLink(canonical);
  if (target) {
    const href = resolver.documentHref(target);
    return href ? { href, external: false } : null;
  }
  return { href: canonical, external: /^https?:/.test(canonical) };
}

function mediaUrl(
  ctx: Context,
  resourceId: string,
  purpose: 'content' | 'download' | 'preview'
): string | null {
  const url = resourceId ? ctx.resolver.resourceHref(resourceId, purpose) : null;
  return url && isSafeMediaUrl(url) ? url : null;
}

const MARK_ORDER = ['code', 'superscript', 'subscript', 'bold', 'italic', 'strike', 'link'];

function renderMark(mark: EditorMark, children: ReactNode, ctx: Context): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'strike':
      return <s>{children}</s>;
    case 'code':
      return <code>{children}</code>;
    case 'superscript':
      return <sup>{children}</sup>;
    case 'subscript':
      return <sub>{children}</sub>;
    case 'link': {
      const link = resolveDocumentHref(mark.attrs?.href, ctx.resolver);
      if (!link) return children;
      const title = str(mark.attrs?.title) || undefined;
      return link.external ? (
        <a href={link.href} rel={ctx.externalLinkRel} title={title}>
          {children}
        </a>
      ) : (
        <a href={link.href} title={title}>
          {children}
        </a>
      );
    }
    // Comment anchors are private annotations and never reach the output.
    default:
      return children;
  }
}

function renderText(node: EditorNode, ctx: Context): ReactNode {
  return (node.marks ?? [])
    .toSorted((left, right) => MARK_ORDER.indexOf(left.type) - MARK_ORDER.indexOf(right.type))
    .reduce<ReactNode>((children, mark) => renderMark(mark, children, ctx), node.text ?? '');
}

function renderHast(nodes: readonly (ElementContent | Root['children'][number])[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const names = node.properties.className;
    return (
      <span className={Array.isArray(names) ? names.join(' ') : undefined} key={index}>
        {renderHast(node.children)}
      </span>
    );
  });
}

function CodeBlock({ node }: { node: EditorNode }): JSX.Element {
  const source = plainText(node);
  const language = str(node.attrs?.language).toLowerCase();
  const known = language && lowlight.registered(language);
  return (
    <pre data-language={language || undefined}>
      <code className={language ? `language-${language.replace(/[^\w+#.-]/g, '')}` : undefined}>
        {known ? renderHast(lowlight.highlight(language, source).children) : source}
      </code>
    </pre>
  );
}

function MathNode({ node, display }: { node: EditorNode; display: boolean }): JSX.Element {
  const latex = str(node.attrs?.latex);
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 200
  });
  // KaTeX escapes its input and `trust: false` disables URL/HTML commands.
  const props = { 'data-latex': latex, dangerouslySetInnerHTML: { __html: html } };
  return display ? (
    <div className='rich-math-block' {...props} />
  ) : (
    <span className='rich-math-inline' {...props} />
  );
}

function ImageNode({ node, ctx }: { node: EditorNode; ctx: Context }): JSX.Element {
  const attrs = node.attrs ?? {};
  const src = mediaUrl(ctx, str(attrs.resourceId), 'content');
  const alt = str(attrs.alt);
  const caption = str(attrs.description);
  const width = imageWidth(attrs.width);
  return (
    <figure className='rich-image' data-align={oneOf(attrs.align, RICH_IMAGE_ALIGNMENTS)}>
      {src ? (
        <img alt={alt} decoding='async' loading='lazy' src={src} style={width} />
      ) : (
        <span aria-label={alt || 'Image unavailable'} className='rich-image-fallback' role='img'>
          {alt || 'Image unavailable'}
        </span>
      )}
      {caption ? <figcaption className='rich-image-caption'>{caption}</figcaption> : null}
    </figure>
  );
}

function imageWidth(value: unknown): CSSProperties | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? { width: `${Math.min(value, RICH_IMAGE_WIDTH_MAX)}px` }
    : undefined;
}

function FileBar({
  title,
  description,
  download,
  size
}: {
  title: string;
  description: string;
  download: string | null;
  size: string | null;
}): JSX.Element {
  const meta = [size, description].filter(Boolean).join(' · ');
  return (
    <>
      <span aria-hidden='true' className='rich-file-card__icon'>
        {richFileExtensionLabel(title)}
      </span>
      <span className='rich-file-card__body'>
        <strong className='rich-file-card__name' title={title}>
          {title}
        </strong>
        {meta ? <span className='rich-file-card__meta'>{meta}</span> : null}
      </span>
      {download ? (
        <a
          className='rich-file-card__download'
          download={richFileDownloadName(title) ?? undefined}
          href={download}
        >
          Download
        </a>
      ) : null}
    </>
  );
}

function ResourceCard({ node, ctx }: { node: EditorNode; ctx: Context }): JSX.Element {
  const attrs = node.attrs ?? {};
  const resourceId = str(attrs.resourceId);
  const title = str(attrs.title) || 'Untitled resource';
  const description = str(attrs.description);
  const kind = str(attrs.kind);
  if (kind !== 'file') {
    const label = resourceKindLabel(kind, ctx.resolver);
    const href = mediaUrl(ctx, resourceId, 'content');
    const body = (
      <>
        <strong>{title}</strong>
        {label ? <span className='rich-reference-card__badge'>{label}</span> : null}
        {description ? <span>{description}</span> : null}
      </>
    );
    const className = 'rich-reference-card rich-reference-card--resource';
    return href ? (
      <a className={className} href={href}>
        {body}
      </a>
    ) : (
      <div className={className}>{body}</div>
    );
  }

  const bar = (
    <FileBar
      description={description}
      download={mediaUrl(ctx, resourceId, 'download')}
      size={formatRichFileSize(ctx.resourceSizes[resourceId])}
      title={title}
    />
  );
  const viewer = richResourceCardViewerKey(kind, title);
  const src = mediaUrl(ctx, resourceId, 'preview');
  const height = typeof attrs.height === 'number' ? `${attrs.height}px` : undefined;
  const media =
    attrs.presentation === 'preview' && src ? (
      viewer === 'image' ? (
        <img alt={title} decoding='async' loading='lazy' src={src} style={{ height }} />
      ) : viewer === 'audio' ? (
        <audio controls preload='metadata' src={src} />
      ) : viewer === 'video' ? (
        <video controls playsInline preload='metadata' src={src} style={{ height }} />
      ) : null
    ) : null;
  // PDF and STL need a client viewer; without one (see `components`) they stay a card.
  if (!media) return <div className='rich-reference-card rich-file-card'>{bar}</div>;
  const caption = str(attrs.caption);
  return (
    <figure
      className='rich-file-preview-view'
      data-align={oneOf(attrs.align, RICH_IMAGE_ALIGNMENTS)}
      style={imageWidth(attrs.width)}
    >
      <div className='rich-file-preview-slot'>{media}</div>
      <div className='rich-file-card rich-file-preview-bar'>{bar}</div>
      {caption ? <figcaption className='rich-image-caption'>{caption}</figcaption> : null}
    </figure>
  );
}

function ResourceChip({ node, ctx }: { node: EditorNode; ctx: Context }): JSX.Element {
  const attrs = node.attrs ?? {};
  const title = str(attrs.title) || 'Untitled resource';
  const href = mediaUrl(ctx, str(attrs.resourceId), 'content');
  const body = (
    <>
      <span aria-hidden='true' className='rich-resource-chip__kind'>
        {richResourceChipKindLabel(str(attrs.kind) || 'file', title, ctx.resolver)}
      </span>
      <span className='rich-resource-chip__label'>{title}</span>
    </>
  );
  return href ? (
    <a className='rich-resource-chip' href={href} title={title}>
      {body}
    </a>
  ) : (
    <span className='rich-resource-chip' title={title}>
      {body}
    </span>
  );
}

function TaskReference({ node, ctx }: { node: EditorNode; ctx: Context }): JSX.Element {
  const title = str(node.attrs?.fallbackTitle) || 'Linked task';
  const raw = ctx.resolver.taskHref?.(str(node.attrs?.taskId)) ?? null;
  const href = raw ? canonicalizeRichHref(raw) : null;
  const className = 'rich-reference-card rich-reference-card--task';
  return href ? (
    <a className={className} href={href}>
      <strong>{title}</strong>
    </a>
  ) : (
    <div className={className}>
      <strong>{title}</strong>
    </div>
  );
}

function ChildrenIndex({ ctx }: { ctx: Context }): JSX.Element | null {
  const rows = ctx.childrenIndexRows;
  if (!rows) return null;
  if (rows.length === 0) {
    return (
      <div className='rich-children-index rich-children-index--resolved'>
        <span className='rich-children-index__empty'>{CHILDREN_INDEX_EMPTY_LABEL}</span>
      </div>
    );
  }
  return (
    <nav aria-label='Child pages' className='rich-children-index rich-children-index--resolved'>
      <ul className='rich-children-index__list'>
        {sortChildrenIndexRows(rows, DEFAULT_CHILDREN_INDEX_SORT).map((row) => {
          const count = childrenIndexChildCountLabel(row.childCount);
          const href = canonicalizeRichHref(row.href);
          return (
            <li className='rich-children-index__item' key={row.id}>
              <span className='rich-children-index__col rich-children-index__col--title'>
                {href ? <a href={href}>{row.title}</a> : row.title}
                {count ? <span className='rich-children-index__count'> {count}</span> : null}
              </span>
              <span className='rich-children-index__col'>{formatChildrenIndexDate(row.updatedAt)}</span>
              <span className='rich-children-index__col'>
                {formatChildrenIndexDate(row.publishedAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TableNode({ node, ctx }: { node: EditorNode; ctx: Context }): JSX.Element {
  const rows = node.content ?? [];
  const headRows = rows[0]?.content?.every((cell) => cell.type === 'tableHeader') ? 1 : 0;
  const widths = (rows[0]?.content ?? []).map((cell) => {
    const value = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth[0] : null;
    return typeof value === 'number' ? value : null;
  });
  const renderRow = (row: EditorNode, index: number, head: boolean): JSX.Element => (
    <tr key={index}>
      {(row.content ?? []).map((cell, cellIndex) => {
        const content = renderNodes(cell.content, ctx);
        return cell.type === 'tableHeader' ? (
          <th key={cellIndex} scope={head ? 'col' : 'row'}>
            {content}
          </th>
        ) : (
          <td key={cellIndex}>{content}</td>
        );
      })}
    </tr>
  );
  return (
    <div className='tableWrapper'>
      <table>
        {widths.some((width) => width !== null) ? (
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={width ? { width: `${width}px` } : undefined} />
            ))}
          </colgroup>
        ) : null}
        {headRows > 0 ? <thead>{rows.slice(0, 1).map((row, i) => renderRow(row, i, true))}</thead> : null}
        {rows.length > headRows ? (
          <tbody>{rows.slice(headRows).map((row, i) => renderRow(row, i, false))}</tbody>
        ) : null}
      </table>
    </div>
  );
}

function renderNodes(nodes: readonly EditorNode[] | undefined, ctx: Context): ReactNode {
  return (nodes ?? []).map((node, index) => (
    <Fragment key={str(node.attrs?.blockId) || index}>{renderNode(node, ctx)}</Fragment>
  ));
}

function renderNode(node: EditorNode, ctx: Context): ReactNode {
  const Override = ctx.components[node.type];
  if (Override) {
    return (
      <Override node={node} resolver={ctx.resolver}>
        {renderNodes(node.content, ctx)}
      </Override>
    );
  }
  const attrs = node.attrs ?? {};
  const id = ctx.blockAnchors ? str(attrs.blockId) || undefined : undefined;
  const children = (): ReactNode => renderNodes(node.content, ctx);

  switch (node.type) {
    case 'text':
      return renderText(node, ctx);
    case 'hardBreak':
      return <br />;
    case 'paragraph':
      // An empty paragraph keeps its line, as it does in the editor.
      return <p id={id}>{node.content?.length ? children() : <br />}</p>;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs.level ?? 1) + ctx.headingOffset));
      const Tag = `h${level}` as 'h1';
      const anchor = ctx.headingIds.get(node);
      return (
        <Tag id={anchor ?? id}>
          {anchor && id ? <span id={id} /> : null}
          {children()}
        </Tag>
      );
    }
    case 'bulletList':
      return <ul id={id}>{children()}</ul>;
    case 'orderedList': {
      const start = Number(attrs.start ?? 1);
      return (
        <ol id={id} start={Number.isInteger(start) && start !== 1 ? start : undefined}>
          {children()}
        </ol>
      );
    }
    case 'listItem':
      return <li id={id}>{children()}</li>;
    case 'taskList':
      return (
        <ul data-type='taskList' id={id}>
          {children()}
        </ul>
      );
    case 'taskItem': {
      const checked = attrs.checked === true;
      return (
        <li data-checked={checked} id={id}>
          <input
            aria-label={checked ? 'Completed' : 'Not completed'}
            checked={checked}
            disabled
            readOnly
            type='checkbox'
          />
          <div>{children()}</div>
        </li>
      );
    }
    case 'blockquote':
      return <blockquote id={id}>{children()}</blockquote>;
    case 'horizontalRule':
      return <hr id={id} />;
    case 'codeBlock':
      return <CodeBlock node={node} />;
    case 'table':
      return <TableNode ctx={ctx} node={node} />;
    case 'callout': {
      const kind = oneOf(attrs.kind, RICH_CALLOUT_KINDS) ?? 'note';
      const title = str(attrs.title).trim();
      const label = title ? `${CALLOUT_LABELS[kind]}: ${title}` : CALLOUT_LABELS[kind];
      return (
        <aside
          aria-label={label}
          className='rich-callout'
          data-callout-color={oneOf(attrs.color, RICH_CALLOUT_COLORS)}
          data-callout-kind={kind}
          id={id}
          role='note'
        >
          <div className='rich-callout__label'>
            <span aria-hidden='true' className='rich-callout__icon'>
              {CALLOUT_ICONS[kind]}
            </span>
            <span className='rich-callout__label-text'>{label}</span>
          </div>
          <div className='rich-callout__body'>{children()}</div>
        </aside>
      );
    }
    case 'details':
      return (
        <details className='rich-details' id={id} open={attrs.open === true}>
          {children()}
        </details>
      );
    case 'detailsSummary':
      return <summary>{children()}</summary>;
    case 'detailsContent':
      return <div>{children()}</div>;
    case 'inlineMath':
      return <MathNode display={false} node={node} />;
    case 'blockMath':
      return <MathNode display node={node} />;
    case 'customEmoji':
      return isRichCustomEmojiName(attrs.name) ? (
        <span className='rich-custom-emoji'>:{attrs.name}:</span>
      ) : null;
    case 'image':
      return <ImageNode ctx={ctx} node={node} />;
    case 'resourceCard':
      return <ResourceCard ctx={ctx} node={node} />;
    case 'resourceChip':
      return <ResourceChip ctx={ctx} node={node} />;
    case 'taskReference':
      return <TaskReference ctx={ctx} node={node} />;
    case 'childrenIndex':
      return <ChildrenIndex ctx={ctx} />;
    default:
      return node.content ? children() : null;
  }
}

export function RenderDocument({
  document,
  resolver = nullResolver,
  components = {},
  className,
  childrenIndexRows = null,
  resourceSizes = {},
  headingOffset = 0,
  autoHeadingIds = true,
  blockAnchors = false,
  externalLinkRel = 'noopener noreferrer nofollow'
}: RenderDocumentProps): JSX.Element {
  const root: EditorDocument = openDocument(document);
  const ctx: Context = {
    resolver,
    components,
    childrenIndexRows,
    resourceSizes,
    headingOffset,
    headingIds: assignHeadingIds(root, autoHeadingIds),
    blockAnchors,
    externalLinkRel
  };
  return (
    <div className={className ? `rich-content ${className}` : 'rich-content'}>
      {renderNodes(root.content, ctx)}
    </div>
  );
}
