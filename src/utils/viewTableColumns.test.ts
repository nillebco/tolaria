import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { buildViewTableRows, buildViewTableRowsResult, buildViewTableSummaries, resolveViewTableColumns } from './viewTableColumns'

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

  it('resolves computed alias columns from source properties', () => {
    const columns = resolveViewTableColumns(['Owner'], ['title', 'computed:quantity'], { quantity: 'Hours' })
    const [row] = buildViewTableRows([
      makeEntry({ title: 'Alpha', properties: { Hours: 2.5 } }),
    ], columns)

    expect(columns.map((column) => column.label)).toEqual(['Title', 'quantity'])
    expect(row.cells).toMatchObject({
      title: 'Alpha',
      'computed:quantity': '2.5',
    })
  })

  it('computes formula columns with arithmetic and conditionals', () => {
    const columns = resolveViewTableColumns([], ['title', 'computed:amount'], {
      amount: 'if(item == "carrot", quantity * 2, quantity * 3)',
    })
    const rows = buildViewTableRows([
      makeEntry({ title: 'Carrot', properties: { item: 'carrot', quantity: 2 } }),
      makeEntry({ title: 'Other', properties: { item: 'other', quantity: 3 } }),
    ], columns)

    expect(rows.map((row) => row.cells['computed:amount'])).toEqual(['4', '9'])
  })

  it('filters rows by table column filters before summaries are computed', () => {
    const columns = resolveViewTableColumns([], ['title', 'property:item', 'property:quantity', 'computed:amount'], {
      amount: 'quantity * 2',
    })
    const { rows } = buildViewTableRowsResult([
      makeEntry({ title: 'Included', properties: { item: 'carrot', quantity: 2 } }),
      makeEntry({ title: 'Excluded', properties: { item: 'other', quantity: 3 } }),
    ], columns, {
      'property:item': { op: 'equals', value: 'carrot' },
    })

    expect(rows.map((row) => row.entry.title)).toEqual(['Included'])
    expect(buildViewTableSummaries(rows, columns, {
      'property:quantity': 'sum',
      'computed:amount': 'sum',
    })).toEqual([
      { columnId: 'property:quantity', label: 'quantity', value: '2' },
      { columnId: 'computed:amount', label: 'amount', value: '4' },
    ])
  })

  it('fails closed for invalid formula cells', () => {
    const columns = resolveViewTableColumns([], ['title', 'computed:amount'], {
      amount: 'quantity *',
    })
    const { rows, formulaErrors } = buildViewTableRowsResult([
      makeEntry({ title: 'Broken', properties: { quantity: 2 } }),
    ], columns)

    expect(rows[0].cells['computed:amount']).toBe('')
    expect(formulaErrors).toEqual(['amount'])
  })
})
