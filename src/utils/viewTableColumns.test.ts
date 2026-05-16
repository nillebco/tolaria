import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { buildViewTableRows, resolveViewTableColumns } from './viewTableColumns'

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
})
