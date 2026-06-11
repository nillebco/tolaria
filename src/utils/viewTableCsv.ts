import type { ViewTableColumn } from './viewTableColumns'

function csvCell(value: string): string {
  const normalized = value.replaceAll('\t', ' ')
  return /[",\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized
}

export function viewTableCsvText(columns: ViewTableColumn[], rows: Array<{ cells: Record<string, string> }>): string {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row.cells[column.id] ?? '')).join(',')),
  ]
  return lines.join('\n')
}

function tsvCell(value: string): string {
  return value.replaceAll('\t', ' ').replaceAll('\r\n', ' ').replaceAll('\n', ' ').replaceAll('\r', ' ')
}

export function viewTableTsvText(columns: ViewTableColumn[], rows: Array<{ cells: Record<string, string> }>): string {
  const lines = [
    columns.map((column) => tsvCell(column.label)).join('\t'),
    ...rows.map((row) => columns.map((column) => tsvCell(row.cells[column.id] ?? '')).join('\t')),
  ]
  return lines.join('\n')
}
