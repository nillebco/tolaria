import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { compactMarkdown } from '../utils/compact-markdown'
import { failNoteOpenTrace, finishNoteOpenTrace } from '../utils/noteOpenPerformance'
import {
  serializeRichEditorBodyToMarkdown,
  serializeRichEditorDocumentToMarkdown,
} from '../utils/richEditorMarkdown'
import { useEditorMountState, useLatestRef } from './editorTabSwapLifecycle'
import {
  applyBlankStateToEditor,
  applyBlocksToEditor,
  type EditorContentPathRef,
} from './editorContentSwapApply'
import {
  consumeRawModeTransition,
  flushBeforePathChange,
  flushBeforeRawMode,
  useDebouncedEditorChange,
} from './editorChangeDebounce'
import {
  blankParagraphBlocks,
  extractEditorBody,
  getH1TextFromBlocks,
  isUntitledPath,
  pathStem,
  slugifyPathStem,
} from './editorTabContent'
import { clearEditorDomSelection, EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import {
  cacheEditorState,
  cacheParsedEditorState,
  cacheResolvedEditorState,
  isBlankBodyContent,
  resolveBlocksForTarget,
  resolveEmptyHeadingBlocks,
  startsWithEmptyHeading,
  type CachedTabState,
} from './editorBlockResolution'
import {
  createSwapToken,
  invalidatePendingSwap,
  shouldAbortSwap,
  type SwapToken,
} from './editorSwapToken'
import { useParsedBlockPreload } from './editorParsedBlockPreload'
export { extractEditorBody, getH1TextFromBlocks, replaceTitleInFrontmatter } from './editorTabContent'
export { RICH_EDITOR_CHANGE_DEBOUNCE_MS } from './editorChangeDebounce'

interface Tab {
  entry: VaultEntry
  content: string
}

type PendingLocalContent = { path: string; content: string }

interface TabSwapState {
  cache: Map<string, CachedTabState>
  prevPath: string | null
  pathChanged: boolean
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  rawModeJustEnded: boolean
}

interface UseEditorTabSwapOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  entries?: VaultEntry[]
  onContentChange?: (path: string, content: string) => void
  onEditorActivity?: () => void
  /** When true, the BlockNote editor is hidden (raw/CodeMirror mode active). */
  rawMode?: boolean
  vaultPath?: string
}

interface RunTabSwapEffectOptions {
  tabs: Tab[]
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  entries?: VaultEntry[]
  rawMode?: boolean
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  prevRawModeRef: MutableRefObject<boolean>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  flushPendingEditorChange: () => boolean
  vaultPath?: string
}

interface UseTabSwapEffectOptions extends Omit<RunTabSwapEffectOptions, 'vaultPath'> {
  vaultPathRef: MutableRefObject<string | undefined>
}

type ParsedBlockPreloadEvent = { path: string; content: string }

function signalEditorTabSwapped(path: string): void {
  window.dispatchEvent(new CustomEvent('laputa:editor-tab-swapped', {
    detail: { path },
  }))
  finishNoteOpenTrace(path)
}

function readEditorScrollTop(): number {
  const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
  return scrollEl?.scrollTop ?? 0
}

interface PreservedEditorPosition {
  cursorSelection?: { from: number; to: number }
  scrollTop: number
  cursorIndex: number
}

type EditorBlockWithId = { id?: string }

function readTiptapSelection(editor: ReturnType<typeof useCreateBlockNote>): { from: number; to: number } | undefined {
  const selection = (editor as {
    _tiptapEditor?: { state?: { selection?: { from?: unknown; to?: unknown } } }
    prosemirrorState?: { selection?: { from?: unknown; to?: unknown } }
  })._tiptapEditor?.state?.selection
    ?? (editor as { prosemirrorState?: { selection?: { from?: unknown; to?: unknown } } }).prosemirrorState?.selection

  return typeof selection?.from === 'number' && typeof selection?.to === 'number'
    ? { from: selection.from, to: selection.to }
    : undefined
}

