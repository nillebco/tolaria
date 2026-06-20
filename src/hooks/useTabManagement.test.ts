import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry, ViewFile } from '../types'
import {
  useTabManagement,
  prefetchNoteContent,
  cacheNoteContent,
  clearPrefetchCache,
  NOTE_CONTENT_CACHE_MAX_BYTES,
  NOTE_CONTENT_ENTRY_MAX_BYTES,
  NOTE_CONTENT_PREFETCH_CONCURRENCY,
  tabSessionStorageKey,
} from './useTabManagement'
import { viewTabPath } from '../utils/viewTabs'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn().mockResolvedValue('# Mock content'),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null, sort: null,
  outgoingLinks: [],
  ...overrides,
})

const makeView = (overrides: Partial<ViewFile> = {}): ViewFile => ({
  filename: 'views/produce.yml',
  definition: {
    name: 'Produce',
    icon: null,
    color: null,
    sort: null,
    filters: { all: [] },
    table: { columns: [] },
  },
  ...overrides,
})

type HookState = { current: ReturnType<typeof useTabManagement> }

async function selectNote(result: HookState, overrides: Partial<VaultEntry>) {
  await act(async () => {
    await result.current.handleSelectNote(makeEntry(overrides))
  })
}

async function selectNoteWithTimers(result: HookState, overrides: Partial<VaultEntry>, advanceMs: number) {
  let openPromise!: Promise<void>
  act(() => {
    openPromise = result.current.handleSelectNote(makeEntry(overrides))
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(advanceMs)
    await openPromise
  })
}

async function withFakeTimers(run: () => Promise<void>) {
  vi.useFakeTimers()
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

async function replaceActiveNote(result: HookState, overrides: Partial<VaultEntry>) {
  await act(async () => {
    await result.current.handleReplaceActiveTab(makeEntry(overrides))
  })
}

async function prefetchResolvedContent(path: string, content: string, entry?: VaultEntry) {
  mockNoteContent({ [path]: content })
  prefetchNoteContent(entry ?? path)
  await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
  return mockInvoke
}

function mockNoteContent(contentByPath: Record<string, string>) {
  vi.mocked(mockInvoke).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = contentByPath[path] ?? '# Mock content'
    if (cmd === 'validate_note_content') {
      return Promise.resolve(content === args?.content)
    }
    return Promise.resolve(content)
  })
}

