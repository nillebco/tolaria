import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  beginNoteOpenTrace,
  failNoteOpenTrace,
  finishNoteOpenTrace,
  markNoteOpenTrace,
} from '../utils/noteOpenPerformance'
import {
  cacheNoteContent as cacheNoteContentInMemory,
  clearNoteContentCache,
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  isNoActiveVaultSelectedError,
  isUnreadableNoteContentError,
  loadContentForOpen,
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  NOTE_CONTENT_PREFETCH_CONCURRENCY,
  prefetchNoteContent as prefetchNoteContentInMemory,
  type NoteContentRequestOptions,
} from './noteContentCache'
import { clearParsedNoteBlockCache } from './editorParsedBlockCache'
import { notePathsMatch } from '../utils/notePathIdentity'
import { normalizeVaultEntry } from '../utils/vaultMetadataNormalization'

interface Tab {
  entry: VaultEntry
  content: string
}

export {
  NOTE_CONTENT_CACHE_LIMIT,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  NOTE_CONTENT_PREFETCH_CONCURRENCY,
}

export function prefetchNoteContent(target: string | VaultEntry, options?: NoteContentRequestOptions): void {
  prefetchNoteContentInMemory(target, options)
}

export function cacheNoteContent(
  path: string,
  content: string,
  entry?: VaultEntry,
  options?: NoteContentRequestOptions,
): void {
  cacheNoteContentInMemory(path, content, entry, options)
}

export const TAB_SESSION_STORAGE_PREFIX = 'tolaria:tab-session:'

interface PersistedTabSession {
  version: 1
  openPaths: string[]
  activePath: string | null
}

interface CloseAllTabsOptions {
  preserveSession?: boolean
}

export function tabSessionStorageKey(vaultPath: string): string | null {
  return vaultPath ? `${TAB_SESSION_STORAGE_PREFIX}${vaultPath.replaceAll('\\', '/').replace(/\/+$/g, '').toLowerCase()}` : null
}

function parseStoredTabSession(raw: string | null): PersistedTabSession | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTabSession>
    if (parsed.version !== 1 || !Array.isArray(parsed.openPaths)) return null
    const openPaths = parsed.openPaths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    const activePath = typeof parsed.activePath === 'string' && parsed.activePath.length > 0
      ? parsed.activePath
      : null
    return { version: 1, openPaths, activePath }
  } catch {
    return null
  }
}

function loadStoredTabSession(sessionKey: string): PersistedTabSession | null {
  try {
    return parseStoredTabSession(localStorage.getItem(sessionKey))
  } catch {
    return null
  }
}

async function loadPersistedTabSession(sessionKey: string): Promise<PersistedTabSession | null> {
  if (!isTauri()) return loadStoredTabSession(sessionKey)

  try {
    const session = await invoke<{
      version: number
      open_paths: string[]
      active_path: string | null
    } | null>('get_tab_session', { sessionKey })
    if (!session || session.version !== 1 || !Array.isArray(session.open_paths)) return null
    const openPaths = session.open_paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
    const activePath = typeof session.active_path === 'string' && session.active_path.length > 0
      ? session.active_path
      : null
    return { version: 1, openPaths, activePath }
  } catch (err) {
    console.warn('Failed to load tab session:', err)
    return null
  }
}

function saveStoredTabSession(sessionKey: string, tabs: Tab[], activePath: string | null): void {
  const openPaths = tabs.map((tab) => tab.entry.path)
  const session = {
    version: 1,
    openPaths,
    activePath: activePath && openPaths.some((path) => notePathsMatch(path, activePath)) ? activePath : null,
  } satisfies PersistedTabSession

  try {
    localStorage.setItem(sessionKey, JSON.stringify(session))
  } catch (err) {
    console.warn('Failed to save tab session:', err)
  }
}

