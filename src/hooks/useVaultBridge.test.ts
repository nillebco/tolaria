import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useVaultBridge } from './useVaultBridge'
import type { VaultEntry } from '../types'

function makeEntry(path: string, title = 'Test'): VaultEntry {
  return { path, title, filename: path.split('/').pop()!, content: '', outgoingLinks: [], snippet: '', wordCount: 0, isA: 'Note', status: null, createdAt: null, modifiedAt: null, icon: null, tags: [] } as unknown as VaultEntry
}

function expectVaultDerivedStateReloaded(options: {
  reloadVault: ReturnType<typeof vi.fn>
  reloadFolders: ReturnType<typeof vi.fn>
  reloadViews: ReturnType<typeof vi.fn>
}) {
  const { reloadVault, reloadFolders, reloadViews } = options
  expect(reloadVault).toHaveBeenCalledOnce()
  expect(reloadFolders).toHaveBeenCalledOnce()
  expect(reloadViews).toHaveBeenCalledOnce()
}

describe('useVaultBridge', () => {
  const onSelectNote = vi.fn()
  let reloadVault: ReturnType<typeof vi.fn>
  let reloadFolders: ReturnType<typeof vi.fn>
  let reloadViews: ReturnType<typeof vi.fn>
  let closeAllTabs: ReturnType<typeof vi.fn>
  let replaceActiveTab: ReturnType<typeof vi.fn>
  let hasUnsavedChanges: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    reloadVault = vi.fn().mockResolvedValue([])
    reloadFolders = vi.fn()
    reloadViews = vi.fn()
    closeAllTabs = vi.fn()
    replaceActiveTab = vi.fn().mockResolvedValue(undefined)
    hasUnsavedChanges = vi.fn(() => false)
  })

  function renderBridge(
    entries: VaultEntry[] = [],
    activeTabPath: string | null = null,
    overrides: Partial<{
      hasUnsavedChanges: typeof hasUnsavedChanges
      recentlySaved: Set<string>
      lastEditTimestamp: number
      shouldKeepActiveEditorMounted: () => boolean
    }> = {},
  ) {
    const entriesByPath = new Map(entries.map(e => [e.path, e]))
    const recentlySaved = overrides.recentlySaved ?? new Set<string>()
    const lastEditTimestamp = overrides.lastEditTimestamp ?? 0
    return renderHook(() => {
      const recentlySavedRef = useRef(recentlySaved)
      const lastEditTimestampRef = useRef(lastEditTimestamp)
      return useVaultBridge({
        entriesByPath,
        resolvedPath: '/vault',
        reloadVault,
        reloadFolders,
        reloadViews,
        closeAllTabs,
        replaceActiveTab,
        hasUnsavedChanges: overrides.hasUnsavedChanges ?? hasUnsavedChanges,
        shouldKeepActiveEditorMounted: overrides.shouldKeepActiveEditorMounted,
        onSelectNote,
        activeTabPath,
        recentlySavedRef,
        lastEditTimestampRef,
      })
    })
  }

  it('opens a note by path when entry exists', () => {
    const entry = makeEntry('/vault/note.md')
    const { result } = renderBridge([entry])

    act(() => { result.current.openNoteByPath('/vault/note.md') })

    expect(onSelectNote).toHaveBeenCalledWith(entry)
    expect(reloadVault).not.toHaveBeenCalled()
  })

  it('opens a note by relative path', () => {
    const entry = makeEntry('/vault/note.md')
    const { result } = renderBridge([entry])

    act(() => { result.current.openNoteByPath('note.md') })

    expect(onSelectNote).toHaveBeenCalledWith(entry)
  })

  it('reloads vault when entry not found', async () => {
    const fresh = makeEntry('/vault/new.md')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([])

    await act(async () => { result.current.openNoteByPath('/vault/new.md') })

    expect(reloadVault).toHaveBeenCalled()
    expect(onSelectNote).toHaveBeenCalledWith(fresh)
  })

  it('handlePulseOpenNote opens existing entry', () => {
    const entry = makeEntry('/vault/pulse.md')
    const { result } = renderBridge([entry])

    act(() => { result.current.handlePulseOpenNote('pulse.md') })

    expect(onSelectNote).toHaveBeenCalledWith(entry)
  })

  it('handlePulseOpenNote does nothing for missing entry', () => {
    const { result } = renderBridge([])

    act(() => { result.current.handlePulseOpenNote('missing.md') })

    expect(onSelectNote).not.toHaveBeenCalled()
  })

  it('handleAgentFileCreated reloads and opens created note', async () => {
    const fresh = makeEntry('/vault/created.md')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([])

    await act(async () => { result.current.handleAgentFileCreated('created.md') })

    expect(reloadVault).toHaveBeenCalled()
    expect(onSelectNote).toHaveBeenCalledWith(fresh)
  })

  it('handleAgentFileModified refreshes the active tab with fresh disk content', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md')

    await act(async () => { result.current.handleAgentFileModified('active.md') })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).toHaveBeenCalledOnce()
    expect(replaceActiveTab).toHaveBeenCalledWith(fresh)
  })

  it('handleAgentFileModified keeps the active tab mounted for other notes', async () => {
    const active = makeEntry('/vault/other.md', 'Other')
    reloadVault.mockResolvedValue([active])
    const { result } = renderBridge([], '/vault/other.md')

    await act(async () => { result.current.handleAgentFileModified('active.md') })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('keeps unsaved active note content intact while reloading agent changes', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const hasUnsaved = vi.fn((path: string) => path === '/vault/active.md')
    const { result } = renderBridge([], '/vault/active.md', { hasUnsavedChanges: hasUnsaved })

    await act(async () => { result.current.handleAgentFileModified('active.md') })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleAgentVaultChanged reloads vault-derived state without remounting the active note', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md')

    await act(async () => { result.current.handleAgentVaultChanged() })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleExternalVaultChanged reloads the active tab when its file is in changedPaths', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md')

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).toHaveBeenCalledWith(fresh)
  })

  it('handleExternalVaultChanged skips tab reload when path not in changedPaths', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md')

    await act(async () => { result.current.handleExternalVaultChanged(['other.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleExternalVaultChanged preserves unsaved active note', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const hasUnsaved = vi.fn((path: string) => path === '/vault/active.md')
    const { result } = renderBridge([], '/vault/active.md', { hasUnsavedChanges: hasUnsaved })

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(closeAllTabs).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleExternalVaultChanged skips reload when user edited recently (active-typing suppression)', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md', {
      lastEditTimestamp: Date.now() - 500, // edited 500ms ago, within 3s grace
    })

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleExternalVaultChanged keeps focused active editor mounted', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md', {
      shouldKeepActiveEditorMounted: () => true,
    })

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })

  it('handleExternalVaultChanged allows reload when user has been idle', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md', {
      lastEditTimestamp: Date.now() - 10000, // idle for 10s, outside grace window
    })

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    expectVaultDerivedStateReloaded({ reloadVault, reloadFolders, reloadViews })
    expect(replaceActiveTab).toHaveBeenCalledWith(fresh)
  })

  it('handleExternalVaultChanged skips reload for recently saved paths (own-save suppression)', async () => {
    const fresh = makeEntry('/vault/active.md', 'Fresh active')
    reloadVault.mockResolvedValue([fresh])
    const { result } = renderBridge([], '/vault/active.md', {
      recentlySaved: new Set(['/vault/active.md']),
    })

    await act(async () => { result.current.handleExternalVaultChanged(['active.md']) })

    // The entire vault scan is skipped when we recently saved the file ourselves.
    expect(reloadVault).not.toHaveBeenCalled()
    expect(reloadFolders).not.toHaveBeenCalled()
    expect(reloadViews).not.toHaveBeenCalled()
    expect(replaceActiveTab).not.toHaveBeenCalled()
  })
})