function captureEditorPosition(
  editor: ReturnType<typeof useCreateBlockNote>,
): PreservedEditorPosition | null {
  try {
    const cursorBlock = editor.getTextCursorPosition?.().block
    if (!cursorBlock) return null
    const cursorIndex = (editor.document as EditorBlockWithId[]).findIndex((block) => block.id === cursorBlock.id)
    if (cursorIndex === -1) return null
    return {
      cursorSelection: readTiptapSelection(editor),
      scrollTop: readEditorScrollTop(),
      cursorIndex,
    }
  } catch {
    return null
  }
}

function restoreEditorPosition(
  editor: ReturnType<typeof useCreateBlockNote>,
  preservedPosition: PreservedEditorPosition | null | undefined,
) {
  if (!preservedPosition) return
  const setTextSelection = (editor as {
    _tiptapEditor?: { commands?: { setTextSelection?: (selection: { from: number; to: number }) => unknown } }
  })._tiptapEditor?.commands?.setTextSelection
  if (preservedPosition.cursorSelection && typeof setTextSelection === 'function') {
    try {
      setTextSelection(preservedPosition.cursorSelection)
      return
    } catch {
      // Fall back to the block-level cursor if the exact selection is stale.
    }
  }

  const newBlocks = editor.document
  if (newBlocks.length === 0) return
  const idx = Math.min(preservedPosition.cursorIndex, newBlocks.length - 1)
  try {
    editor.setTextCursorPosition(newBlocks[idx].id, 'start')
  } catch {
    // Ignore transient BlockNote cursor errors during async content swaps.
  }
}

function findActiveTab(options: {
  tabs: Tab[]
  activeTabPath: string | null
}): Tab | undefined {
  const { tabs, activeTabPath } = options
  return activeTabPath
    ? tabs.find(tab => tab.entry.path === activeTabPath)
    : undefined
}

function serializeEditorBody(editor: ReturnType<typeof useCreateBlockNote>): string {
  return serializeRichEditorBodyToMarkdown(editor)
}

function trySerializeEditorBody(
  editor: ReturnType<typeof useCreateBlockNote>,
  reason: string,
): string | null {
  try {
    return serializeEditorBody(editor)
  } catch (error) {
    console.warn(`[editor] Skipped ${reason} because BlockNote document could not be serialized:`, error)
    return null
  }
}

function normalizeTabBody(options: { content: string }): string {
  const { content } = options
  return compactMarkdown(extractEditorBody(content))
}

function renameBodiesOverlap(options: {
  currentBody: string
  nextBody: string
}): boolean {
  const { currentBody, nextBody } = options
  const current = currentBody.trimEnd()
  const next = nextBody.trimEnd()
  return current === next
    || current.startsWith(next)
    || next.startsWith(current)
}

function isUntitledRenameTransition(
  prevPath: string | null,
  nextPath: string | null,
  activeTab: Tab | undefined,
  editor: ReturnType<typeof useCreateBlockNote>,
): boolean {
  if (!prevPath || !nextPath || !activeTab || !isUntitledPath(prevPath)) return false

  const currentHeading = getH1TextFromBlocks(editor.document)
  if (!currentHeading || slugifyPathStem(currentHeading) !== pathStem(nextPath)) return false
  const currentBody = trySerializeEditorBody(editor, 'untitled rename comparison')
  if (currentBody === null) return false

  return renameBodiesOverlap({
    currentBody,
    nextBody: normalizeTabBody({ content: activeTab.content }),
  })
}

function activeEditorChangePath(options: {
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
}): string | null {
  const { prevActivePathRef, editorContentPathRef } = options
  const path = prevActivePathRef.current
  if (!path || editorContentPathRef.current !== path) return null
  return path
}

function previousContentForPath(options: {
  path: string
  tabs: Tab[]
  cache: Map<string, CachedTabState>
}): string | undefined {
  const { path, tabs, cache } = options
  return tabs.find(t => t.entry.path === path)?.content ?? cache.get(path)?.sourceContent
}

function serializedEditorChange(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  path: string
  previousContent: string
  vaultPath?: string
}): { blocks: CachedTabState['blocks'], content: string } | null {
  const { editor, path, previousContent, vaultPath } = options
  const blocks = editor.document
  try {
    return {
      blocks,
      content: serializeRichEditorDocumentToMarkdown(editor, previousContent, vaultPath, path),
    }
  } catch (error) {
    console.warn('[editor] Skipped editor change because BlockNote document could not be serialized:', error)
    return null
  }
}

