import type { VaultEntry, VaultPropertyValue, ViewTableSummary } from '../types'

export type ViewTableColumnKind =
  | 'title'
  | 'filename'
  | 'type'
  | 'status'
  | 'modified'
  | 'created'
  | 'computed'
  | 'property'

export interface ViewTableColumn {
  id: string
  label: string
  kind: ViewTableColumnKind
  propertyKey?: string
  sourceField?: string
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

function computedColumn(alias: string, sourceField: string): ViewTableColumn {
  return {
    id: `computed:${alias}`,
    label: alias,
    kind: 'computed',
    sourceField,
  }
}

function builtInColumn(id: string): ViewTableColumn | null {
  return DEFAULT_COLUMNS.find((column) => column.id === id) ?? (
    id === 'filename' ? { id: 'filename', label: 'Filename', kind: 'filename' } :
      id === 'created' ? { id: 'created', label: 'Created', kind: 'created' } :
        null
  )
}

function columnFromId(id: string, computedColumns: Record<string, string> | undefined): ViewTableColumn | null {
  if (id.startsWith('property:')) {
    const propertyKey = id.slice('property:'.length).trim()
    return propertyKey ? propertyColumn(propertyKey) : null
  }
  if (id.startsWith('computed:')) {
    const alias = id.slice('computed:'.length).trim()
    const sourceField = alias ? computedColumns?.[alias] : undefined
    return alias && sourceField ? computedColumn(alias, sourceField) : null
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
  computedColumns?: Record<string, string>,
): ViewTableColumn[] {
  const persistedColumns = uniqueColumns((tableColumns ?? []).map((id) => columnFromId(id, computedColumns)).filter((column): column is ViewTableColumn => Boolean(column)))
  if (persistedColumns.length > 0) return persistedColumns

  const propertyKeys = (listPropertiesDisplay ?? []).map((key) => key.trim()).filter(Boolean)
  const computed = Object.entries(computedColumns ?? {})
    .map(([alias, sourceField]) => [alias.trim(), sourceField.trim()] as const)
    .filter(([alias, sourceField]) => alias.length > 0 && sourceField.length > 0)
    .map(([alias, sourceField]) => computedColumn(alias, sourceField))
  if (propertyKeys.length === 0) return uniqueColumns([...DEFAULT_COLUMNS, ...computed])

  const seen = new Set<string>()
  const columns: ViewTableColumn[] = [{ id: 'title', label: 'Title', kind: 'title' }]
  for (const key of propertyKeys) {
    const normalized = key.toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    columns.push(propertyColumn(key))
  }
  return uniqueColumns([...columns, ...computed])
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

function propertyValue(entry: VaultEntry, key: string): VaultPropertyValue | undefined {
  const direct = Reflect.get(entry.properties, key) as VaultPropertyValue | undefined
  if (direct !== undefined) return direct
  const normalized = key.toLowerCase()
  const matchingKey = Object.keys(entry.properties).find((candidate) => candidate.toLowerCase() === normalized)
  return matchingKey ? Reflect.get(entry.properties, matchingKey) as VaultPropertyValue | undefined : undefined
}

function fieldValue(entry: VaultEntry, field: string): string {
  switch (field.toLowerCase()) {
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
    default:
      return formatPropertyValue(propertyValue(entry, field))
  }
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
    case 'computed':
      return column.sourceField ? fieldValue(entry, column.sourceField) : ''
    case 'property':
      return formatPropertyValue(column.propertyKey ? propertyValue(entry, column.propertyKey) : undefined)
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
