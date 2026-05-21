import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { VaultEntry } from '../types'
import { refreshPulledVaultState } from '../utils/pulledVaultRefresh'

function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\/private\/tmp(?=\/|$)/u, '/tmp')
    .replace(/\/+$/u, '')
}

function isActiveTabInChangedPaths(changedPaths: string[], vaultPath: string, activeTabPath: string): boolean {
  const normalizedActive = normalizePath(activeTabPath)
  return changedPaths.some((p) => {
    const resolved = p.startsWith('/') ? normalizePath(p) : normalizePath(`${vaultPath}/${p}`)
    return resolved === normalizedActive
  })
}

export const RECENT_EDIT_GRACE_MS = 3000

interface VaultBridgeDeps {
  entriesByPath: Map<string, VaultEntry>
  resolvedPath: string
  reloadVault: () => Promise<VaultEntry[]>
  reloadFolders: () => Promise<unknown> | unknown
  reloadViews: () => Promise<unknown> | unknown
  closeAllTabs: () => void
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
  hasUnsavedChanges: (path: string) => boolean
  shouldKeepActiveEditorMounted?: () => boolean
  onSelectNote: (entry: VaultEntry) => void
  activeTabPath: string | null
  getActiveTabPath?: () => string | null
  recentlySavedRef: MutableRefObject<Set<string>>
  lastEditTimestampRef: MutableRefObject<number>
}

function findEntry(entriesByPath: Map<string, VaultEntry>, resolvedPath: string, path: string): VaultEntry | undefined {
  return entriesByPath.get(path) ?? entriesByPath.get(`${resolvedPath}/${path}`)
}

function findInFresh(entries: VaultEntry[], resolvedPath: string, path: string): VaultEntry | undefined {
  return entries.find(e => e.path === path || e.path === `${resolvedPath}/${path}`)
}

export function useVaultBridge({
  entriesByPath,
  resolvedPath,
  reloadVault,
  reloadFolders,
  reloadViews,
  closeAllTabs,
  replaceActiveTab,
  hasUnsavedChanges,
  shouldKeepActiveEditorMounted,
  onSelectNote,
  activeTabPath,
  getActiveTabPath,
  recentlySavedRef,
  lastEditTimestampRef,
}: VaultBridgeDeps) {
  const reloadAndOpen = useCallback((path: string) => {
    reloadVault().then(fresh => {
      const entry = findInFresh(fresh, resolvedPath, path)
      if (entry) onSelectNote(entry)
    })
  }, [reloadVault, onSelectNote, resolvedPath])

  const refreshAgentChanges = useCallback((updatedFiles: string[]) => (
    refreshPulledVaultState({
      activeTabPath,
      closeAllTabs,
      getActiveTabPath,
      hasUnsavedChanges,
      shouldKeepActiveEditorMounted,
      reloadFolders,
      reloadVault,
      reloadViews,
      replaceActiveTab,
      updatedFiles,
      vaultPath: resolvedPath,
    })
  ), [
    activeTabPath,
    closeAllTabs,
    getActiveTabPath,
    hasUnsavedChanges,
    shouldKeepActiveEditorMounted,
    reloadFolders,
    reloadVault,
    reloadViews,
    replaceActiveTab,
    resolvedPath,
  ])

  const openNoteByPath = useCallback((path: string) => {
    const entry = findEntry(entriesByPath, resolvedPath, path)
    if (entry) onSelectNote(entry)
    else reloadAndOpen(path)
  }, [entriesByPath, resolvedPath, onSelectNote, reloadAndOpen])

  const handlePulseOpenNote = useCallback((relativePath: string) => {
    const entry = findEntry(entriesByPath, resolvedPath, `${resolvedPath}/${relativePath}`)
      ?? entriesByPath.get(relativePath)
    if (entry) onSelectNote(entry)
  }, [entriesByPath, resolvedPath, onSelectNote])

  const handleAgentFileModified = useCallback((relativePath: string) => {
    void refreshAgentChanges([relativePath])
  }, [refreshAgentChanges])

  const handleAgentVaultChanged = useCallback(() => {
    void refreshAgentChanges([])
  }, [refreshAgentChanges])

  const handleExternalVaultChanged = useCallback(async (changedPaths: string[]) => {
    // Our own auto-save triggered the watcher — skip the expensive vault scan entirely.
    if (activeTabPath && recentlySavedRef.current.has(activeTabPath)) return

    const [entries] = await Promise.all([
      reloadVault(),
      Promise.resolve(reloadFolders()),
      Promise.resolve(reloadViews()),
    ])

    if (!activeTabPath || hasUnsavedChanges(activeTabPath)) return
    if (Date.now() - lastEditTimestampRef.current < RECENT_EDIT_GRACE_MS) return
    if (!isActiveTabInChangedPaths(changedPaths, resolvedPath, activeTabPath)) return
    if (shouldKeepActiveEditorMounted?.() === true) return

    const refreshedEntry = entries.find((e) => normalizePath(e.path) === normalizePath(activeTabPath))
    if (refreshedEntry) await replaceActiveTab(refreshedEntry)
  }, [activeTabPath, hasUnsavedChanges, lastEditTimestampRef, recentlySavedRef, reloadFolders, reloadVault, reloadViews, replaceActiveTab, resolvedPath, shouldKeepActiveEditorMounted])

  return {
    openNoteByPath,
    handlePulseOpenNote,
    handleAgentFileCreated: reloadAndOpen,
    handleAgentFileModified,
    handleAgentVaultChanged,
    handleExternalVaultChanged,
  }
}