function savePersistedTabSession(sessionKey: string, tabs: Tab[], activePath: string | null): void {
  if (!isTauri()) {
    saveStoredTabSession(sessionKey, tabs, activePath)
    return
  }

  const openPaths = tabs.map((tab) => tab.entry.path)
  void Promise.resolve(invoke('save_tab_session', {
    sessionKey,
    session: {
      version: 1,
      open_paths: openPaths,
      active_path: activePath && openPaths.some((path) => notePathsMatch(path, activePath)) ? activePath : null,
    },
  })).catch((err) => {
    console.warn('Failed to save tab session:', err)
  })
}

/** Clear note-open caches. Call on vault reload to prevent stale content. */
export function clearPrefetchCache(): void {
  clearNoteContentCache()
  clearParsedNoteBlockCache()
}

export type { Tab }

interface TabManagementOptions {
  beforeNavigate?: (fromPath: string, toPath: string) => Promise<void>
  entries?: VaultEntry[]
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  sessionKey?: string | null
}

interface NavigateToEntryOptions {
  entry: VaultEntry
  sourceEntry?: VaultEntry
  forceReload?: boolean
  tabMode: 'add' | 'replace'
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  hasUnsavedChanges?: (path: string) => boolean
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}

function syncActiveTabPath(
  activeTabPathRef: React.MutableRefObject<string | null>,
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>,
  path: string | null,
) {
  activeTabPathRef.current = path
  setActiveTabPath(path)
}

function resetRequestedPathIfStillPending(
  requestedActiveTabPathRef: React.MutableRefObject<string | null>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  pendingPath: string,
) {
  if (requestedActiveTabPathRef.current === pendingPath) {
    requestedActiveTabPathRef.current = activeTabPathRef.current
  }
}

function setSingleTab(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  nextTab: Tab,
) {
  tabsRef.current = [nextTab]
  setTabs([nextTab])
}

function addOrSwitchTab(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  nextTab: Tab,
) {
  const existingIdx = tabsRef.current.findIndex(t => notePathsMatch(t.entry.path, nextTab.entry.path))
  const newTabs = existingIdx >= 0
    ? tabsRef.current.map((t, i) => i === existingIdx ? nextTab : t)
    : [...tabsRef.current, nextTab]
  tabsRef.current = newTabs
  setTabs(newTabs)
}

function replaceTabInList(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  nextTab: Tab,
) {
  const existingIdx = tabsRef.current.findIndex(t => notePathsMatch(t.entry.path, nextTab.entry.path))
  if (existingIdx >= 0) {
    const newTabs = tabsRef.current.map((t, i) => i === existingIdx ? nextTab : t)
    tabsRef.current = newTabs
    setTabs(newTabs)
    return
  }
  setSingleTab(tabsRef, setTabs, nextTab)
}

function clearTabs(
  tabsRef: React.MutableRefObject<Tab[]>,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
) {
  tabsRef.current = []
  setTabs([])
}

function normalizeOpenEntry(entry: VaultEntry): VaultEntry | null {
  const path = typeof entry.path === 'string' ? entry.path.trim() : ''
  if (!path) return null
  return normalizeVaultEntry({ ...entry, path })
}

function callbackEntryForLoadFailure(entry: VaultEntry, sourceEntry?: VaultEntry): VaultEntry {
  return sourceEntry ? { ...sourceEntry, path: entry.path } : entry
}

function isAlreadyViewingPath(
  tabsRef: React.MutableRefObject<Tab[]>,
  activeTabPathRef: React.MutableRefObject<string | null>,
  path: string,
) {
  return notePathsMatch(activeTabPathRef.current, path)
    || tabsRef.current.some((tab) => notePathsMatch(tab.entry.path, path))
}

