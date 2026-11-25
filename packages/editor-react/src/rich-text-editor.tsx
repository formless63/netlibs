'use client';

/* eslint-disable react/refs, react/preserve-manual-memoization, react/memo-dependencies, react/no-unstable-nested-components, react/set-state-in-effect, react-hooks/exhaustive-deps */

import {
  applyRichLinkUpdate,
  buildRichMarkdownReferenceManifest,
  canonicalizeRichHref,
  richLinkAttrsForHref,
  richMarkdownFidelityRequiresConfirm,
  createEditorExtensions,
  describeRichMarkdownFidelityLosses,
  detectRichMarkdownFidelityFlags,
  getRichLinkText,
  ensureBlockIds,
  formatRichStableDocumentLink,
  importMarkdown,
  isSafeMediaUrl,
  joinRichFidelityLossParts,
  normalizeEmptyEditorDocument,
  nullResolver,
  openDocument,
  parseRichStableDocumentLink,
  restoreEditorViewMode,
  serializeMarkdown,
  validateEditorDocument,
  writeStoredEditorViewMode,
  type RichChildrenIndexNodeRow,
  type RichImportFinding,
  type RichMarkdownFidelityFlags,
  type RichResourceSelector,
  type DocumentLinkTarget,
  type EditorDocument,
  type EditorResolver,
  type EditorRichTextViewMode,
  type EditorSaveState,
  type EditorViewMode
} from '@formless63/editor-core';
import type { Extensions } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  IconCode,
  IconDeviceFloppy,
  IconLink,
  IconList,
  IconPaperclip,
  IconSourceCode,
  IconUpload
} from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Ref
} from 'react';
import { createRoot } from 'react-dom/client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useIsMobile
} from './ui/index.tsx';
import { cn } from './ui/cn.ts';

import { EditorBubbleMenu } from './components/editor-bubble-menu.tsx';
import { EditorDragHandleMenu } from './components/editor-drag-handle-menu.tsx';
import { createRichEmojiSuggestionExtension } from './components/editor-emoji-menu.tsx';
import { EditorFindReplace } from './components/editor-find-replace.tsx';
import { EditorImageMenu } from './components/editor-image-menu.tsx';
import { EditorPreview } from './components/editor-preview.tsx';
import { createRichSlashMenuExtension } from './components/editor-slash-menu.tsx';
import { EditorSourceFidelityNotice } from './components/editor-source-fidelity-notice.tsx';
import { EditorSourceView } from './components/editor-source-view.tsx';
import { EditorTableControls } from './components/editor-table-controls.tsx';
import { EditorToolbar } from './components/editor-toolbar.tsx';
import { createRichFindReplaceExtension } from './find-replace.ts';
import {
  editorHasUnsavedChanges,
  editorSourceBufferIsDirty
} from './navigation-guard.ts';
import {
  insertRichResourcePick,
  RICH_RESOURCE_PICKER_EVENT,
  type RichResourcePickResult
} from './resource-picker.ts';
import {
  beginEditorSave,
  canEditorAutosave,
  createRichAutosaveScheduleState,
  createRichSaveVersionTracker,
  finishEditorSave,
  EDITOR_SAVE_MESSAGES,
  editorSaveIsRedundant,
  markEditorEdited,
  resetRichAutosaveScheduleState,
  scheduleRichAutosave,
  toPlainEditorJson
} from './save-state.ts';
import {
  createRichUploadExtension,
  handleRichUploadFiles,
  RICH_IMAGE_PICKER_EVENT,
  type RichUploadProgressEvent,
  type RichUploadResult
} from './upload-drop.ts';
import { RichMermaidViewer } from './viewers/mermaid-viewer.tsx';
import { RichResourceViewer } from './viewers/resource-viewer.tsx';


export interface RichTextEditorDocumentOption {
  id: string;
  title: string;
}

export interface RichTextEditorResourceOption {
  id: string;
  title: string;
  description?: string | null;
  /** `file` (default) or any host kind; `app_*` kinds insert as inline chips. */
  kind?: string;
  selector?: RichResourceSelector;
}

export interface RichTextEditorTaskOption {
  id: string;
  title: string;
}