function useEditorChangeHandler(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabsRef: MutableRefObject<Tab[]>
  onContentChangeRef: MutableRefObject<((path: string, content: string) => void) | undefined>
  onEditorActivity?: () => void
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
  suppressChangeRef: MutableRefObject<boolean>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
  vaultPathRef: MutableRefObject<string | undefined>
}) {
  const {
    editor,
    tabsRef,
    onContentChangeRef,
    onEditorActivity,
    prevActivePathRef,
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  } = options

  const propagateEditorChange = useCallback(() => {
    const path = activeEditorChangePath({ prevActivePathRef, editorContentPathRef })
    if (!path) return

    const previousContent = previousContentForPath({
      path,
      tabs: tabsRef.current,
      cache: tabCacheRef.current,
    })
    if (!previousContent) return

    const next = serializedEditorChange({
      editor,
      path,
      previousContent,
      vaultPath: vaultPathRef.current,
    })
    if (!next) return

    pendingLocalContentRef.current = { path, content: next.content }
    cacheResolvedEditorState(tabCacheRef.current, path, {
      blocks: next.blocks,
      cursorSelection: readTiptapSelection(editor),
      scrollTop: readEditorScrollTop(),
      sourceContent: next.content,
    }, vaultPathRef.current)
    onContentChangeRef.current?.(path, next.content)
  }, [editor, editorContentPathRef, onContentChangeRef, pendingLocalContentRef, prevActivePathRef, tabCacheRef, tabsRef, vaultPathRef])

  return useDebouncedEditorChange({ onFlush: propagateEditorChange, onActivity: onEditorActivity, suppressChangeRef })
}

function cachePreviousTabOnPathChange(options: {
  prevPath: string | null
  previousTab: Tab | undefined
  pathChanged: boolean
  editorMountedRef: MutableRefObject<boolean>
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorContentPathRef: EditorContentPathRef
}) {
  const { prevPath, previousTab, pathChanged, editorMountedRef, cache, editor, editorContentPathRef } = options
  if (!prevPath || !previousTab || !pathChanged || !editorMountedRef.current) return
  if (editorContentPathRef.current !== prevPath) return
  cacheEditorState(cache, prevPath, {
    blocks: editor.document,
    cursorSelection: readTiptapSelection(editor),
    scrollTop: readEditorScrollTop(),
    sourceContent: previousTab.content,
  })
}

function shouldWaitForActiveTab(options: {
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
}) {
  const { pathChanged, activeTabPath, activeTab } = options
  return pathChanged && !!activeTabPath && !activeTab
}

function syncActivePathTransition(options: {
  prevPath: string | null
  pathChanged: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  previousTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    prevPath,
    pathChanged,
    activeTabPath,
    activeTab,
    previousTab,
    cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
  } = options

  cachePreviousTabOnPathChange({
    prevPath,
    previousTab,
    pathChanged,
    editorMountedRef,
    cache,
    editor,
    editorContentPathRef,
  })
  if (shouldWaitForActiveTab({ pathChanged, activeTabPath, activeTab })) return true

  if (!preserveUntitledRenameState({
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })) {
    prevActivePathRef.current = activeTabPath
    return false
  }

  prevActivePathRef.current = activeTabPath
  return true
}

function markRawModeReswapPending(options: {
  activeTabPath: string | null
  cache: Map<string, CachedTabState>
  rawSwapPendingRef: MutableRefObject<boolean>
}) {
  const { activeTabPath, cache, rawSwapPendingRef } = options
  if (!activeTabPath) return false
  cache.delete(activeTabPath)
  rawSwapPendingRef.current = true
  return true
}

function currentEditorMatchesActiveTab(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
}) {
  const {
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return false
  if (typeof editor.blocksToMarkdownLossy !== 'function') return false

  const bodyMarkdown = trySerializeEditorBody(editor, 'active tab comparison')
  return bodyMarkdown === normalizeTabBody({ content: activeTab.content })
}

function cacheStableActiveTabAndClearPending(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  } = options

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })
  pendingLocalContentRef.current = null
  return true
}

function shouldKeepPendingLocalContent(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    activeTabPath,
    activeTab,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!activeTabPath || !activeTab || pendingLocalContent?.path !== activeTabPath) return false
  return true
}

