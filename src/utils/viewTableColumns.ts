import type { VaultEntry, VaultPropertyValue } from '../types'

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

export function resolveViewTableColumns(listPropertiesDisplay?: string[]): ViewTableColumn[] {
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
