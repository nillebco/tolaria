import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry, ViewFile } from '../types'
import { ViewTable } from './ViewTable'

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/test.md',
    filename: 'test.md',
    title: 'Test',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1700000000000,
    createdAt: 1700000000000,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

function makeView(overrides: Partial<ViewFile['definition']> = {}): ViewFile {
  return {
    filename: 'active-projects.yml',
    definition: {
      name: 'Active Projects',
      icon: null,
      color: null,
      sort: null,
      listPropertiesDisplay: ['Owner'],
      filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
      ...overrides,
    },
  }
}

describe('ViewTable', () => {
  it('renders matching saved-view rows with configured property columns', () => {
    render(
      <ViewTable
        view={makeView()}
        entries={[
          makeEntry({ path: '/vault/a.md', title: 'Alpha', isA: 'Project', properties: { Owner: 'Ivo' } }),
          makeEntry({ path: '/vault/b.md', title: 'Beta', isA: 'Note', properties: { Owner: 'Ada' } }),
        ]}
        onSelectNote={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Active Projects' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
    expect(screen.getByText('Ivo')).toBeInTheDocument()
  })

  it('opens a note when the title cell is clicked', () => {
    const onSelectNote = vi.fn()
    const entry = makeEntry({ path: '/vault/a.md', title: 'Alpha', isA: 'Project' })

    render(<ViewTable view={makeView()} entries={[entry]} onSelectNote={onSelectNote} />)
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))

    expect(onSelectNote).toHaveBeenCalledWith(entry)
  })

  it('shows an empty state when no notes match', () => {
    render(<ViewTable view={makeView()} entries={[makeEntry({ isA: 'Note' })]} onSelectNote={vi.fn()} />)

    expect(screen.getByText("No notes match this view's filters.")).toBeInTheDocument()
  })
})