function consumePendingLocalContent(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  } = options

  const pendingLocalContent = pendingLocalContentRef.current
  if (!pendingLocalContent || pendingLocalContent.content !== activeTab?.content) return true
  return cacheStableActiveTabAndClearPending({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
    pendingLocalContentRef,
  })
}

function handleStableActivePath(options: {
  pathChanged: boolean
  rawModeJustEnded: boolean
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    pathChanged,
    rawModeJustEnded,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  } = options

  if (pathChanged) return false
  if (rawModeJustEnded) {
    return !markRawModeReswapPending({ activeTabPath, cache, rawSwapPendingRef })
  }
  if (shouldKeepPendingLocalContent({ activeTabPath, activeTab, pendingLocalContentRef })) {
    return consumePendingLocalContent({
      cache,
      activeTabPath,
      activeTab,
      editor,
      editorMountedRef,
      editorContentPathRef,
      pendingLocalContentRef,
    })
  }
  if (currentEditorMatchesActiveTab({ activeTabPath, activeTab, editor, editorMountedRef })) {
    return cacheStableActiveTabAndClearPending({
      cache,
      activeTabPath,
      activeTab,
      editor,
      editorMountedRef,
      editorContentPathRef,
      pendingLocalContentRef,
    })
  }
  if (shouldRefreshStableActivePath({ activeTabPath, activeTab, cache })) return false
  if (rawSwapPendingRef.current) return true

  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })
  return true
}

function shouldRefreshStableActivePath(options: {
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
}): boolean {
  const {
    activeTabPath,
    activeTab,
    cache,
  } = options

  if (!activeTabPath || !activeTab) return false
  const cachedState = cache.get(activeTabPath)
  return !cachedState || cachedState.sourceContent !== activeTab.content
}

function shouldClearDomSelectionForScheduledSwap(options: {
  activeTabPath: string | null
  state: TabSwapState
}): boolean {
  const { activeTabPath, state } = options
  if (state.pathChanged) return true
  if (!activeTabPath || !state.activeTab) return false

  const cachedState = state.cache.get(activeTabPath)
  return !!cachedState && cachedState.sourceContent !== state.activeTab.content
}

function cacheStableActivePath(options: {
  cache: Map<string, CachedTabState>
  activeTabPath: string | null
  activeTab: Tab | undefined
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  } = options

  if (!activeTabPath || !activeTab || !editorMountedRef.current) return
  editorContentPathRef.current = activeTabPath
  cacheEditorState(cache, activeTabPath, {
    blocks: editor.document,
    cursorSelection: readTiptapSelection(editor),
    scrollTop: readEditorScrollTop(),
    sourceContent: activeTab.content,
  })
}

function preserveUntitledRenameState(options: {
  prevPath: string | null
  activeTabPath: string | null
  activeTab: Tab | undefined
  cache: Map<string, CachedTabState>
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}) {
  const {
    prevPath,
    activeTabPath,
    activeTab,
    cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
  } = options

  if (!prevPath || !activeTabPath) return false
  if (!isUntitledRenameTransition(prevPath, activeTabPath, activeTab, editor)) return false

  cache.delete(prevPath)
  cacheStableActivePath({
    cache,
    activeTabPath,
    activeTab,
    editor,
    editorMountedRef,
    editorContentPathRef,
  })
  requestNextFrame(() => signalEditorTabSwapped(activeTabPath))
  return true
}

function signalTabSwap(options: { path: string }) {
  const { path } = options
  requestNextFrame(() => signalEditorTabSwapped(path))
}

function requestNextFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(() => callback(Date.now()), 0)
}

function schedulePostPaint(callback: () => void): void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    setTimeout(callback, 0)
    return
  }

  window.requestAnimationFrame(() => {
    window.setTimeout(callback, 0)
  })
}

function clearStaleSwap(options: {
  targetPath: string
  prevActivePathRef: MutableRefObject<string | null>,
  suppressChangeRef: MutableRefObject<boolean>,
}): boolean {
  const {
    targetPath,
    prevActivePathRef,
    suppressChangeRef,
  } = options
  if (prevActivePathRef.current === targetPath) return false
  suppressChangeRef.current = false
  return true
}