export interface RichTextEditorProps {
  documentId: string;
  /** A `doc` in any supported schema version, or a versioned envelope. */
  initialContent: unknown;
  /** The stored version this content was read at. */
  version: number;
  readOnly?: boolean;
  /**
   * Persists a change. Reject with `code: 'VERSION_CONFLICT'` (what
   * `DocumentConflictError` carries) or `status: 409` for a stale version.
   */
  onSave: (input: {
    content: EditorDocument;
    expectedVersion: number;
  }) => Promise<{ version: number }>;
  /** Turns stored ids into URLs. Pass a stable object; it is read at mount. */
  resolver?: EditorResolver;
  /** Stores a file and returns its resource id. Omit to disable uploads. */
  onUpload?: (file: File) => Promise<{ id: string; name: string; mimeType: string }>;
  documents?: RichTextEditorDocumentOption[];
  /** In-app navigation for document links. Without it the browser follows the resolved URL. */
  onOpenDocument?: (target: DocumentLinkTarget) => void;
  /** In-app navigation for other same-origin URLs; return false to let the browser handle it. */
  onNavigate?: (href: string) => boolean | void;
  resources?: RichTextEditorResourceOption[];
  tasks?: RichTextEditorTaskOption[];
  /** Rows shown by a `/tree` children index. */
  childDocuments?: readonly RichChildrenIndexNodeRow[];
  onContentChange?: (content: EditorDocument) => void;
  onCreateComment?: (input: {
    documentId: string;
    selectedText: string;
  }) => Promise<{ id: string }>;
  /** Fires whenever unsaved state changes, so a host router can block navigation. */
  onUnsavedChange?: (state: UnsavedState) => void;
  /** Warn on tab close/reload while there are unsaved changes. Default true. */
  warnBeforeUnload?: boolean;
  /** Extra view-only extensions. They must not add nodes, marks or attributes. */
  extensions?: Extensions;
  placeholder?: string;
  autosaveDelayMs?: number;
  autosaveMaxIntervalMs?: number;
  className?: string;
  ref?: Ref<RichTextEditorHandle>;
}

export interface UnsavedState {
  hasUnsavedChanges: boolean;
  /** The Markdown buffer holds edits that have not been applied to the document. */
  sourceBufferDirty: boolean;
  saveState: EditorSaveState;
}

export interface RichTextEditorHandle {
  /** Applies any pending Markdown buffer and saves. Resolves true once nothing is unsaved. */
  save: () => Promise<boolean>;
  hasUnsavedChanges: () => boolean;
  getContent: () => EditorDocument;
  focus: () => void;
  /** The underlying Tiptap editor, or null before mount. */
  getEditor: () => Editor | null;
}

interface HeadingEntry {
  level: number;
  position: number;
  title: string;
}

interface PendingLink {
  from: number;
  to: number;
  href: string;
  text: string;
}

const EMPTY_DOCUMENT: EditorDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
};
const EMPTY_DOCUMENT_OPTIONS: RichTextEditorDocumentOption[] = [];
const EMPTY_RESOURCE_OPTIONS: RichTextEditorResourceOption[] = [];
const EMPTY_TASK_OPTIONS: RichTextEditorTaskOption[] = [];
const EMPTY_CHILDREN: readonly RichChildrenIndexNodeRow[] = [];

const EMPTY_FIDELITY_FLAGS: RichMarkdownFidelityFlags = {
  commentMarkCount: 0,
  tableColumnWidthCount: 0,
  alignedImageCount: 0,
  resizedImageCount: 0,
  previewFileCardCount: 0,
  flattenedTableCellCount: 0
};

function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; name?: unknown };
  return (
    candidate.status === 409 ||
    candidate.code === 'VERSION_CONFLICT' ||
    candidate.name === 'VersionConflictError'
  );
}

function resolveLinkTarget(
  resolver: EditorResolver,
  href: string
): { href: string; newTab: boolean } | null {
  const canonical = canonicalizeRichHref(href);
  if (!canonical) return null;
  const stable = parseRichStableDocumentLink(canonical);
  if (stable) {
    const url = resolver.documentHref(stable);
    return url ? { href: url, newTab: false } : null;
  }
  if (canonical.startsWith('/') || canonical.startsWith('#')) {
    return { href: canonical, newTab: false };
  }
  try {
    const url = new URL(canonical);
    return {
      href: canonical,
      newTab: url.protocol === 'http:' || url.protocol === 'https:'
    };
  } catch {
    return null;
  }
}

function collectHeadings(editor: Editor): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return true;
    headings.push({
      level: typeof node.attrs.level === 'number' ? node.attrs.level : 1,
      position,
      title: node.textContent || 'Untitled heading'
    });
    return false;
  });
  return headings;
}

function EditorOutline({
  editor,
  headings,
  id,
  className,
  onNavigate
}: {
  editor: Editor;
  headings: HeadingEntry[];
  id: string;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label='Document outline' className={cn('rich-editor__outline', className)} id={id}>
      {headings.length > 0 ? (
        headings.map((heading, index) => (
          <button
            key={heading.position}
            onClick={() => {
              editor
                .chain()
                .focus()
                .setTextSelection(heading.position + 1)
                .run();
              const headingElements = editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6');
              headingElements[index]?.scrollIntoView({ block: 'center' });
              onNavigate?.();
            }}
            style={{ paddingInlineStart: `${Math.max(0, heading.level - 1) * 12 + 8}px` }}
            type='button'
          >
            {heading.title}
          </button>
        ))
      ) : (
        <span>No headings yet.</span>
      )}
    </nav>
  );
}

function selectedMermaidSource(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== 'codeBlock' || $from.parent.attrs.language !== 'mermaid') {
    return null;
  }
  return $from.parent.textContent;
}

function normalizeLinkInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = canonicalizeRichHref(trimmed);
  if (direct) return direct;
  if (!trimmed.includes(' ') && trimmed.includes('.')) {
    return canonicalizeRichHref(`https://${trimmed}`);
  }
  return null;
}