function expectSingleActiveTab(result: HookState, path: string) {
  expect(result.current.tabs).toHaveLength(1)
  expect(result.current.tabs[0].entry.path).toBe(path)
  expect(result.current.activeTabPath).toBe(path)
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function makeAsciiContent(byteCount: number): string {
  return 'x'.repeat(byteCount)
}

async function flushAsyncRestore() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function seedCacheBeyondByteLimit() {
  const cachedContent = makeAsciiContent(Math.floor(NOTE_CONTENT_ENTRY_MAX_BYTES * 0.9))
  const cachedPaths = Array.from(
    { length: Math.floor(NOTE_CONTENT_CACHE_MAX_BYTES / cachedContent.length) + 2 },
    (_, index) => `/vault/note/cached-${index + 1}.md`,
  )

  for (const path of cachedPaths) {
    cacheNoteContent(path, cachedContent)
  }

  return {
    cachedContent,
    oldestPath: cachedPaths[0],
    newestPath: cachedPaths[cachedPaths.length - 1],
  }
}

describe('useTabManagement', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    clearPrefetchCache()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.mocked(mockInvoke).mockResolvedValue('# Mock content')
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('starts with no note and null active path', () => {
    const { result } = renderHook(() => useTabManagement())
    expect(result.current.tabs).toEqual([])
    expect(result.current.activeTabPath).toBeNull()
  })

  it('opens or focuses a saved view as a first-class tab', async () => {
    const view = makeView()
    const { result } = renderHook(() => useTabManagement())

    await act(async () => {
      await result.current.openViewTab(view)
      await result.current.openViewTab(view)
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0].entry.path).toBe(viewTabPath(view))
    expect(result.current.tabs[0].entry.title).toBe('Produce')
    expect(result.current.activeTabPath).toBe(viewTabPath(view))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  describe('session persistence', () => {
    it('persists open paths and the active note for the session key', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const { result } = renderHook(() => useTabManagement({ sessionKey }))

      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })

      expect(JSON.parse(localStorage.getItem(sessionKey) ?? '{}')).toEqual({
        version: 1,
        openPaths: ['/vault/a.md', '/vault/b.md'],
        activePath: '/vault/b.md',
      })
    })

    it('restores stored open notes when matching entries are available', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      localStorage.setItem(sessionKey, JSON.stringify({
        version: 1,
        openPaths: ['/vault/a.md', '/vault/b.md'],
        activePath: '/vault/a.md',
      }))
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# A')
        .mockResolvedValueOnce('# B')

      const entries = [
        makeEntry({ path: '/vault/a.md', title: 'A' }),
        makeEntry({ path: '/vault/b.md', title: 'B' }),
      ]
      const { result } = renderHook(() => useTabManagement({ entries, sessionKey }))

      await flushAsyncRestore()

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/vault/a.md', '/vault/b.md'])
      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(result.current.tabs[0].content).toBe('# A')
      expect(result.current.tabs[1].content).toBe('# B')
    })

    it('persists open view tabs in the same session as notes', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const view = makeView()
      const { result } = renderHook(() => useTabManagement({ sessionKey, views: [view] }))

      await act(async () => {
        await result.current.openViewTab(view)
      })

      expect(JSON.parse(localStorage.getItem(sessionKey) ?? '{}')).toEqual({
        version: 1,
        openPaths: [viewTabPath(view)],
        activePath: viewTabPath(view),
      })
    })

    it('restores stored view tabs without loading note content', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const view = makeView()
      localStorage.setItem(sessionKey, JSON.stringify({
        version: 1,
        openPaths: [viewTabPath(view)],
        activePath: viewTabPath(view),
      }))

      const { result } = renderHook(() => useTabManagement({ sessionKey, views: [view] }))

      await flushAsyncRestore()

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual([viewTabPath(view)])
      expect(result.current.tabs[0].entry.title).toBe('Produce')
      expect(result.current.activeTabPath).toBe(viewTabPath(view))
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('restores after the vault path and entries load after startup', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      localStorage.setItem(sessionKey, JSON.stringify({
        version: 1,
        openPaths: ['/vault/a.md'],
        activePath: '/vault/a.md',
      }))
      vi.mocked(mockInvoke).mockResolvedValueOnce('# A')
      const entries = [makeEntry({ path: '/vault/a.md', title: 'A' })]

      const { result, rerender } = renderHook(
        ({ activeSessionKey, activeEntries }) => useTabManagement({
          entries: activeEntries,
          sessionKey: activeSessionKey,
        }),
        { initialProps: { activeSessionKey: null as string | null, activeEntries: [] as VaultEntry[] } },
      )

      rerender({ activeSessionKey: sessionKey, activeEntries: [] })
      rerender({ activeSessionKey: sessionKey, activeEntries: entries })
      await flushAsyncRestore()

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/vault/a.md'])
      expect(result.current.activeTabPath).toBe('/vault/a.md')
    })

    it('restores when correct vault entries load after entries from wrong vault were present first', async () => {
      // Regression: restoredSessionKeyRef was set before checking entriesToRestore.length,
      // so if sessionKey changed while entries from a different vault were loaded, the ref
      // would be pre-set and the restore would never run when the correct entries arrived.
      const wrongVaultEntries = [makeEntry({ path: '/demo-vault/note.md', title: 'Demo' })]
      const targetSessionKey = tabSessionStorageKey('/target-vault')!
      localStorage.setItem(targetSessionKey, JSON.stringify({
        version: 1,
        openPaths: ['/target-vault/a.md'],
        activePath: '/target-vault/a.md',
      }))
      vi.mocked(mockInvoke).mockResolvedValueOnce('# A')
      const targetEntries = [makeEntry({ path: '/target-vault/a.md', title: 'A' })]

      const { result, rerender } = renderHook(
        ({ activeSessionKey, activeEntries }) => useTabManagement({
          entries: activeEntries,
          sessionKey: activeSessionKey,
        }),
        { initialProps: { activeSessionKey: null as string | null, activeEntries: [] as VaultEntry[] } },
      )

      // sessionKey arrives while entries are still from the wrong vault
      rerender({ activeSessionKey: targetSessionKey, activeEntries: wrongVaultEntries })
      await flushAsyncRestore()

      // No tabs yet — wrong entries, restore must NOT be permanently blocked
      expect(result.current.tabs).toEqual([])

      // Correct vault entries arrive
      rerender({ activeSessionKey: targetSessionKey, activeEntries: targetEntries })
      await flushAsyncRestore()

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/target-vault/a.md'])
      expect(result.current.activeTabPath).toBe('/target-vault/a.md')
    })

    it('ignores missing stored paths during restore', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      localStorage.setItem(sessionKey, JSON.stringify({
        version: 1,
        openPaths: ['/vault/missing.md', '/vault/b.md'],
        activePath: '/vault/missing.md',
      }))
      vi.mocked(mockInvoke).mockResolvedValueOnce('# B')

      const entries = [makeEntry({ path: '/vault/b.md', title: 'B' })]
      const { result } = renderHook(() => useTabManagement({ entries, sessionKey }))

      await flushAsyncRestore()

      expect(result.current.tabs[0].entry.path).toBe('/vault/b.md')
      expect(result.current.activeTabPath).toBe('/vault/b.md')
    })

    it('leaves the stored session intact when no stored path matches current entries', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const storedSession = {
        version: 1,
        openPaths: ['/vault/missing.md'],
        activePath: '/vault/missing.md',
      }
      localStorage.setItem(sessionKey, JSON.stringify(storedSession))

      const entries = [makeEntry({ path: '/vault/other.md', title: 'Other' })]
      const { result } = renderHook(() => useTabManagement({ entries, sessionKey }))

      await flushAsyncRestore()

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(JSON.parse(localStorage.getItem(sessionKey) ?? '{}')).toEqual(storedSession)
    })

    it('does not write an empty session on startup when no stored session exists', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const entries = [makeEntry({ path: '/vault/other.md', title: 'Other' })]

      const { result } = renderHook(() => useTabManagement({ entries, sessionKey }))

      await flushAsyncRestore()

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(localStorage.getItem(sessionKey)).toBeNull()
    })

    it('can clear tabs without erasing the stored session during vault switches', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const { result } = renderHook(() => useTabManagement({ sessionKey }))

      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      const storedSession = localStorage.getItem(sessionKey)

      act(() => {
        result.current.closeAllTabs({ preserveSession: true })
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(localStorage.getItem(sessionKey)).toBe(storedSession)
    })

    it('persists an empty session when the user explicitly closes the last tab', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const { result } = renderHook(() => useTabManagement({ sessionKey }))

      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      act(() => {
        result.current.closeTab('/vault/a.md')
      })

      expect(JSON.parse(localStorage.getItem(sessionKey) ?? '{}')).toEqual({
        version: 1,
        openPaths: [],
        activePath: null,
      })
    })
  })

  describe('handleSelectNote', () => {
    it('opens a note and sets it active', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/a.md' })
      expectSingleActiveTab(result, '/vault/note/a.md')
    })

    it('normalizes partially hydrated note metadata before opening after reload churn', async () => {
      const partialEntry = {
        path: '/vault/note/apple-mail.md',
        title: undefined,
        filename: undefined,
        aliases: undefined,
        outgoingLinks: undefined,
      } as unknown as VaultEntry

      const { result } = renderHook(() => useTabManagement())
      await act(async () => {
        await result.current.handleSelectNote(partialEntry)
      })

      expectSingleActiveTab(result, '/vault/note/apple-mail.md')
      expect(result.current.tabs[0].entry).toEqual(expect.objectContaining({
        filename: 'apple-mail.md',
        title: 'apple-mail',
        aliases: [],
        outgoingLinks: [],
      }))
    })

    it('ignores note-open requests without a usable path', async () => {
      const { result } = renderHook(() => useTabManagement())

      await act(async () => {
        await result.current.handleSelectNote(makeEntry({ path: ' ' }))
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(vi.mocked(mockInvoke)).not.toHaveBeenCalled()
    })

    it('switches the active path immediately while the next note is still loading', async () => {
      let resolveContent: (value: string) => void
      vi.mocked(mockInvoke).mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveContent = resolve }),
      )

      const { result } = renderHook(() => useTabManagement())
      void act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/pending.md', title: 'Pending' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/pending.md')
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        resolveContent!('# Pending content')
      })

      expect(result.current.tabs[0].entry.path).toBe('/vault/note/pending.md')
      expect(result.current.tabs[0].content).toBe('# Pending content')
    })

    it('does not reopen a stale note load after all tabs are closed', async () => {
      const content = createDeferred<string>()
      vi.mocked(mockInvoke).mockImplementationOnce(() => content.promise)

      const { result } = renderHook(() => useTabManagement())
      void act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/old-vault/note/pending.md', title: 'Pending' }))
      })

      act(() => {
        result.current.closeAllTabs()
      })

      await act(async () => {
        content.resolve('# Stale content')
        await content.promise
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
    })

    it('opens an additional tab and activates it when selecting a different note', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/vault/a.md', '/vault/b.md'])
      expect(result.current.activeTabPath).toBe('/vault/b.md')
    })

    it('keeps a dirty already-open note in place when selecting it again', async () => {
      const entry = { path: '/vault/a.md' }
      const { result: dirtyResult } = renderHook(() => useTabManagement({
        hasUnsavedChanges: (path) => path === '/vault/a.md',
      }))
      await selectNote(dirtyResult, entry)
      act(() => {
        dirtyResult.current.setTabs(prev => prev.map(tab =>
          tab.entry.path === entry.path ? { ...tab, content: '# Local draft' } : tab
        ))
      })

      await act(async () => {
        await dirtyResult.current.handleSelectNote(makeEntry(entry))
      })

      expect(dirtyResult.current.tabs).toHaveLength(1)
      expect(dirtyResult.current.tabs[0].content).toBe('# Local draft')
    })

    it('retries transient note content load failures before opening the note', async () => {
      vi.mocked(mockInvoke)
        .mockRejectedValueOnce(new Error('transient IPC failure'))
        .mockResolvedValueOnce('# Recovered content')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await withFakeTimers(async () => {
          const { result } = renderHook(() => useTabManagement())
          await selectNoteWithTimers(result, { path: '/vault/note/recovered.md' }, 120)

          expect(result.current.tabs).toHaveLength(1)
          expect(result.current.tabs[0].content).toBe('# Recovered content')
          expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
          expect(warnSpy).not.toHaveBeenCalled()
        })
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('does not display a note as empty when content loading fails', async () => {
      vi.mocked(mockInvoke).mockRejectedValue(new Error('transient IPC failure'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await withFakeTimers(async () => {
          const { result } = renderHook(() => useTabManagement())
          await selectNoteWithTimers(result, { path: '/vault/note/failing.md' }, 1_240)

          expect(result.current.tabs).toEqual([])
          expect(result.current.activeTabPath).toBeNull()
          expect(warnSpy).toHaveBeenCalledWith('Failed to load note content:', expect.any(Error))
        })
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('clears the active note when the file is missing on disk', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File does not exist: /vault/note/missing.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      await selectNote(result, { path: '/vault/note/missing.md', title: 'Missing Note' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/missing.md', title: 'Missing Note' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('returns to the empty state when note content is not valid UTF-8 text', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('File is not valid UTF-8 text: /vault/note/bad.csv'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onUnreadableNoteContent = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onUnreadableNoteContent }))
      await selectNote(result, {
        path: '/vault/note/bad.csv',
        filename: 'bad.csv',
        title: 'bad.csv',
        fileKind: 'text',
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onUnreadableNoteContent).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/bad.csv', title: 'bad.csv' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('opens binary image files without trying to load them as text notes', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, {
        path: '/vault/assets/photo.png',
        filename: 'photo.png',
        title: 'photo.png',
        fileKind: 'binary',
      })

      expectSingleActiveTab(result, '/vault/assets/photo.png')
      expect(result.current.tabs[0].content).toBe('')
      expect(vi.mocked(mockInvoke)).not.toHaveBeenCalled()
    })

    it('returns to the empty state when no active vault is selected', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('No active vault selected'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/orphaned.md', title: 'Orphaned Note' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      warnSpy.mockRestore()
    })

    it('reports an unavailable active vault instead of opening a blank stale tab', async () => {
      vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('Active vault is not available'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onMissingActiveVault = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingActiveVault }))
      await selectNote(result, { path: '/vault/note/orphaned.md', title: 'Orphaned Note' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingActiveVault).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/orphaned.md', title: 'Orphaned Note' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('uses the note-window vault path when Tauri reloads the selected note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValue('# Window content')
      window.history.replaceState(
        {},
        '',
        '/?window=note&path=%2Fvault%2Fnote%2Ftest.md&vault=%2Fvault&title=Test+Note',
      )

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/test.md', title: 'Test Note' })

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_note_content', {
        path: '/vault/note/test.md',
        vaultPath: '/vault',
      })
      expect(result.current.tabs[0].content).toBe('# Window content')
    })

    it('uses the entry workspace vault path when Tauri opens a mounted workspace note', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockResolvedValue('# Workspace content')

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, {
        path: '/team/tolaria-app.md',
        title: 'Tolaria',
        workspace: {
          id: 'team',
          label: 'Team',
          alias: 'team',
          path: '/team',
          shortLabel: 'TE',
          color: null,
          icon: null,
          mounted: true,
          available: true,
          defaultForNewNotes: false,
        },
      })

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_note_content', {
        path: '/team/tolaria-app.md',
        vaultPath: '/team',
      })
      expect(result.current.tabs[0].content).toBe('# Workspace content')
    })

    it('does not reuse cached content across workspaces with the same relative note path', async () => {
      vi.mocked(isTauri).mockReturnValue(true)
      vi.mocked(invoke).mockImplementation((_cmd: string, args?: { vaultPath?: string }) => (
        Promise.resolve(args?.vaultPath === '/team' ? '# Team content' : '# Personal content')
      ))

      const personalWorkspace = {
        id: 'personal',
        label: 'Personal',
        alias: 'personal',
        path: '/personal',
        shortLabel: 'PE',
        color: null,
        icon: null,
        mounted: true,
        available: true,
        defaultForNewNotes: false,
      }
      const teamWorkspace = { ...personalWorkspace, id: 'team', label: 'Team', alias: 'team', path: '/team', shortLabel: 'TE' }
      prefetchNoteContent(makeEntry({ path: 'shared.md', workspace: personalWorkspace }))
      await vi.waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_note_content', {
        path: 'shared.md',
        vaultPath: '/personal',
      }))

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, {
        path: 'shared.md',
        title: 'Shared',
        workspace: teamWorkspace,
      })

      expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_note_content', {
        path: 'shared.md',
        vaultPath: '/team',
      })
      expect(result.current.tabs[0].content).toBe('# Team content')
    })
  })

  describe('handleReplaceActiveTab', () => {
    it('replaces the current note with a new entry', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await replaceActiveNote(result, { path: '/vault/b.md', title: 'B' })
      expectSingleActiveTab(result, '/vault/b.md')
    })

    it('preserves other open tabs when replacing the active tab with a new path', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      await selectNote(result, { path: '/vault/c.md', title: 'C' })

      await act(async () => {
        await result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/c-renamed.md', title: 'C renamed' }))
      })

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual([
        '/vault/a.md',
        '/vault/b.md',
        '/vault/c-renamed.md',
      ])
      expect(result.current.activeTabPath).toBe('/vault/c-renamed.md')
    })

    it('treats /tmp and /private/tmp aliases as the same active note', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Stale before pull')
        .mockResolvedValueOnce('# Fresh after pull')
      const beforeNavigate = vi.fn().mockResolvedValue(undefined)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/private/tmp/vault/active.md', title: 'Active' })

      await act(async () => {
        await result.current.handleReplaceActiveTab(
          makeEntry({ path: '/tmp/vault/active.md', title: 'Active' }),
        )
      })

      expect(beforeNavigate).not.toHaveBeenCalled()
      expect(result.current.activeTabPath).toBe('/tmp/vault/active.md')
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Fresh after pull')
    })

    it('reloads content when replacing with the same entry', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Stale before pull')
        .mockResolvedValueOnce('# Fresh after pull')

      const { result } = renderHook(() => useTabManagement())
      const entry = { path: '/vault/a.md', title: 'A' }
      await selectNote(result, entry)

      await act(async () => {
        await result.current.handleReplaceActiveTab(makeEntry(entry))
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Fresh after pull')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('clears the active note when a forced reload hits a missing file path', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Existing content')
        .mockRejectedValueOnce(new Error('File does not exist: /vault/a.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      const entry = makeEntry({ path: '/vault/a.md', title: 'A' })
      await selectNote(result, entry)

      await act(async () => {
        await result.current.handleReplaceActiveTab(entry)
      })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/a.md', title: 'A' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('opens a note when no note is active', async () => {
      const { result } = renderHook(() => useTabManagement())
      await replaceActiveNote(result, { path: '/vault/a.md' })
      expectSingleActiveTab(result, '/vault/a.md')
    })

    it('validates cached content before replacing with a different active note', async () => {
      cacheNoteContent('/vault/b.md', '# Stale cached B')
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return Promise.resolve(false)
        return Promise.resolve('# Fresh disk B')
      })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await replaceActiveNote(result, { path: '/vault/b.md', title: 'B' })

      expect(result.current.tabs[0].content).toBe('# Fresh disk B')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledWith('validate_note_content', {
        path: '/vault/b.md',
        content: '# Stale cached B',
      })
    })
  })

  describe('openTabWithContent', () => {
    it('opens a note with pre-loaded content', () => {
      const { result } = renderHook(() => useTabManagement())
      const entry = makeEntry({ path: '/vault/new.md' })

      act(() => {
        result.current.openTabWithContent(entry, '# New note')
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# New note')
      expect(result.current.activeTabPath).toBe('/vault/new.md')
    })
  })

  describe('setTabs entry sync', () => {
    it('updates note entry via setTabs mapper (vault entry sync pattern)', async () => {
      const { result } = renderHook(() => useTabManagement())
      const entry = makeEntry({ path: '/vault/a.md', archived: false })

      await act(async () => {
        await result.current.handleSelectNote(entry)
      })

      const freshEntry = { ...entry, archived: true }
      act(() => {
        result.current.setTabs(prev => prev.map(tab =>
          tab.entry.path === freshEntry.path ? { ...tab, entry: freshEntry } : tab
        ))
      })

      expect(result.current.tabs[0].entry.archived).toBe(true)
    })
  })

  describe('closeAllTabs', () => {
    it('clears the note and active path', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md' })

      act(() => {
        result.current.closeAllTabs()
      })

      expect(result.current.tabs).toHaveLength(0)
      expect(result.current.activeTabPath).toBeNull()
    })
  })

  describe('closeOtherTabs', () => {
    it('keeps the active tab and closes the rest', async () => {
      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      await selectNote(result, { path: '/vault/c.md', title: 'C' })

      act(() => {
        result.current.closeOtherTabs()
      })

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/vault/c.md'])
      expect(result.current.activeTabPath).toBe('/vault/c.md')
    })

    it('persists the active tab as the remaining session', async () => {
      const sessionKey = tabSessionStorageKey('/vault')!
      const { result } = renderHook(() => useTabManagement({ sessionKey }))

      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })

      act(() => {
        result.current.closeOtherTabs()
      })

      expect(JSON.parse(localStorage.getItem(sessionKey) ?? '{}')).toEqual({
        version: 1,
        openPaths: ['/vault/b.md'],
        activePath: '/vault/b.md',
      })
    })
  })

  describe('reorderTabs', () => {
    it('moves an open tab before the drop target without changing the active tab', async () => {
      const { result } = renderHook(() => useTabManagement())

      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      await selectNote(result, { path: '/vault/c.md', title: 'C' })

      act(() => {
        result.current.reorderTabs('/vault/c.md', '/vault/a.md')
      })

      expect(result.current.tabs.map((tab) => tab.entry.path)).toEqual(['/vault/c.md', '/vault/a.md', '/vault/b.md'])
      expect(result.current.activeTabPath).toBe('/vault/c.md')
    })
  })

  describe('content prefetch cache', () => {
    it('prefetch validates cached content against disk before reuse', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/pre.md', '# Prefetched content')

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/pre.md', title: 'Pre' })

      expect(result.current.tabs[0].content).toBe('# Prefetched content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
      expect(vi.mocked(mockInvoke)).toHaveBeenLastCalledWith('validate_note_content', {
        path: '/vault/note/pre.md',
        content: '# Prefetched content',
      })
    })

    it('uses identity-matched prefetched content without re-reading the file', async () => {
      const entry = makeEntry({
        path: '/vault/note/pre.md',
        modifiedAt: 1700000001,
        fileSize: 19,
      })
      const mockInvoke = await prefetchResolvedContent(entry.path, '# Prefetched content', entry)

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, entry)

      expect(result.current.tabs[0].content).toBe('# Prefetched content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1)
    })

    it('paints cached content while freshness validation is pending then refreshes stale content', async () => {
      const freshness = createDeferred<boolean>()
      cacheNoteContent('/vault/note/stale.md', '# Stale cached content')
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return freshness.promise
        return Promise.resolve('# Fresh disk content')
      })

      const { result } = renderHook(() => useTabManagement())
      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/stale.md', title: 'Stale' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/stale.md')
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Stale cached content')

      await act(async () => {
        freshness.resolve(false)
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(result.current.tabs[0].content).toBe('# Fresh disk content')
      })
    })

    it('clearPrefetchCache prevents stale content from being served', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/stale.md', '# Stale')

      clearPrefetchCache()
      mockNoteContent({ '/vault/note/stale.md': '# Fresh' })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/stale.md', title: 'Stale' })

      expect(result.current.tabs[0].content).toBe('# Fresh')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('deduplicates concurrent prefetch requests for same path', async () => {
      vi.mocked(mockInvoke).mockResolvedValue('# Content')

      prefetchNoteContent('/vault/note/dup.md')
      prefetchNoteContent('/vault/note/dup.md')
      prefetchNoteContent('/vault/note/dup.md')

      await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
    })

    it('limits concurrent background prefetch reads', async () => {
      const pendingReads = new Map<string, ReturnType<typeof createDeferred<string>>>()
      let activeReads = 0
      let maxActiveReads = 0
      vi.mocked(mockInvoke).mockImplementation((_cmd: string, args?: Record<string, unknown>) => {
        const path = typeof args?.path === 'string' ? args.path : ''
        const deferred = createDeferred<string>()
        pendingReads.set(path, deferred)
        activeReads += 1
        maxActiveReads = Math.max(maxActiveReads, activeReads)
        return deferred.promise.finally(() => {
          activeReads -= 1
        })
      })

      const paths = Array.from({ length: NOTE_CONTENT_PREFETCH_CONCURRENCY + 3 }, (_, index) => `/vault/note/pre-${index}.md`)
      for (const path of paths) prefetchNoteContent(path)

      await vi.waitFor(() => {
        expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(NOTE_CONTENT_PREFETCH_CONCURRENCY)
      })
      expect(maxActiveReads).toBe(NOTE_CONTENT_PREFETCH_CONCURRENCY)

      await act(async () => {
        pendingReads.get(paths[0])?.resolve('# First')
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(NOTE_CONTENT_PREFETCH_CONCURRENCY + 1)
      })
      expect(maxActiveReads).toBe(NOTE_CONTENT_PREFETCH_CONCURRENCY)

      await act(async () => {
        for (const deferred of pendingReads.values()) deferred.resolve('# Done')
        await Promise.resolve()
      })
      await vi.waitFor(() => {
        expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(paths.length)
      })
      await act(async () => {
        for (const deferred of pendingReads.values()) deferred.resolve('# Done')
        await Promise.resolve()
      })
    })

    it('promotes a queued prefetch when the note is opened', async () => {
      const pendingReads = new Map<string, ReturnType<typeof createDeferred<string>>>()
      vi.mocked(mockInvoke).mockImplementation((_cmd: string, args?: Record<string, unknown>) => {
        const path = typeof args?.path === 'string' ? args.path : ''
        const deferred = createDeferred<string>()
        pendingReads.set(path, deferred)
        return deferred.promise
      })

      const paths = Array.from({ length: NOTE_CONTENT_PREFETCH_CONCURRENCY + 1 }, (_, index) => `/vault/note/promote-${index}.md`)
      for (const path of paths) prefetchNoteContent(path)

      await vi.waitFor(() => {
        expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(NOTE_CONTENT_PREFETCH_CONCURRENCY)
      })

      const queuedPath = paths[NOTE_CONTENT_PREFETCH_CONCURRENCY]
      const { result } = renderHook(() => useTabManagement())
      await act(async () => {
        void result.current.handleSelectNote(makeEntry({ path: queuedPath, title: 'Queued' }))
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(pendingReads.has(queuedPath)).toBe(true)
      })

      await act(async () => {
        pendingReads.get(queuedPath)?.resolve('# Queued content')
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe('# Queued content')

      await act(async () => {
        for (const [path, deferred] of pendingReads) {
          if (path !== queuedPath) deferred.resolve('# Done')
        }
        await Promise.resolve()
      })
    })

    it('swallows no-active-vault prefetch failures and lets a later open recover', async () => {
      vi.mocked(mockInvoke)
        .mockRejectedValueOnce(new Error('No active vault selected'))
        .mockResolvedValueOnce('# Recovered content')

      prefetchNoteContent('/vault/note/recovered.md')
      await vi.waitFor(() => expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1))
      await Promise.resolve()
      await Promise.resolve()

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/recovered.md', title: 'Recovered' })

      expect(result.current.tabs[0].content).toBe('# Recovered content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('serves refreshed cached content after a save replaces stale prefetched data', async () => {
      const mockInvoke = await prefetchResolvedContent('/vault/note/saved.md', '# Stale prefetched content')
      mockNoteContent({ '/vault/note/saved.md': '# Persisted content' })

      cacheNoteContent('/vault/note/saved.md', '# Persisted content')

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/note/saved.md', title: 'Saved' })

      expect(result.current.tabs[0].content).toBe('# Persisted content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('activates a warmed note after validating cached content', async () => {
      const deferred = createDeferred<boolean>()
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return deferred.promise
        return Promise.resolve('# Warm content')
      })
      cacheNoteContent('/vault/note/warm.md', '# Warm content')

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/warm.md', title: 'Warm' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/warm.md')
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Warm content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1)

      await act(async () => {
        deferred.resolve(true)
        await Promise.resolve()
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe('# Warm content')
    })

    it('does not retain oversized notes in the prefetch cache', async () => {
      const largeContent = makeAsciiContent(NOTE_CONTENT_ENTRY_MAX_BYTES + 1)
      const mockInvoke = await prefetchResolvedContent('/vault/note/oversized.md', largeContent)
      const deferred = createDeferred<string>()
      vi.mocked(mockInvoke).mockImplementationOnce(() => deferred.promise)

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/oversized.md', title: 'Oversized' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/note/oversized.md')
      expect(result.current.tabs).toEqual([])
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)

      await act(async () => {
        deferred.resolve(largeContent)
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe(largeContent)
    })

    it('evicts the oldest cached notes when retained bytes exceed the cache budget', async () => {
      const { cachedContent, oldestPath } = seedCacheBeyondByteLimit()
      const deferred = createDeferred<string>()
      vi.mocked(mockInvoke).mockImplementationOnce(() => deferred.promise)

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: oldestPath, title: 'Oldest cached note' }))
      })

      expect(result.current.activeTabPath).toBe(oldestPath)
      expect(result.current.tabs).toEqual([])

      await act(async () => {
        deferred.resolve(cachedContent)
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe(cachedContent)
    })

    it('keeps the newest cached notes warm when trimming to the byte budget', async () => {
      const { cachedContent, newestPath } = seedCacheBeyondByteLimit()
      const deferred = createDeferred<boolean>()
      vi.mocked(mockInvoke).mockImplementation((cmd: string) => {
        if (cmd === 'validate_note_content') return deferred.promise
        return Promise.resolve(cachedContent)
      })

      const { result } = renderHook(() => useTabManagement())

      act(() => {
        void result.current.handleSelectNote(makeEntry({ path: newestPath, title: 'Newest cached note' }))
      })

      expect(result.current.activeTabPath).toBe(newestPath)
      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe(cachedContent)

      await act(async () => {
        deferred.resolve(true)
        await Promise.resolve()
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0].content).toBe(cachedContent)
    })

    it('reuses cached content when reopening a recently loaded note', async () => {
      mockNoteContent({
        '/vault/a.md': '# A content',
        '/vault/b.md': '# B content',
      })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })
      await selectNote(result, { path: '/vault/b.md', title: 'B' })
      await selectNote(result, { path: '/vault/a.md', title: 'A again' })

      expect(result.current.tabs[0].entry.path).toBe('/vault/a.md')
      expect(result.current.tabs[0].content).toBe('# A content')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(2)
    })

    it('refreshes an already-open clean note when cached content is stale on disk', async () => {
      mockNoteContent({ '/vault/a.md': '# Original content' })

      const { result } = renderHook(() => useTabManagement())
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      mockNoteContent({ '/vault/a.md': '# External edit' })
      await selectNote(result, {
        path: '/vault/a.md',
        title: 'A',
        modifiedAt: 1700000001,
        fileSize: 15,
      })

      expect(result.current.tabs[0].entry.path).toBe('/vault/a.md')
      expect(result.current.tabs[0].content).toBe('# External edit')
      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(mockInvoke)).toHaveBeenNthCalledWith(2, 'validate_note_content', {
        path: '/vault/a.md',
        content: '# Original content',
      })
    })

    it('falls back instead of reopening cached content when the note file disappeared', async () => {
      vi.mocked(mockInvoke)
        .mockResolvedValueOnce('# Other note')
        .mockRejectedValueOnce(new Error('File does not exist: /vault/note/missing-cached.md'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      cacheNoteContent('/vault/note/missing-cached.md', '# Cached but stale')
      const onMissingNotePath = vi.fn()

      const { result } = renderHook(() => useTabManagement({ onMissingNotePath }))
      await selectNote(result, { path: '/vault/other.md', title: 'Other' })
      await selectNote(result, { path: '/vault/note/missing-cached.md', title: 'Missing cached' })

      expect(result.current.tabs).toEqual([])
      expect(result.current.activeTabPath).toBeNull()
      expect(onMissingNotePath).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/vault/note/missing-cached.md', title: 'Missing cached' }),
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('deduplicates a late prefetch after note opening already started', async () => {
      let resolveContent!: (value: string) => void
      vi.mocked(mockInvoke).mockImplementationOnce(
        () => new Promise<string>((resolve) => { resolveContent = resolve }),
      )

      const { result } = renderHook(() => useTabManagement())

      await act(async () => {
        void result.current.handleSelectNote(makeEntry({ path: '/vault/note/rapid.md', title: 'Rapid' }))
        prefetchNoteContent('/vault/note/rapid.md')
        await Promise.resolve()
      })

      expect(vi.mocked(mockInvoke)).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveContent('# Rapid content')
        await Promise.resolve()
      })

      expect(result.current.tabs[0].content).toBe('# Rapid content')
    })
  })

  describe('rapid switching safety', () => {
    it('only activates the last note when switching rapidly', async () => {
      let resolveA: (v: string) => void
      let resolveB: (v: string) => void
      vi.mocked(mockInvoke)
        .mockImplementationOnce(() => new Promise<string>((r) => { resolveA = r as (v: string) => void }))
        .mockImplementationOnce(() => new Promise<string>((r) => { resolveB = r as (v: string) => void }))

      const { result } = renderHook(() => useTabManagement())

      let selectADone = false
      await act(async () => {
        result.current.handleSelectNote(makeEntry({ path: '/vault/a.md', title: 'A' })).then(() => { selectADone = true })
        await Promise.resolve()
      })

      let selectBDone = false
      await act(async () => {
        result.current.handleSelectNote(makeEntry({ path: '/vault/b.md', title: 'B' })).then(() => { selectBDone = true })
        await Promise.resolve()
      })

      await act(async () => { resolveB!('# B content') })
      await act(async () => { resolveA!('# A content') })

      await vi.waitFor(() => expect(selectADone && selectBDone).toBe(true))

      expect(result.current.activeTabPath).toBe('/vault/b.md')
    })

    it('waits for beforeNavigate before switching away from the current note', async () => {
      const beforeNavigate = vi.fn(() => createDeferred<void>().promise)
      const deferred = createDeferred<void>()
      beforeNavigate.mockReturnValueOnce(deferred.promise)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      let replaceDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
          .then(() => { replaceDone = true })
        await Promise.resolve()
      })

      expect(beforeNavigate).toHaveBeenCalledWith('/vault/a.md', '/vault/b.md')
      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(replaceDone).toBe(false)

      await act(async () => {
        deferred.resolve(undefined)
        await Promise.resolve()
      })

      await vi.waitFor(() => expect(replaceDone).toBe(true))
      expectSingleActiveTab(result, '/vault/b.md')
    })

    it('records the requested note while the current note is still saving', async () => {
      const deferred = createDeferred<void>()
      const beforeNavigate = vi.fn().mockReturnValueOnce(deferred.promise)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      await act(async () => {
        void result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
        await Promise.resolve()
      })

      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(result.current.requestedActiveTabPathRef.current).toBe('/vault/b.md')

      await act(async () => {
        deferred.resolve(undefined)
        await Promise.resolve()
      })

      await vi.waitFor(() => expect(result.current.activeTabPath).toBe('/vault/b.md'))
      expect(result.current.requestedActiveTabPathRef.current).toBe('/vault/b.md')
    })

    it('keeps only the latest target when note switches overlap during beforeNavigate', async () => {
      const first = createDeferred<void>()
      const second = createDeferred<void>()
      const beforeNavigate = vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      let switchToBDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
          .then(() => { switchToBDone = true })
        await Promise.resolve()
      })

      let switchToCDone = false
      await act(async () => {
        result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/c.md', title: 'C' }))
          .then(() => { switchToCDone = true })
        await Promise.resolve()
      })

      await act(async () => {
        first.resolve(undefined)
        await Promise.resolve()
      })
      expect(result.current.activeTabPath).toBe('/vault/a.md')

      await act(async () => {
        second.resolve(undefined)
        await Promise.resolve()
      })

      await vi.waitFor(() => expect(switchToBDone && switchToCDone).toBe(true))
      expect(result.current.activeTabPath).toBe('/vault/c.md')
    })

    it('keeps the current note active when beforeNavigate fails', async () => {
      const beforeNavigate = vi.fn().mockRejectedValueOnce(new Error('save failed'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { result } = renderHook(() => useTabManagement({ beforeNavigate }))
      await selectNote(result, { path: '/vault/a.md', title: 'A' })

      await act(async () => {
        await result.current.handleReplaceActiveTab(makeEntry({ path: '/vault/b.md', title: 'B' }))
      })

      expect(result.current.activeTabPath).toBe('/vault/a.md')
      expect(result.current.requestedActiveTabPathRef.current).toBe('/vault/a.md')
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist note before navigation:',
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })
  })
})