function applyBlankTabState(options: {
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  editor: ReturnType<typeof useCreateBlockNote>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
}): boolean {
  const {
    cache,
    targetPath,
    content,
    editor,
    suppressChangeRef,
    editorContentPathRef,
  } = options

  cacheEditorState(cache, targetPath, {
    blocks: blankParagraphBlocks(),
    cursorSelection: { from: 1, to: 1 },
    scrollTop: 0,
    sourceContent: content,
  })
  if (!applyBlankStateToEditor({ editor, suppressChangeRef, editorContentPathRef, targetPath })) {
    return false
  }

  signalTabSwap({ path: targetPath })
  return true
}

function scheduleEmptyHeadingSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  vaultPath?: string
  entries?: VaultEntry[]
}) {
  const {
    editor,
    entries,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    vaultPath,
  } = options

  if (!startsWithEmptyHeading({ content })) return false

  void resolveEmptyHeadingBlocks(editor, content, vaultPath, targetPath, entries)
    .then((blocks) => {
      if (!blocks || shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
      cacheParsedEditorState(targetPath, { blocks, scrollTop: 0, sourceContent: content }, vaultPath)
      if (!applyBlocksToEditor({ editor, blocks, scrollTop: 0, suppressChangeRef, editorContentPathRef, targetPath })) return
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
      console.error('Failed to render empty heading state:', err)
      failNoteOpenTrace(targetPath, 'empty-heading-swap-failed')
    })

  return true
}

function scheduleParsedBlockSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  vaultPath?: string
  entries?: VaultEntry[]
  preservedPosition?: PreservedEditorPosition | null
}) {
  const {
    editor,
    entries,
    cache,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    vaultPath,
    preservedPosition,
  } = options

  void resolveBlocksForTarget({ editor, cache, entries, targetPath, content, vaultPath })
    .then(({ blocks, cursorSelection, scrollTop }) => {
      if (shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
      const restoredPosition = preservedPosition ?? (cursorSelection
        ? { cursorSelection, cursorIndex: 0, scrollTop }
        : null)
      const effectiveScrollTop = preservedPosition?.scrollTop ?? scrollTop
      if (!applyBlocksToEditor({ editor, blocks, scrollTop: effectiveScrollTop, suppressChangeRef, editorContentPathRef, targetPath })) return
      restoreEditorPosition(editor, restoredPosition)
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
      console.error('Failed to parse/swap editor content:', err)
      failNoteOpenTrace(targetPath, 'parsed-swap-failed')
    })
}

function scheduleTabSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  activeTab: Tab
  clearDomSelection: boolean
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  prevActivePathRef: MutableRefObject<string | null>
  rawSwapPendingRef: MutableRefObject<boolean>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  vaultPath?: string
  entries?: VaultEntry[]
}) {
  const {
    editor,
    cache,
    targetPath,
    activeTab,
    clearDomSelection,
    pendingSwapRef,
    swapSeqRef,
    tabsRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    vaultPath,
    entries,
  } = options

  const token = createSwapToken(swapSeqRef, targetPath, activeTab.content)
  suppressChangeRef.current = true

  const doSwap = () => {
    if (shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })) return
    if (clearStaleSwap({ targetPath, prevActivePathRef, suppressChangeRef })) return
    const wasRawSwap = rawSwapPendingRef.current
    rawSwapPendingRef.current = false
    if (clearDomSelection) clearEditorDomSelection()
    const preservedPosition = (!clearDomSelection && !wasRawSwap)
      ? captureEditorPosition(editor)
      : null

    if (isBlankBodyContent({ content: activeTab.content })) {
      applyBlankTabState({
        cache,
        targetPath,
        content: activeTab.content,
        editor,
        suppressChangeRef,
        editorContentPathRef,
      })
      return
    }

    if (scheduleEmptyHeadingSwap({
      editor,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
      vaultPath,
      entries,
    })) {
      return
    }

    scheduleParsedBlockSwap({
      editor,
      cache,
      targetPath,
      content: activeTab.content,
      prevActivePathRef,
      suppressChangeRef,
      editorContentPathRef,
      swapSeqRef,
      tabsRef,
      token,
      vaultPath,
      entries,
      preservedPosition,
    })
  }

  if (editor.prosemirrorView) {
    schedulePostPaint(doSwap)
    return
  }
  pendingSwapRef.current = doSwap
}