function startEntryNavigation(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  activeTabPathRef: React.MutableRefObject<string | null>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  tabMode: 'add' | 'replace'
}) {
  const {
    entry,
    navSeqRef,
    tabsRef,
    setTabs,
    activeTabPathRef,
    setActiveTabPath,
    tabMode,
  } = options

  const seq = ++navSeqRef.current
  const cachedEntry = getCachedNoteContentEntry(entry.path)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  if (hasResolvedCachedContent(cachedEntry)) {
    markNoteOpenTrace(entry.path, 'cacheReady')
    const nextTab = { entry, content: cachedEntry.value }
    if (tabMode === 'add') {
      addOrSwitchTab(tabsRef, setTabs, nextTab)
    } else {
      replaceTabInList(tabsRef, setTabs, nextTab)
    }
  }

  return { seq, cachedEntry }
}

function openBinaryEntry(options: {
  entry: VaultEntry
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  tabMode: 'add' | 'replace'
}) {
  const {
    entry,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    tabMode,
  } = options

  navSeqRef.current += 1
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  if (tabMode === 'add') {
    addOrSwitchTab(tabsRef, setTabs, { entry, content: '' })
  } else {
    replaceTabInList(tabsRef, setTabs, { entry, content: '' })
  }
  finishNoteOpenTrace(entry.path)
}

function isMissingNotePathError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String(error)
  return /does not exist|not found|enoent/i.test(message)
}

function shouldApplyLoadedEntry(options: {
  seq: number
  navSeqRef: React.MutableRefObject<number>
  content: string
  forceReload: boolean
  activeTabPathRef: React.MutableRefObject<string | null>
  tabsRef: React.MutableRefObject<Tab[]>
  path: string
}) {
  const {
    seq,
    navSeqRef,
    content,
    forceReload,
    activeTabPathRef,
    tabsRef,
    path,
  } = options

  if (navSeqRef.current !== seq) return false
  if (forceReload) return true
  if (!notePathsMatch(activeTabPathRef.current, path)) return true
  const openTab = tabsRef.current.find((tab) => notePathsMatch(tab.entry.path, path))
  return !openTab || openTab.content !== content
}

type EntryLoadFailureKind =
  | 'missing-active-vault'
  | 'missing-path'
  | 'unreadable-content'
  | 'load-failed'

type RecoverableEntryLoadFailureKind = Exclude<EntryLoadFailureKind, 'load-failed'>

function getEntryLoadFailureKind(error: unknown): EntryLoadFailureKind {
  if (isNoActiveVaultSelectedError(error)) return 'missing-active-vault'
  if (isMissingNotePathError(error)) return 'missing-path'
  if (isUnreadableNoteContentError(error)) return 'unreadable-content'
  return 'load-failed'
}

