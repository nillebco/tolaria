import type { VaultEntry, VaultPropertyValue, ViewTableSummary } from '../types'

export type ViewTableColumnKind =
  | 'title'
  | 'filename'
  | 'type'
  | 'status'
  | 'modified'
  | 'created'
  | 'property'

export interface ViewTableColumn {
  id: string
  label: string
  kind: ViewTableColumnKind
  propertyKey?: string
}

export interface ViewTableRow {
  entry: VaultEntry
  cells: Record<string, string>
}

export interface ViewTableSummaryValue {
  columnId: string
  label: string
  value: string
}

const DEFAULT_COLUMNS: ViewTableColumn[] = [
  { id: 'title', label: 'Title', kind: 'title' },
  { id: 'type', label: 'Type', kind: 'type' },
  { id: 'status', label: 'Status', kind: 'status' },
  { id: 'modified', label: 'Modified', kind: 'modified' },
]

function propertyColumn(key: string): ViewTableColumn {
  return {
    id: `property:${key}`,
    label: key,
    kind: 'property',
    propertyKey: key,
  }
}

function builtInColumn(id: string): ViewTableColumn | null {
  return DEFAULT_COLUMNS.find((column) => column.id === id) ?? (
    id === 'filename' ? { id: 'filename', label: 'Filename', kind: 'filename' } :
      id === 'created' ? { id: 'created', label: 'Created', kind: 'created' } :
        null
  )
}

function columnFromId(id: string): ViewTableColumn | null {
  if (id.startsWith('property:')) {
    const propertyKey = id.slice('property:'.length).trim()
    return propertyKey ? propertyColumn(propertyKey) : null
  }
  return builtInColumn(id)
}

function uniqueColumns(columns: ViewTableColumn[]): ViewTableColumn[] {
  const seen = new Set<string>()
  return columns.filter((column) => {
    const normalized = column.id.toLowerCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export function resolveViewTableColumns(
  listPropertiesDisplay?: string[],
  tableColumns?: string[],
): ViewTableColumn[] {
  const persistedColumns = uniqueColumns((tableColumns ?? []).map(columnFromId).filter((column): column is ViewTableColumn => Boolean(column)))
  if (persistedColumns.length > 0) return persistedColumns

  const propertyKeys = (listPropertiesDisplay ?? []).map((key) => key.trim()).filter(Boolean)
  if (propertyKeys.length === 0) return DEFAULT_COLUMNS

  const seen = new Set<string>()
  const columns = [{ id: 'title', label: 'Title', kind: 'title' } satisfies ViewTableColumn]
  for (const key of propertyKeys) {
    const normalized = key.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    columns.push(propertyColumn(key))
  }
  return columns
}

function formatTimestamp(value: number | null): string {
  if (value == null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString()
}

function formatPropertyValue(value: VaultPropertyValue | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

function cellValue(entry: VaultEntry, column: ViewTableColumn): string {
  switch (column.kind) {
    case 'title':
      return entry.title
    case 'filename':
      return entry.filename
    case 'type':
      return entry.isA ?? ''
    case 'status':
      return entry.status ?? ''
    case 'modified':
      return formatTimestamp(entry.modifiedAt)
    case 'created':
      return formatTimestamp(entry.createdAt)
    case 'property':
      return formatPropertyValue(column.propertyKey ? Reflect.get(entry.properties, column.propertyKey) as VaultPropertyValue | undefined : undefined)
  }
}

export function buildViewTableRows(entries: VaultEntry[], columns: ViewTableColumn[]): ViewTableRow[] {
  return entries.map((entry) => ({
    entry,
    cells: Object.fromEntries(columns.map((column) => [column.id, cellValue(entry, column)])),
  }))
}

function formatSummaryValue(type: ViewTableSummary, values: string[]): string {
  switch (type) {
    case 'count':
      return String(values.filter((value) => value.trim().length > 0).length)
    case 'empty':
      return String(values.filter((value) => value.trim().length === 0).length)
    case 'unique':
      return String(new Set(values.map((value) => value.trim()).filter(Boolean)).size)
    case 'sum': {
      const total = values.reduce((sum, value) => {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? sum + parsed : sum
      }, 0)
      return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(2)))
    }
  }
}

export function buildViewTableSummaries(
  rows: ViewTableRow[],
  columns: ViewTableColumn[],
  summaries: Record<string, ViewTableSummary> | undefined,
): ViewTableSummaryValue[] {
  if (!summaries) return []
  return columns.flatMap((column) => {
    const summary = summaries[column.id]
    if (!summary) return []
    return [{
      columnId: column.id,
      label: column.label,
      value: formatSummaryValue(summary, rows.map((row) => row.cells[column.id] ?? '')),
    }]
  })
}