function resolveTabSwapState(options: {
  tabs: Tab[]
  activeTabPath: string | null
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  prevActivePathRef: MutableRefObject<string | null>
  rawModeJustEnded: boolean
}): TabSwapState {
  const {
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  } = options

  const prevPath = prevActivePathRef.current
  return {
    cache: tabCacheRef.current,
    prevPath,
    pathChanged: prevPath !== activeTabPath,
    activeTab: findActiveTab({ tabs, activeTabPath }),
    previousTab: findActiveTab({ tabs, activeTabPath: prevPath }),
    rawModeJustEnded,
  }
}

function shouldSkipScheduledTabSwap(options: {
  state: TabSwapState
  activeTabPath: string | null
  editor: ReturnType<typeof useCreateBlockNote>
  editorMountedRef: MutableRefObject<boolean>
  prevActivePathRef: MutableRefObject<string | null>
  editorContentPathRef: EditorContentPathRef
  rawSwapPendingRef: MutableRefObject<boolean>
  pendingLocalContentRef: MutableRefObject<PendingLocalContent | null>
}) {
  const {
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  } = options

  if (state.pathChanged) {
    pendingLocalContentRef.current = null
  }

  if (syncActivePathTransition({
    prevPath: state.prevPath,
    pathChanged: state.pathChanged,
    activeTabPath,
    activeTab: state.activeTab,
    previousTab: state.previousTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
  })) {
    return true
  }

  return handleStableActivePath({
    pathChanged: state.pathChanged,
    rawModeJustEnded: state.rawModeJustEnded,
    activeTabPath,
    activeTab: state.activeTab,
    cache: state.cache,
    editor,
    editorMountedRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })
}

function runTabSwapEffect(options: RunTabSwapEffectOptions) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    flushPendingEditorChange,
    vaultPath,
  } = options

  const rawModeJustEnded = consumeRawModeTransition(prevRawModeRef, rawMode)
  if (flushBeforeRawMode({ rawMode, flushPendingEditorChange })) return
  const state = resolveTabSwapState({
    tabs,
    activeTabPath,
    tabCacheRef,
    prevActivePathRef,
    rawModeJustEnded,
  })
  if (state.pathChanged) invalidatePendingSwap({ pendingSwapRef, swapSeqRef })
  flushBeforePathChange({ pathChanged: state.pathChanged, flushPendingEditorChange })

  if (shouldSkipScheduledTabSwap({
    state,
    activeTabPath,
    editor,
    editorMountedRef,
    prevActivePathRef,
    editorContentPathRef,
    rawSwapPendingRef,
    pendingLocalContentRef,
  })) {
    return
  }

  if (!activeTabPath || !state.activeTab) return

  scheduleTabSwap({
    editor,
    cache: state.cache,
    targetPath: activeTabPath,
    activeTab: state.activeTab,
    clearDomSelection: shouldClearDomSelectionForScheduledSwap({ activeTabPath, state }),
    pendingSwapRef,
    swapSeqRef,
    tabsRef,
    prevActivePathRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    vaultPath,
  })
}

function useTabSwapEffect(options: UseTabSwapEffectOptions) {
  const {
    tabs,
    activeTabPath,
    editor,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  } = options

  useEffect(() => {
    runTabSwapEffect({
      tabs,
      activeTabPath,
      editor,
      rawMode,
      tabCacheRef,
      tabsRef,
      editorMountedRef,
      prevActivePathRef,
      pendingSwapRef,
      swapSeqRef,
      prevRawModeRef,
      rawSwapPendingRef,
      suppressChangeRef,
      editorContentPathRef,
      pendingLocalContentRef,
      flushPendingEditorChange,
      vaultPath: vaultPathRef.current,
    })
  }, [
    activeTabPath,
    editor,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevActivePathRef,
    prevRawModeRef,
    rawMode,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    tabCacheRef,
    tabsRef,
    tabs,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  ])
}

