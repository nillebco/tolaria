import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry, ViewFile } from '../types'
import { viewTableCsvText } from '../utils/viewTableCsv'
import { resolveViewTableColumns } from '../utils/viewTableColumns'
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

  it('opens the focused row with the keyboard', () => {
    const onSelectNote = vi.fn()
    const entry = makeEntry({ path: '/vault/a.md', title: 'Alpha', isA: 'Project' })

    render(<ViewTable view={makeView()} entries={[entry]} onSelectNote={onSelectNote} />)
    fireEvent.keyDown(screen.getByRole('row', { name: /Alpha/ }), { key: 'Enter' })

    expect(onSelectNote).toHaveBeenCalledWith(entry)
  })

  function createDataTransfer() {
    let value = ''
    return {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn((_type: string, nextValue: string) => { value = nextValue }),
      getData: vi.fn(() => value),
    }
  }

  it('persists table density and dragged column order changes', () => {
    const onUpdateViewDefinition = vi.fn()

    render(<ViewTable view={makeView()} entries={[makeEntry({ isA: 'Project' })]} onSelectNote={vi.fn()} onUpdateViewDefinition={onUpdateViewDefinition} />)

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onUpdateViewDefinition).toHaveBeenCalledWith('active-projects.yml', { table: { density: 'compact' } }, undefined)

    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'Drag column' })[0], { dataTransfer })
    fireEvent.drop(screen.getByRole('columnheader', { name: /Owner/ }), { dataTransfer })

    expect(onUpdateViewDefinition).toHaveBeenLastCalledWith('active-projects.yml', { table: { columns: ['property:Owner', 'title'] } }, undefined)
  })

  it('cycles header sort persistence through ascending, descending, and default order', () => {
    const onUpdateViewDefinition = vi.fn()
    const { rerender } = render(
      <ViewTable
        view={makeView()}
        entries={[makeEntry({ isA: 'Project', properties: { Owner: 'Ivo' } })]}
        onSelectNote={vi.fn()}
        onUpdateViewDefinition={onUpdateViewDefinition}
      />,
    )

    const ownerHeader = screen.getByRole('columnheader', { name: /Owner/ })
    fireEvent.click(within(ownerHeader).getByRole('button', { name: 'Sort column' }))
    expect(onUpdateViewDefinition).toHaveBeenLastCalledWith('active-projects.yml', { sort: 'property:Owner:asc' }, undefined)

    rerender(
      <ViewTable
        view={makeView({ sort: 'property:Owner:asc' })}
        entries={[makeEntry({ isA: 'Project', properties: { Owner: 'Ivo' } })]}
        onSelectNote={vi.fn()}
        onUpdateViewDefinition={onUpdateViewDefinition}
      />,
    )
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Owner/ })).getByRole('button', { name: 'Sort column' }))
    expect(onUpdateViewDefinition).toHaveBeenLastCalledWith('active-projects.yml', { sort: 'property:Owner:desc' }, undefined)

    rerender(
      <ViewTable
        view={makeView({ sort: 'property:Owner:desc' })}
        entries={[makeEntry({ isA: 'Project', properties: { Owner: 'Ivo' } })]}
        onSelectNote={vi.fn()}
        onUpdateViewDefinition={onUpdateViewDefinition}
      />,
    )
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Owner/ })).getByRole('button', { name: 'Sort column' }))
    expect(onUpdateViewDefinition).toHaveBeenLastCalledWith('active-projects.yml', { sort: null }, undefined)
  })

  it('sorts date-like frontmatter values by date value', () => {
    render(
      <ViewTable
        view={makeView({ listPropertiesDisplay: ['Start'], sort: 'property:Start:asc' })}
        entries={[
          makeEntry({ path: '/vault/may.md', title: 'May', isA: 'Project', properties: { Start: '2026-05-08' } }),
          makeEntry({ path: '/vault/april.md', title: 'April', isA: 'Project', properties: { Start: '2026-04-30' } }),
        ]}
        onSelectNote={vi.fn()}
      />,
    )

    const titleButtons = screen.getAllByRole('button', { name: /April|May/ }).map((button) => button.textContent)
    expect(titleButtons).toEqual(['April', 'May'])
  })

  it('saves edited filters and computed alias columns from the configuration dialog', () => {
    const onUpdateViewDefinition = vi.fn()

    render(
      <ViewTable
        view={makeView()}
        entries={[makeEntry({ isA: 'Project', properties: { Owner: 'Ivo' } })]}
        onSelectNote={vi.fn()}
        onUpdateViewDefinition={onUpdateViewDefinition}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    fireEvent.change(screen.getByPlaceholderText('Alias, e.g. hours'), { target: { value: 'display' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onUpdateViewDefinition).toHaveBeenCalledWith('active-projects.yml', {
      filters: { all: [{ field: 'type', op: 'equals', value: 'Project' }] },
      table: {
        computedColumns: { display: 'title' },
        columns: ['title', 'property:Owner', 'computed:display'],
      },
    }, undefined)
  })

  it('copies rows and cells as tabular text', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <ViewTable
        view={makeView()}
        entries={[makeEntry({ title: 'Alpha', isA: 'Project', properties: { Owner: 'Ivo' } })]}
        onSelectNote={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText('Copy row'))
    fireEvent.click(screen.getByLabelText('Copy cell'))

    expect(writeText).toHaveBeenNthCalledWith(1, 'Alpha\tIvo')
    expect(writeText).toHaveBeenNthCalledWith(2, 'Ivo')
  })

  it('copies the rendered table as CSV', () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <ViewTable
        view={makeView()}
        entries={[makeEntry({ title: 'Alpha', isA: 'Project', properties: { Owner: 'Ivo, Ada' } })]}
        onSelectNote={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }))

    expect(writeText).toHaveBeenCalledWith('Title,Owner\nAlpha,"Ivo, Ada"')
  })

  it('escapes CSV values with quotes and line breaks', () => {
    const columns = resolveViewTableColumns(['Owner'])

    expect(viewTableCsvText(columns, [{
      cells: {
        title: 'Alpha "Q1"',
        'property:Owner': 'Ada\nIvo',
      },
    }])).toBe('Title,Owner\n"Alpha ""Q1""","Ada\nIvo"')
  })

  it('shows an empty state when no notes match', () => {
    render(<ViewTable view={makeView()} entries={[makeEntry({ isA: 'Note' })]} onSelectNote={vi.fn()} />)

    expect(screen.getByText("No notes match this view's filters.")).toBeInTheDocument()
  })
})
