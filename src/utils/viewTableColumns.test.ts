import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { buildViewTableRows, buildViewTableSummaries, resolveViewTableColumns } from './viewTableColumns'

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
    modifiedAt: null,
    createdAt: null,
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

describe('resolveViewTableColumns', () => {
  it('uses conservative built-in columns when no properties are configured', () => {
    expect(resolveViewTableColumns().map((column) => column.id)).toEqual([
      'title',
      'type',
      'status',
      'modified',
    ])
  })

  it('uses configured view properties after the title column', () => {
    expect(resolveViewTableColumns(['Owner', 'Priority']).map((column) => column.id)).toEqual([
      'title',
      'property:Owner',
      'property:Priority',
    ])
  })

  it('builds row cell values for scalar and array properties', () => {
    const columns = resolveViewTableColumns(['Owner', 'Tags'])
    const [row] = buildViewTableRows([
      makeEntry({ title: 'Alpha', properties: { Owner: 'Ivo', Tags: ['blue', 'green'] } }),
    ], columns)

    expect(row.cells).toMatchObject({
      title: 'Alpha',
      'property:Owner': 'Ivo',
      'property:Tags': 'blue, green',
    })
  })

  it('uses persisted table columns before list display properties', () => {
    expect(resolveViewTableColumns(['Owner'], ['property:Priority', 'title', 'created']).map((column) => column.id)).toEqual([
      'property:Priority',
      'title',
      'created',
    ])
  })

  it('builds configured summaries from visible rows', () => {
    const columns = resolveViewTableColumns(['Score', 'Owner'])
    const rows = buildViewTableRows([
      makeEntry({ properties: { Score: 2, Owner: 'Ada' } }),
      makeEntry({ properties: { Score: 3, Owner: 'Ada' } }),
      makeEntry({ properties: { Score: '', Owner: 'Ivo' } }),
    ], columns)

    expect(buildViewTableSummaries(rows, columns, {
      'property:Score': 'sum',
      'property:Owner': 'unique',
    })).toEqual([
      { columnId: 'property:Score', label: 'Score', value: '5' },
      { columnId: 'property:Owner', label: 'Owner', value: '2' },
    ])
  })
})