function useForegroundWorkTracker(
  activeTabPath: string | null,
  handleEditorChange: () => void,
) {
  const foregroundWorkAtRef = useRef(0)
  useEffect(() => {
    foregroundWorkAtRef.current = Date.now()
  }, [activeTabPath])
  const handleForegroundEditorChange = useCallback(() => {
    foregroundWorkAtRef.current = Date.now()
    handleEditorChange()
  }, [handleEditorChange])
  return { foregroundWorkAtRef, handleForegroundEditorChange }
}

function usePrepareParsedBlocks(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  tabCacheRef: MutableRefObject<Map<string, CachedTabState>>
  vaultPathRef: MutableRefObject<string | undefined>
  entriesRef: MutableRefObject<VaultEntry[] | undefined>
}) {
  const { editor, entriesRef, tabCacheRef, vaultPathRef } = options
  return useCallback(async (event: ParsedBlockPreloadEvent) => {
    await resolveBlocksForTarget({
      editor,
      cache: tabCacheRef.current,
      entries: entriesRef.current,
      targetPath: event.path,
      content: event.content,
      vaultPath: vaultPathRef.current,
    })
  }, [editor, entriesRef, tabCacheRef, vaultPathRef])
}

/**
 * Manages the tab content-swap machinery for the BlockNote editor.
 *
 * Owns all refs and effects related to:
 * - Tracking editor mount state (editorMountedRef, pendingSwapRef)
 * - Swapping document content when the active tab changes (with caching)
 * - Cleaning up the block cache when tabs are closed
 * - Serializing editor blocks → markdown on change (suppressChangeRef)
 *
 * Returns the onChange callback for SingleEditorView and a flush hook for
 * save/navigation paths that need the latest rich-editor content immediately.
 */
export function useEditorTabSwap({ tabs, activeTabPath, editor, entries, onContentChange, onEditorActivity, rawMode, vaultPath }: UseEditorTabSwapOptions) {
  const tabCacheRef = useRef<Map<string, CachedTabState>>(new Map())
  const pendingLocalContentRef = useRef<PendingLocalContent | null>(null)
  const prevActivePathRef = useRef<string | null>(null)
  const activeTabPathLatestRef = useLatestRef(activeTabPath)
  const editorContentPathRef = useRef<string | null>(null)
  const editorMountedRef = useRef(false)
  const pendingSwapRef = useRef<(() => void) | null>(null)
  const swapSeqRef = useRef(0)
  const prevRawModeRef = useRef(!!rawMode)
  const rawModeLatestRef = useLatestRef(!!rawMode)
  const rawSwapPendingRef = useRef(false)
  const suppressChangeRef = useRef(false)
  const onContentChangeRef = useLatestRef(onContentChange)
  const tabsRef = useLatestRef(tabs)
  const vaultPathRef = useLatestRef(vaultPath)
  const entriesRef = useLatestRef(entries)
  const { handleEditorChange, flushPendingEditorChange } = useEditorChangeHandler({
    editor,
    tabsRef,
    onContentChangeRef,
    onEditorActivity,
    prevActivePathRef,
    editorContentPathRef,
    suppressChangeRef,
    tabCacheRef,
    pendingLocalContentRef,
    vaultPathRef,
  })
  const { foregroundWorkAtRef, handleForegroundEditorChange } = useForegroundWorkTracker(activeTabPath, handleEditorChange)
  const prepareParsedBlocks = usePrepareParsedBlocks({ editor, entriesRef, tabCacheRef, vaultPathRef })
  useEditorMountState(editor, editorMountedRef, pendingSwapRef)
  useParsedBlockPreload({
    activeTabPathRef: activeTabPathLatestRef,
    editorMountedRef,
    foregroundWorkAtRef,
    prepareParsedBlocks,
    rawModeRef: rawModeLatestRef,
  })
  useTabSwapEffect({
    tabs,
    activeTabPath,
    editor,
    entries,
    rawMode,
    tabCacheRef,
    tabsRef,
    prevActivePathRef,
    editorMountedRef,
    pendingSwapRef,
    swapSeqRef,
    prevRawModeRef,
    rawSwapPendingRef,
    suppressChangeRef,
    editorContentPathRef,
    pendingLocalContentRef,
    vaultPathRef,
    flushPendingEditorChange,
  })

  return { handleEditorChange: handleForegroundEditorChange, flushPendingEditorChange, editorMountedRef }
}