interface InitialContent {
  initialDocument: EditorDocument;
  initialValidation: Pick<ReturnType<typeof validateEditorDocument>, 'success' | 'findings'>;
}

/** Content the editor cannot represent is shown as an error, never loaded and overwritten. */
function openInitialContent(value: unknown): InitialContent {
  try {
    const opened = normalizeEmptyEditorDocument(openDocument(value)) as EditorDocument;
    const initialValidation = validateEditorDocument(opened);
    // Ids are assigned here rather than by the editor's own create hook, which
    // would count as an edit and save a new version just for opening a page.
    const initialDocument = initialValidation.success ? ensureBlockIds(opened) : opened;
    return { initialDocument, initialValidation };
  } catch (error) {
    return {
      initialDocument: EMPTY_DOCUMENT,
      initialValidation: {
        success: false,
        findings: [
          {
            code: 'invalid_canonical_document',
            severity: 'error',
            message: error instanceof Error ? error.message : 'The document could not be read.'
          }
        ]
      }
    };
  }
}

export function RichTextEditor(props: RichTextEditorProps) {
  return <RichTextEditorSession key={props.documentId} {...props} />;
}

function RichTextEditorSession({
  documentId,
  initialContent,
  version,
  readOnly = false,
  onSave,
  onUpload,
  documents = EMPTY_DOCUMENT_OPTIONS,
  onOpenDocument,
  onNavigate,
  resolver: resolverProp = nullResolver,
  onUnsavedChange,
  warnBeforeUnload = true,
  extensions: extraExtensions,
  placeholder,
  ref,
  resources = EMPTY_RESOURCE_OPTIONS,
  tasks = EMPTY_TASK_OPTIONS,
  childDocuments = EMPTY_CHILDREN,
  onContentChange,
  onCreateComment,
  autosaveDelayMs = 1500,
  autosaveMaxIntervalMs = 30_000,
  className
}: RichTextEditorProps) {
  const [{ initialDocument, initialValidation }] = useState(() => openInitialContent(initialContent));
  const childrenAtMount = useRef(childDocuments).current;
  const resolver = useRef(resolverProp).current;
  const supportsUploads = useRef(Boolean(onUpload)).current;
  const [saveState, setSaveState] = useState<EditorSaveState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewMode, setViewModeState] = useState<EditorViewMode>('richtext');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [mermaidSource, setMermaidSource] = useState<string | null>(null);
  const [sourceBuffer, setSourceBuffer] = useState('');
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(true);
  const [sourceBlockingFindings, setSourceBlockingFindings] = useState<RichImportFinding[]>([]);
  const [sourceViewKey, setSourceViewKey] = useState(0);
  const [pendingLossyConfirm, setPendingLossyConfirm] = useState<{
    flags: RichMarkdownFidelityFlags;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [uploadEvents, setUploadEvents] = useState<RichUploadProgressEvent[]>([]);
  const isMobile = useIsMobile();
  const outlineId = useId();
  const linkTextInputId = useId();
  const linkHrefInputId = useId();

  const saveStateRef = useRef<EditorSaveState>('idle');
  const versionRef = useRef(version);
  const saveVersionsRef = useRef(createRichSaveVersionTracker());
  const autosaveScheduleRef = useRef(createRichAutosaveScheduleState());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef(initialDocument);
  const sourceReferenceManifestRef = useRef<ReturnType<
    typeof buildRichMarkdownReferenceManifest
  > | null>(null);
  const sourceInitialBufferRef = useRef<string | null>(null);
  const sourceFidelityFlagsRef = useRef<RichMarkdownFidelityFlags | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const onSaveRef = useRef(onSave);
  const onUploadRef = useRef(onUpload);
  const onOpenDocumentRef = useRef(onOpenDocument);
  const onNavigateRef = useRef(onNavigate);
  const onUnsavedChangeRef = useRef(onUnsavedChange);
  const onContentChangeRef = useRef(onContentChange);
  const readOnlyRef = useRef(readOnly);
  onSaveRef.current = onSave;
  onUploadRef.current = onUpload;
  onOpenDocumentRef.current = onOpenDocument;
  onNavigateRef.current = onNavigate;
  onUnsavedChangeRef.current = onUnsavedChange;
  onContentChangeRef.current = onContentChange;
  readOnlyRef.current = readOnly;

  const sourceBufferDirty = editorSourceBufferIsDirty({
    active: viewMode === 'source',
    initialBuffer: sourceInitialBufferRef.current,
    currentBuffer: sourceBuffer
  });
  const hasUnsavedChanges = editorHasUnsavedChanges({
    saveState,
    sourceBufferDirty
  });
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  useEffect(() => {
    onUnsavedChangeRef.current?.({ hasUnsavedChanges, sourceBufferDirty, saveState });
  }, [hasUnsavedChanges, saveState, sourceBufferDirty]);

  useEffect(() => {
    if (!warnBeforeUnload || !hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges, warnBeforeUnload]);

  const updateSaveState = useCallback((next: EditorSaveState) => {
    saveStateRef.current = next;
    setSaveState(next);
    if (next !== 'error') setErrorMessage(null);
  }, []);

  const setViewMode = useCallback((mode: EditorViewMode) => {
    setViewModeState(mode);
    writeStoredEditorViewMode(
      typeof window === 'undefined' ? null : window.localStorage,
      mode
    );
  }, []);

  useEffect(() => {
    if (readOnly) {
      setViewModeState('richtext');
      return;
    }
    setViewModeState(
      restoreEditorViewMode(typeof window === 'undefined' ? null : window.localStorage)
    );
  }, [readOnly]);

  const onUploadProgress = useCallback((event: RichUploadProgressEvent) => {
    setUploadEvents((current) => [
      ...current.filter((existing) => existing.id !== event.id),
      event
    ]);
    if (event.status !== 'uploading') {
      const timeout = event.status === 'error' ? 5000 : 1500;
      window.setTimeout(() => {
        setUploadEvents((current) => current.filter((existing) => existing.id !== event.id));
      }, timeout);
    }
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<RichUploadResult> => {
    const upload = onUploadRef.current;
    if (!upload) throw new Error('Uploads are unavailable');
    const result = await upload(file);
    const url = resolver.resourceHref(result.id, 'content');
    if (url && !isSafeMediaUrl(url)) throw new Error('Upload resolved to an unsafe media URL');
    return {
      resourceId: result.id,
      title: result.name || file.name || 'Uploaded file',
      contentType: result.mimeType
    };
  }, []);

  const navigate = useCallback((href: string): void => {
    const handled = onNavigateRef.current?.(href);
    if (handled === undefined ? !onNavigateRef.current : !handled) window.location.assign(href);
  }, []);

  const openLink = useCallback((href: string): boolean => {
    const canonical = canonicalizeRichHref(href);
    if (!canonical) return false;
    const stable = parseRichStableDocumentLink(canonical);
    if (stable) {
      if (onOpenDocumentRef.current) {
        onOpenDocumentRef.current(stable);
        return true;
      }
      const url = resolver.documentHref(stable);
      if (!url) return false;
      navigate(url);
      return true;
    }
    if (canonical.startsWith('/') || canonical.startsWith('#')) {
      navigate(canonical);
      return true;
    }
    try {
      const url = new URL(canonical);
      if (url.protocol === 'mailto:') {
        window.location.assign(canonical);
        return true;
      }
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        window.open(canonical, '_blank', 'noopener,noreferrer');
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }, []);

  const editorExtensions = useMemo(
    () => [
      ...createEditorExtensions({
        childrenIndexRows: childrenAtMount,
        resolver,
        placeholder,
        onChildrenIndexNavigate: navigate,
        onLinkOpen: openLink,
        resolveLinkTarget: (href) => resolveLinkTarget(resolver, href),
        mountFilePreview: (slot, props) => {
          const root = createRoot(slot);
          root.render(
            <RichResourceViewer
              kind={props.viewerKey}
              sizeBytes={props.sizeBytes}
              src={props.src}
              title={props.title}
            />
          );
          return () => queueMicrotask(() => root.unmount());
        }
      }),
      createRichSlashMenuExtension(),
      createRichEmojiSuggestionExtension(),
      createRichFindReplaceExtension(),
      ...(extraExtensions ?? []),
      ...(supportsUploads
        ? [
            createRichUploadExtension({
              uploadFn: uploadFile,
              onProgress: onUploadProgress
            })
          ]
        : [])
    ],
    []
  );

  const scheduleAutosave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const { state, decision } = scheduleRichAutosave(
      autosaveScheduleRef.current,
      Date.now(),
      autosaveDelayMs,
      autosaveMaxIntervalMs
    );
    autosaveScheduleRef.current = state;
    if (decision.action === 'save-now') {
      void saveRef.current();
      return;
    }
    saveTimerRef.current = setTimeout(() => void saveRef.current(), decision.delayMs);
  }, [autosaveDelayMs, autosaveMaxIntervalMs]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly && initialValidation.success,
    extensions: editorExtensions,
    content: initialValidation.success ? initialDocument : EMPTY_DOCUMENT,
    editorProps: {
      attributes: {
        class: 'rich-content rich-editor__content'
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      const content = toPlainEditorJson(currentEditor.getJSON()) as EditorDocument;
      if (readOnlyRef.current) return;
      onContentChangeRef.current?.(content);
      saveVersionsRef.current = markEditorEdited(saveVersionsRef.current);
      if (saveStateRef.current !== 'conflict' && saveVersionsRef.current.inFlightVersion === null) {
        updateSaveState('dirty');
        scheduleAutosave();
      }
    }
  });

  const save = useCallback(async () => {
    if (
      !editor ||
      readOnly ||
      !initialValidation.success ||
      !canEditorAutosave(saveStateRef.current)
    ) {
      return;
    }
    if (saveStateRef.current !== 'dirty' && saveStateRef.current !== 'error') return;

    autosaveScheduleRef.current = resetRichAutosaveScheduleState();
    const content = toPlainEditorJson(editor.getJSON()) as EditorDocument;
    if (editorSaveIsRedundant(content, lastSavedContentRef.current)) {
      saveVersionsRef.current = {
        ...saveVersionsRef.current,
        savedVersion: saveVersionsRef.current.editVersion
      };
      updateSaveState('saved');
      return;
    }

    const started = beginEditorSave(saveVersionsRef.current);
    if (!started) return;
    saveVersionsRef.current = started;

    const validation = validateEditorDocument(content);
    if (!validation.success) {
      saveVersionsRef.current = { ...saveVersionsRef.current, inFlightVersion: null };
      setErrorMessage(validation.findings[0]?.message ?? 'Document content is invalid.');
      updateSaveState('error');
      return;
    }

    updateSaveState('saving');
    try {
      const result = await onSaveRef.current({
        content: content,
        expectedVersion: versionRef.current
      });
      versionRef.current = result.version;
      lastSavedContentRef.current = content;
      const completed = finishEditorSave(saveVersionsRef.current);
      saveVersionsRef.current = completed.tracker;
      updateSaveState(completed.state);
      if (completed.state === 'dirty') scheduleAutosave();
    } catch (error) {
      saveVersionsRef.current = { ...saveVersionsRef.current, inFlightVersion: null };
      if (isVersionConflict(error)) {
        updateSaveState('conflict');
      } else {
        setErrorMessage(
          error instanceof Error ? error.message : 'This document could not be saved.'
        );
        updateSaveState('error');
      }
    }
  }, [editor, initialValidation.success, readOnly, scheduleAutosave, updateSaveState]);
  saveRef.current = save;

  useEffect(() => {
    if (
      saveVersionsRef.current.inFlightVersion === null &&
      saveVersionsRef.current.editVersion === saveVersionsRef.current.savedVersion
    ) {
      versionRef.current = version;
    }
  }, [version]);

  useEffect(() => {
    editor?.setEditable(!readOnly && initialValidation.success, false);
  }, [editor, initialValidation.success, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const updateDerivedState = () => {
      const next = collectHeadings(editor);
      setHeadings((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next
      );
      setMermaidSource(selectedMermaidSource(editor));
    };
    editor.on('transaction', updateDerivedState);
    editor.on('selectionUpdate', updateDerivedState);
    updateDerivedState();
    return () => {
      editor.off('transaction', updateDerivedState);
      editor.off('selectionUpdate', updateDerivedState);
    };
  }, [editor]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editor) return;
    const host = editor.view.dom;
    const openImagePicker = () => imageInputRef.current?.click();
    const openReferencePicker = () => setReferencePickerOpen(true);
    host.addEventListener(RICH_IMAGE_PICKER_EVENT, openImagePicker);
    host.addEventListener(RICH_RESOURCE_PICKER_EVENT, openReferencePicker);
    return () => {
      host.removeEventListener(RICH_IMAGE_PICKER_EVENT, openImagePicker);
      host.removeEventListener(RICH_RESOURCE_PICKER_EVENT, openReferencePicker);
    };
  }, [editor]);

  const handleFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!editor || !onUpload || files.length === 0) return;
      void handleRichUploadFiles(editor, files, editor.state.selection.from, {
        uploadFn: uploadFile,
        onProgress: onUploadProgress
      });
    },
    [editor, onUpload, onUploadProgress, uploadFile]
  );

  const requestLink = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    setLinkError(null);
    setPendingLink({
      from,
      to,
      href:
        typeof editor.getAttributes('link').href === 'string'
          ? editor.getAttributes('link').href
          : '',
      text: getRichLinkText(editor)
    });
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || !pendingLink) return;
    const href = normalizeLinkInput(pendingLink.href);
    if (!href) {
      setLinkError('Enter a safe web, email, relative, or document link.');
      return;
    }
    editor.commands.setTextSelection({ from: pendingLink.from, to: pendingLink.to });
    if (pendingLink.from === pendingLink.to) {
      const text = pendingLink.text.trim() || href;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text,
          marks: [{ type: 'link', attrs: richLinkAttrsForHref(href) }]
        })
        .run();
    } else {
      applyRichLinkUpdate(editor, href, pendingLink.text);
    }
    setPendingLink(null);
  }, [editor, pendingLink]);

  const requestComment = useCallback(() => {
    if (!editor || !onCreateComment || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    void onCreateComment({ documentId, selectedText }).then(({ id }) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        setErrorMessage('Comment creation returned an invalid identifier.');
        updateSaveState('error');
        return;
      }
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setMark('comment', { commentId: id })
        .run();
    });
  }, [documentId, editor, onCreateComment, updateSaveState]);

  const requestLossyConfirm = useCallback(
    (flags: RichMarkdownFidelityFlags) =>
      new Promise<boolean>((resolve) => setPendingLossyConfirm({ flags, resolve })),
    []
  );

  const enterSourceMode = useCallback(() => {
    if (!editor || readOnly) return;
    const content = toPlainEditorJson(editor.getJSON()) as EditorDocument;
    sourceReferenceManifestRef.current = buildRichMarkdownReferenceManifest(content);
    sourceFidelityFlagsRef.current = detectRichMarkdownFidelityFlags(content);
    const markdown = serializeMarkdown(content);
    sourceInitialBufferRef.current = markdown;
    setSourceBuffer(markdown);
    setSourceBlockingFindings([]);
    setSourceViewKey((current) => current + 1);
    setViewMode('source');
  }, [editor, readOnly, setViewMode]);

  const commitSourceBuffer = useCallback(async () => {
    if (!editor || sourceReferenceManifestRef.current === null) return false;
    const result = importMarkdown(sourceBuffer, {
      referenceManifest: sourceReferenceManifestRef.current
    });
    if (!result.canCommit) {
      setSourceBlockingFindings(result.findings);
      return false;
    }
    const validation = validateEditorDocument(result.document);
    if (!validation.success) {
      setSourceBlockingFindings(validation.findings);
      return false;
    }
    setSourceBlockingFindings([]);
    const flags = sourceFidelityFlagsRef.current;
    if (flags && richMarkdownFidelityRequiresConfirm(flags)) {
      const confirmed = await requestLossyConfirm(flags);
      if (!confirmed) return false;
    }
    editor.commands.setContent(result.document, { emitUpdate: true });
    sourceReferenceManifestRef.current = buildRichMarkdownReferenceManifest(result.document);
    sourceFidelityFlagsRef.current = detectRichMarkdownFidelityFlags(result.document);
    sourceInitialBufferRef.current = sourceBuffer;
    return true;
  }, [editor, requestLossyConfirm, sourceBuffer]);

  const commitSourceBufferRef = useRef(commitSourceBuffer);
  commitSourceBufferRef.current = commitSourceBuffer;
  const sourceBufferDirtyRef = useRef(sourceBufferDirty);
  sourceBufferDirtyRef.current = sourceBufferDirty;
  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        if (sourceBufferDirtyRef.current && !(await commitSourceBufferRef.current())) return false;
        await saveRef.current();
        return !editorHasUnsavedChanges({
          saveState: saveStateRef.current,
          sourceBufferDirty: false
        });
      },
      hasUnsavedChanges: () => hasUnsavedChangesRef.current,
      getContent: () =>
        editor ? (toPlainEditorJson(editor.getJSON()) as EditorDocument) : initialDocument,
      focus: () => void editor?.commands.focus(),
      getEditor: () => editor
    }),
    [editor, initialDocument]
  );

  const exitSourceMode = useCallback(
    async (target: EditorRichTextViewMode) => {
      if (await commitSourceBuffer()) setViewMode(target);
    },
    [commitSourceBuffer, setViewMode]
  );

  const insertResource = useCallback(
    (resource: RichTextEditorResourceOption) => {
      if (!editor) return;
      const picked: RichResourcePickResult = {
        resourceId: resource.id,
        title: resource.title,
        description: resource.description ?? null,
        kind: resource.kind ?? 'file',
        selector: resource.selector ?? 'live'
      };
      insertRichResourcePick(editor, editor.state.selection.to, picked);
      setReferencePickerOpen(false);
    },
    [editor]
  );

  const insertTask = useCallback(
    (task: RichTextEditorTaskOption) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'taskReference',
          attrs: { taskId: task.id, fallbackTitle: task.title }
        })
        .run();
      setReferencePickerOpen(false);
    },
    [editor]
  );

  if (!initialValidation.success) {
    return (
      <div
        className={cn('rich-editor__notice', className)}
        role='alert'
      >
        <p className='ce:font-medium ce:text-destructive-ink'>
          This document cannot be opened in the editor.
        </p>
        <p className='ce:mt-1 ce:text-sm ce:text-muted-foreground'>
          {initialValidation.findings[0]?.message ?? 'The canonical editor JSON is invalid.'}
        </p>
      </div>
    );
  }

  if (!editor) {
    return (
      <div className={cn('rich-editor__notice', className)}>
        Loading editor…
      </div>
    );
  }

  const richTextVisible = readOnly || viewMode !== 'source';

  return (
    <div className={cn('rich-editor', className)}>
      <div className='rich-editor__topbar'>
        {!readOnly ? (
          <select
            aria-label='Editor mode'
            className='rich-ui-select'
            onChange={(event) => {
              const next = event.target.value;
              if (next !== 'richtext' && next !== 'richtext-toolbar' && next !== 'source') return;
              if (next === 'source') {
                if (viewMode !== 'source') enterSourceMode();
              } else if (viewMode === 'source') {
                void exitSourceMode(next);
              } else {
                setViewMode(next);
              }
            }}
            value={viewMode}
          >
            <option value='richtext'>Rich text</option>
            <option value='richtext-toolbar'>Traditional</option>
            <option value='source'>Markdown</option>
          </select>
        ) : null}
        <div className='rich-editor__topbar-actions'>
          <Button
            aria-controls={outlineId}
            aria-pressed={outlineOpen}
            onClick={() => setOutlineOpen((current) => !current)}
            size='sm'
            type='button'
            variant='ghost'
          >
            <IconList className='ce:size-4' />
            Outline
          </Button>
          {!readOnly && (resources.length > 0 || tasks.length > 0) ? (
            <Button
              onClick={() => setReferencePickerOpen(true)}
              size='sm'
              type='button'
              variant='ghost'
            >
              <IconPaperclip className='ce:size-4' />
              Reference
            </Button>
          ) : null}
          {!readOnly && onUpload ? (
            <Button
              onClick={() => fileInputRef.current?.click()}
              size='sm'
              type='button'
              variant='ghost'
            >
              <IconUpload className='ce:size-4' />
              File
            </Button>
          ) : null}
          {!readOnly ? (
            <Button
              disabled={saveState === 'saving' || saveState === 'conflict'}
              onClick={() => void save()}
              size='sm'
              type='button'
              variant='outline'
            >
              <IconDeviceFloppy className='ce:size-4' />
              Save
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn('rich-editor__editor-layout', outlineOpen && !isMobile && 'rich-editor__layout-with-outline')}
        data-editor-layout=''
        data-outline-layout={outlineOpen && !isMobile ? 'sidebar' : 'closed'}
      >
        <section className='rich-editor__surface' data-editor-surface=''>
          {!readOnly && richTextVisible ? (
            <EditorBubbleMenu
              editor={editor}
              onRequestComment={onCreateComment ? requestComment : undefined}
              onRequestLink={requestLink}
            />
          ) : null}
          {!readOnly && richTextVisible ? <EditorTableControls editor={editor} /> : null}
          {!readOnly && richTextVisible ? (
            <EditorDragHandleMenu documentId={documentId} editor={editor} resolver={resolver} />
          ) : null}
          {!readOnly && richTextVisible ? <EditorFindReplace editor={editor} hideTrigger={viewMode === 'richtext-toolbar'} /> : null}
          {!readOnly && richTextVisible ? <EditorImageMenu editor={editor} /> : null}
          {!readOnly && onUpload ? (
            <input
              accept='image/png,image/jpeg,image/gif,image/webp,image/avif'
              className='ce:hidden'
              multiple
              onChange={handleFileInput}
              ref={imageInputRef}
              type='file'
            />
          ) : null}
          {!readOnly && onUpload ? (
            <input
              className='ce:hidden'
              multiple
              onChange={handleFileInput}
              ref={fileInputRef}
              type='file'
            />
          ) : null}

          <div className={cn(!richTextVisible && 'ce:hidden')}>
            {!readOnly && viewMode === 'richtext-toolbar' ? (
              <EditorToolbar editor={editor} onRequestLink={requestLink} />
            ) : null}
            <EditorContent className='rich-editor__editor-viewport' editor={editor} />
            {mermaidSource !== null ? (
              <div className='rich-editor__mermaid-panel'>
                <div>
                  <IconCode className='ce:size-4' />
                  Mermaid preview
                </div>
                <RichMermaidViewer source={mermaidSource} />
              </div>
            ) : null}
          </div>

          {!readOnly && viewMode === 'source' ? (
            <div className='rich-editor__source-mode' data-rich-source-mode=''>
              <div className='rich-editor__source-header'>
                <span>Markdown source</span>
                <div className='ce:flex ce:gap-1'>
                  <Button
                    aria-pressed={sourcePreviewOpen}
                    onClick={() => setSourcePreviewOpen((current) => !current)}
                    size='sm'
                    type='button'
                    variant='ghost'
                  >
                    {sourcePreviewOpen ? 'Hide preview' : 'Show preview'}
                  </Button>
                  <Button
                    onClick={() => {
                      void commitSourceBuffer().then((committed) => {
                        if (committed) queueMicrotask(() => void saveRef.current());
                      });
                    }}
                    size='sm'
                    type='button'
                    variant='outline'
                  >
                    Save Markdown
                  </Button>
                </div>
              </div>
              <EditorSourceFidelityNotice
                flags={sourceFidelityFlagsRef.current ?? EMPTY_FIDELITY_FLAGS}
              />
              {sourceBlockingFindings.length > 0 ? (
                <div className='rich-editor__source-errors' role='alert'>
                  <p>This Markdown cannot be committed yet.</p>
                  <ul>
                    {sourceBlockingFindings.map((finding, index) => (
                      <li key={`${finding.code}-${index}`}>{finding.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className={cn('rich-editor__source-grid', !sourcePreviewOpen && 'rich-editor__source-grid-single')}>
                <EditorSourceView
                  key={sourceViewKey}
                  onChange={setSourceBuffer}
                  placeholder='Write Markdown…'
                  value={sourceBuffer}
                />
                {sourcePreviewOpen ? (
                  <EditorPreview
                    markdown={sourceBuffer}
                    resolver={resolver}
                    referenceManifest={
                      sourceReferenceManifestRef.current ?? { resources: [], tasks: [] }
                    }
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {uploadEvents.length > 0 ? (
            <div aria-live='polite' className='rich-editor__uploads' role='status'>
              {uploadEvents.map((event) => (
                <div data-status={event.status} key={event.id}>
                  {event.status === 'uploading'
                    ? `Uploading ${event.filename}…`
                    : event.status === 'done'
                      ? `Uploaded ${event.filename}`
                      : `Failed to upload ${event.filename}`}
                </div>
              ))}
            </div>
          ) : null}

          <footer className='rich-editor__footer'>
            <span
              aria-live='polite'
              className={cn(
                (saveState === 'conflict' || saveState === 'error') && 'ce:text-destructive-ink'
              )}
              role={saveState === 'conflict' || saveState === 'error' ? 'alert' : 'status'}
            >
              {readOnly
                ? 'Read only'
                : saveState === 'error' && errorMessage
                  ? errorMessage
                  : EDITOR_SAVE_MESSAGES[saveState]}
            </span>
            <span>Version {versionRef.current}</span>
          </footer>
        </section>

        {outlineOpen && !isMobile ? (
          <EditorOutline editor={editor} headings={headings} id={outlineId} />
        ) : null}
      </div>

      <Sheet open={outlineOpen && isMobile} onOpenChange={setOutlineOpen}>
        <SheetContent
          className='ce:w-[min(22rem,85vw)] ce:gap-0 ce:p-0'
          data-rich-outline-drawer=''
          side='right'
        >
          <SheetHeader>
            <SheetTitle>Document outline</SheetTitle>
            <SheetDescription>Jump to a heading in this document.</SheetDescription>
          </SheetHeader>
          <EditorOutline
            className='rich-editor__outline-drawer-nav'
            editor={editor}
            headings={headings}
            id={outlineId}
            onNavigate={() => setOutlineOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <Dialog
        open={pendingLink !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLink(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit link</DialogTitle>
            <DialogDescription>
              Link to a document or enter a safe web, email, anchor, or relative URL.
            </DialogDescription>
          </DialogHeader>
          <label className='ce:grid ce:gap-1 ce:text-sm' htmlFor={linkTextInputId}>
            Text
            <Input
              id={linkTextInputId}
              value={pendingLink?.text ?? ''}
              onChange={(event) =>
                setPendingLink((current) =>
                  current ? { ...current, text: event.target.value } : current
                )
              }
            />
          </label>
          <label className='ce:grid ce:gap-1 ce:text-sm' htmlFor={linkHrefInputId}>
            Link
            <Input
              autoFocus
              id={linkHrefInputId}
              value={pendingLink?.href ?? ''}
              onChange={(event) => {
                setLinkError(null);
                setPendingLink((current) =>
                  current ? { ...current, href: event.target.value } : current
                );
              }}
            />
          </label>
          {documents.length > 0 ? (
            <div className='rich-editor__document-links'>
              {documents.map((document) => (
                <button
                  key={document.id}
                  onClick={() =>
                    setPendingLink((current) =>
                      current
                        ? {
                            ...current,
                            href: formatRichStableDocumentLink({
                              documentId: document.id,
                              anchor: null
                            }),
                            text: current.text || document.title
                          }
                        : current
                    )
                  }
                  type='button'
                >
                  <IconLink className='ce:size-4' />
                  {document.title}
                </button>
              ))}
            </div>
          ) : null}
          {linkError ? <p className='ce:text-sm ce:text-destructive-ink'>{linkError}</p> : null}
          <DialogFooter>
            <Button onClick={() => setPendingLink(null)} type='button' variant='outline'>
              Cancel
            </Button>
            <Button onClick={applyLink} type='button'>
              Apply link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={referencePickerOpen} onOpenChange={setReferencePickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert reference</DialogTitle>
            <DialogDescription>
              Insert an authorized media card or a task reference into this document.
            </DialogDescription>
          </DialogHeader>
          <div className='rich-editor__reference-list'>
            {resources.map((resource) => (
              <button key={resource.id} onClick={() => insertResource(resource)} type='button'>
                <strong>{resource.title}</strong>
                <span>{resource.kind ?? 'file'}</span>
              </button>
            ))}
            {tasks.map((task) => (
              <button key={task.id} onClick={() => insertTask(task)} type='button'>
                <strong>{task.title}</strong>
                <span>Task</span>
              </button>
            ))}
            {resources.length === 0 && tasks.length === 0 ? (
              <p className='ce:text-sm ce:text-muted-foreground'>No references are available.</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingLossyConfirm !== null}
        onOpenChange={(open) => {
          if (open || !pendingLossyConfirm) return;
          const { resolve } = pendingLossyConfirm;
          setPendingLossyConfirm(null);
          resolve(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Markdown cannot represent every feature</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingLossyConfirm
                ? `Continuing will remove ${joinRichFidelityLossParts(
                    describeRichMarkdownFidelityLosses(pendingLossyConfirm.flags)
                  )} from this document.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingLossyConfirm) return;
                const { resolve } = pendingLossyConfirm;
                setPendingLossyConfirm(null);
                resolve(true);
              }}
            >
              Remove and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
