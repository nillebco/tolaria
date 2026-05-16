import type { ViewTableColumn } from './viewTableColumns'

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function viewTableCsvText(columns: ViewTableColumn[], rows: Array<{ cells: Record<string, string> }>): string {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row.cells[column.id] ?? '')).join(',')),
  ]
  return lines.join('\n')
}