function resetFailedEntrySelection(options: {
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { tabsRef, activeTabPathRef, setTabs, setActiveTabPath } = options
  clearTabs(tabsRef, setTabs)
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
}

function runEntryFailureCallback(options: {
  callback?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  entry: VaultEntry
  error: unknown
  warning: string
}) {
  const { callback, entry, error, warning } = options
  Promise.resolve(callback?.(entry, error)).catch((callbackError) => {
    console.warn(warning, callbackError)
  })
}

function handleRecoverableEntryLoadFailure(options: {
  kind: RecoverableEntryLoadFailureKind
  entry: VaultEntry
  callbackEntry: VaultEntry
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    kind,
    entry,
    callbackEntry,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  if (kind === 'missing-active-vault') {
    clearPrefetchCache()
  }

  resetFailedEntrySelection({
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  })
  failNoteOpenTrace(entry.path, kind)

  if (kind === 'missing-active-vault') {
    runEntryFailureCallback({
      callback: onMissingActiveVault,
      entry: callbackEntry,
      error,
      warning: 'Failed to handle missing active vault:',
    })
    return
  }

  if (kind === 'missing-path') {
    runEntryFailureCallback({
      callback: onMissingNotePath,
      entry: callbackEntry,
      error,
      warning: 'Failed to handle missing note path:',
    })
    return
  }

  if (kind === 'unreadable-content') {
    runEntryFailureCallback({
      callback: onUnreadableNoteContent,
      entry: callbackEntry,
      error,
      warning: 'Failed to handle unreadable note content:',
    })
  }
}

function handleEntryLoadFailure(options: {
  entry: VaultEntry
  callbackEntry: VaultEntry
  seq: number
  navSeqRef: React.MutableRefObject<number>
  tabsRef: React.MutableRefObject<Tab[]>
  activeTabPathRef: React.MutableRefObject<string | null>
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>
  error: unknown
  onMissingActiveVault?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onMissingNotePath?: (entry: VaultEntry, error: unknown) => void | Promise<void>
  onUnreadableNoteContent?: (entry: VaultEntry, error: unknown) => void | Promise<void>
}) {
  const {
    entry,
    callbackEntry,
    seq,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    error,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  console.warn('Failed to load note content:', error)
  if (navSeqRef.current !== seq) return

  const failureKind = getEntryLoadFailureKind(error)
  if (failureKind !== 'load-failed') {
    handleRecoverableEntryLoadFailure({
      kind: failureKind,
      entry,
      callbackEntry,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
    return
  }

  resetFailedEntrySelection({
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
  })
  failNoteOpenTrace(entry.path, 'load-failed')
}

function reopenAlreadyViewingEntry({
  entry,
  tabsRef,
  activeTabPathRef,
  setActiveTabPath,
  hasUnsavedChanges,
}: Pick<NavigateToEntryOptions, 'entry' | 'tabsRef' | 'activeTabPathRef' | 'setActiveTabPath' | 'hasUnsavedChanges'>): boolean {
  if (!isAlreadyViewingPath(tabsRef, activeTabPathRef, entry.path)) return false
  if (!hasUnsavedChanges?.(entry.path)) return false
  syncActiveTabPath(activeTabPathRef, setActiveTabPath, entry.path)
  finishNoteOpenTrace(entry.path)
  return true
}

async function loadTextEntry(options: Required<Pick<NavigateToEntryOptions, 'forceReload'>> & NavigateToEntryOptions) {
  const {
    entry,
    sourceEntry,
    forceReload,
    navSeqRef,
    tabsRef,
    activeTabPathRef,
    setTabs,
    setActiveTabPath,
    onMissingActiveVault,
    onMissingNotePath,
    onUnreadableNoteContent,
  } = options

  const { seq, cachedEntry } = startEntryNavigation({
    entry,
    navSeqRef,
    tabsRef,
    setTabs,
    activeTabPathRef,
    setActiveTabPath,
    tabMode: options.tabMode,
  })

  try {
    markNoteOpenTrace(entry.path, 'contentLoadStart')
    const content = await loadContentForOpen({
      entry,
      forceReload,
      cachedEntry,
    })
    markNoteOpenTrace(entry.path, 'contentLoadEnd')
    if (!shouldApplyLoadedEntry({
      seq,
      navSeqRef,
      content,
      forceReload,
      activeTabPathRef,
      tabsRef,
      path: entry.path,
    })) return
    if (options.tabMode === 'add') {
      addOrSwitchTab(tabsRef, setTabs, { entry, content })
    } else {
      replaceTabInList(tabsRef, setTabs, { entry, content })
    }
  } catch (err) {
    handleEntryLoadFailure({
      entry,
      callbackEntry: callbackEntryForLoadFailure(entry, sourceEntry),
      seq,
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      error: err,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    })
  }
}

async function navigateToEntry(options: NavigateToEntryOptions) {
  const forceReload = options.forceReload ?? false

  if (options.entry.fileKind === 'binary') {
    openBinaryEntry(options)
    return
  }

  if (!forceReload && reopenAlreadyViewingEntry(options)) return

  await loadTextEntry({ ...options, forceReload })
}

export function useTabManagement(options: TabManagementOptions = {}) {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const activeTabPathRef = useRef(activeTabPath)
  const requestedActiveTabPathRef = useRef<string | null>(activeTabPath)
  useEffect(() => { activeTabPathRef.current = activeTabPath })
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs })

  // Sequence counter for rapid-switch safety: only the latest navigation wins.
  const navSeqRef = useRef(0)
  const beforeNavigateSeqRef = useRef(0)
  const beforeNavigate = options.beforeNavigate
  const entries = options.entries
  const hasUnsavedChanges = options.hasUnsavedChanges
  const onMissingActiveVault = options.onMissingActiveVault
  const onMissingNotePath = options.onMissingNotePath
  const onUnreadableNoteContent = options.onUnreadableNoteContent
  // Refs keep callbacks current without triggering the restore effect on every render.
  // The restore effect must only re-run when sessionKey or entries change — not when
  // these callbacks are recreated by the parent (which happens on every render).
  const onMissingNotePathRef = useRef(onMissingNotePath)
  const onUnreadableNoteContentRef = useRef(onUnreadableNoteContent)
  useEffect(() => { onMissingNotePathRef.current = onMissingNotePath })
  useEffect(() => { onUnreadableNoteContentRef.current = onUnreadableNoteContent })
  const sessionKey = options.sessionKey ?? null
  const restoredSessionKeyRef = useRef<string | null>(null)
  const suppressNextEmptySessionPersistRef = useRef(false)
  const suppressEmptySessionPersistUntilNonEmptyRef = useRef(false)
  const allowNextEmptySessionPersistRef = useRef(false)
  const restoreRequestSeqRef = useRef(0)

  useEffect(() => {
    restoredSessionKeyRef.current = null
    suppressNextEmptySessionPersistRef.current = false
    suppressEmptySessionPersistUntilNonEmptyRef.current = false
    allowNextEmptySessionPersistRef.current = false
  }, [sessionKey])

  useEffect(() => {
    if (!sessionKey || restoredSessionKeyRef.current === sessionKey) return
    if (tabsRef.current.length > 0 || activeTabPathRef.current) {
      restoredSessionKeyRef.current = sessionKey
      return
    }

    if (!entries || entries.length === 0) return

    const seq = ++restoreRequestSeqRef.current
    void (async () => {
      const storedSession = await loadPersistedTabSession(sessionKey)
      if (restoreRequestSeqRef.current !== seq || restoredSessionKeyRef.current === sessionKey) return
      if (!storedSession || storedSession.openPaths.length === 0) {
        restoredSessionKeyRef.current = sessionKey
        return
      }

      const entriesToRestore = storedSession.openPaths
        .map((path) => entries.find((entry) => notePathsMatch(entry.path, path)))
        .filter((entry): entry is VaultEntry => entry !== undefined && entry.fileKind !== 'binary')

      // Don't mark as restored if entries are from the wrong vault — retry when correct entries load
      if (entriesToRestore.length === 0) return
      restoredSessionKeyRef.current = sessionKey

      const activeRestoreEntry = entriesToRestore.find((entry) => notePathsMatch(entry.path, storedSession.activePath))
        ?? entriesToRestore[entriesToRestore.length - 1]

      for (const entry of entriesToRestore) {
        await navigateToEntry({
          entry,
          tabMode: 'add',
          navSeqRef,
          tabsRef,
          activeTabPathRef,
          setTabs,
          setActiveTabPath,
          hasUnsavedChanges,
          onMissingActiveVault,
          onMissingNotePath: onMissingNotePathRef.current,
          onUnreadableNoteContent: onUnreadableNoteContentRef.current,
        })
      }
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, activeRestoreEntry.path)
    })()
  }, [entries, sessionKey])

  useEffect(() => {
    if (!sessionKey) return
    if (suppressNextEmptySessionPersistRef.current && tabs.length === 0 && activeTabPath === null) {
      suppressNextEmptySessionPersistRef.current = false
      return
    }
    if (tabs.length === 0 && activeTabPath === null) {
      if (!allowNextEmptySessionPersistRef.current) return
      allowNextEmptySessionPersistRef.current = false
    }
    if (suppressEmptySessionPersistUntilNonEmptyRef.current) {
      if (tabs.length === 0 && activeTabPath === null) return
      suppressEmptySessionPersistUntilNonEmptyRef.current = false
    }
    if (restoredSessionKeyRef.current !== sessionKey) {
      if (tabs.length === 0 && activeTabPath === null) return
      restoredSessionKeyRef.current = sessionKey
    }
    savePersistedTabSession(sessionKey, tabsRef.current, activeTabPathRef.current)
  }, [activeTabPath, sessionKey, tabs])

  const executeNavigationWithBoundary = useCallback(async (
    targetPath: string,
    navigate: () => void | Promise<void>,
  ) => {
    const seq = ++beforeNavigateSeqRef.current
    const currentPath = activeTabPathRef.current
    if (beforeNavigate && currentPath && !notePathsMatch(currentPath, targetPath)) {
      try {
        markNoteOpenTrace(targetPath, 'beforeNavigateStart')
        await beforeNavigate(currentPath, targetPath)
        markNoteOpenTrace(targetPath, 'beforeNavigateEnd')
      } catch (err) {
        console.warn('Failed to persist note before navigation:', err)
        failNoteOpenTrace(targetPath, 'before-navigate-failed')
        return false
      }
      if (beforeNavigateSeqRef.current !== seq) return false
    }
    await navigate()
    return true
  }, [beforeNavigate])

  /** Open a note, adding a tab when needed. */
  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return
    requestedActiveTabPathRef.current = openEntry.path
    const alreadyViewingDirtyEntry = notePathsMatch(openEntry.path, activeTabPathRef.current)
      && !!hasUnsavedChanges?.(openEntry.path)
    if (!alreadyViewingDirtyEntry) {
      beginNoteOpenTrace(openEntry.path, 'select-note')
    }
    const navigated = await executeNavigationWithBoundary(openEntry.path, () => navigateToEntry({
      entry: openEntry,
      sourceEntry: entry,
      tabMode: 'add',
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      hasUnsavedChanges,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
  }, [executeNavigationWithBoundary, hasUnsavedChanges, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const handleSwitchTab = useCallback((path: string) => {
    requestedActiveTabPathRef.current = path
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, path)
  }, [])

  /** Open a tab with known content — no IPC round-trip. Used for newly created notes. */
  const openTabWithContent = useCallback((entry: VaultEntry, content: string) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return
    requestedActiveTabPathRef.current = openEntry.path
    void executeNavigationWithBoundary(openEntry.path, () => {
      cacheNoteContent(openEntry.path, content, openEntry)
      addOrSwitchTab(tabsRef, setTabs, { entry: openEntry, content })
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, openEntry.path)
    }).then((navigated) => {
      if (!navigated) resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    })
  }, [executeNavigationWithBoundary])

  const handleReplaceActiveTab = useCallback(async (entry: VaultEntry) => {
    const openEntry = normalizeOpenEntry(entry)
    if (!openEntry) return
    requestedActiveTabPathRef.current = openEntry.path
    const replacingDifferentEntry = !notePathsMatch(openEntry.path, activeTabPathRef.current)
    if (replacingDifferentEntry) {
      beginNoteOpenTrace(openEntry.path, 'replace-active-tab')
    }
    const navigated = await executeNavigationWithBoundary(openEntry.path, () => navigateToEntry({
      entry: openEntry,
      sourceEntry: entry,
      forceReload: !replacingDifferentEntry,
      tabMode: 'replace',
      navSeqRef,
      tabsRef,
      activeTabPathRef,
      setTabs,
      setActiveTabPath,
      onMissingActiveVault,
      onMissingNotePath,
      onUnreadableNoteContent,
    }))
    if (!navigated) {
      resetRequestedPathIfStillPending(requestedActiveTabPathRef, activeTabPathRef, openEntry.path)
    }
  }, [executeNavigationWithBoundary, onMissingActiveVault, onMissingNotePath, onUnreadableNoteContent])

  const closeTab = useCallback((path: string) => {
    const currentTabs = tabsRef.current
    const index = currentTabs.findIndex(tab => notePathsMatch(tab.entry.path, path))
    if (index < 0) return
    const newTabs = currentTabs.filter((_, tabIndex) => tabIndex !== index)
    tabsRef.current = newTabs
    if (newTabs.length === 0) {
      allowNextEmptySessionPersistRef.current = true
    }
    setTabs(newTabs)
    if (notePathsMatch(activeTabPathRef.current, path)) {
      const nextTab = newTabs[index - 1] ?? newTabs[index] ?? null
      requestedActiveTabPathRef.current = nextTab?.entry.path ?? null
      syncActiveTabPath(activeTabPathRef, setActiveTabPath, nextTab?.entry.path ?? null)
    }
  }, [])

  const closeCurrentTab = useCallback(() => {
    const path = activeTabPathRef.current
    if (path) closeTab(path)
  }, [closeTab])

  const closeAllTabs = useCallback((closeOptions: CloseAllTabsOptions = {}) => {
    navSeqRef.current += 1
    beforeNavigateSeqRef.current += 1
    if (closeOptions.preserveSession) {
      suppressNextEmptySessionPersistRef.current = true
    } else {
      allowNextEmptySessionPersistRef.current = true
    }
    tabsRef.current = []
    setTabs([])
    requestedActiveTabPathRef.current = null
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, null)
  }, [])

  const closeOtherTabs = useCallback(() => {
    const activePath = activeTabPathRef.current
    if (!activePath) return

    const activeTab = tabsRef.current.find((tab) => notePathsMatch(tab.entry.path, activePath))
    if (!activeTab) return

    tabsRef.current = [activeTab]
    setTabs([activeTab])
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, activeTab.entry.path)
  }, [])

  const reorderTabs = useCallback((sourcePath: string, targetPath: string) => {
    if (notePathsMatch(sourcePath, targetPath)) return

    const currentTabs = tabsRef.current
    const sourceIndex = currentTabs.findIndex(tab => notePathsMatch(tab.entry.path, sourcePath))
    const targetIndex = currentTabs.findIndex(tab => notePathsMatch(tab.entry.path, targetPath))
    if (sourceIndex < 0 || targetIndex < 0) return

    const nextTabs = [...currentTabs]
    const [movedTab] = nextTabs.splice(sourceIndex, 1)
    nextTabs.splice(targetIndex, 0, movedTab)
    tabsRef.current = nextTabs
    setTabs(nextTabs)
  }, [])

  const nextTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length <= 1) return
    const idx = currentTabs.findIndex(t => notePathsMatch(t.entry.path, activeTabPathRef.current))
    const nextIdx = (idx + 1) % currentTabs.length
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, currentTabs[nextIdx].entry.path)
  }, [])

  const prevTab = useCallback(() => {
    const currentTabs = tabsRef.current
    if (currentTabs.length <= 1) return
    const idx = currentTabs.findIndex(t => notePathsMatch(t.entry.path, activeTabPathRef.current))
    const prevIdx = (idx - 1 + currentTabs.length) % currentTabs.length
    syncActiveTabPath(activeTabPathRef, setActiveTabPath, currentTabs[prevIdx].entry.path)
  }, [])

  return {
    tabs,
    setTabs,
    activeTabPath,
    activeTabPathRef,
    requestedActiveTabPathRef,
    handleSelectNote,
    openTabWithContent,
    handleSwitchTab,
    handleReplaceActiveTab,
    closeTab,
    closeCurrentTab,
    closeAllTabs,
    closeOtherTabs,
    reorderTabs,
    nextTab,
    prevTab,
  }
}
