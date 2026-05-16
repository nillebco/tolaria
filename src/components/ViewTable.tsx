import { memo, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import type { VaultEntry, ViewFile } from '../types'
import { applySavedViewSort } from '../utils/noteListHelpers'
import { evaluateView } from '../utils/viewFilters'
import { buildViewTableRows, resolveViewTableColumns } from '../utils/viewTableColumns'

interface ViewTableProps {
  view: ViewFile
  entries: VaultEntry[]
  onSelectNote: (entry: VaultEntry) => void
  locale?: AppLocale
}

export const ViewTable = memo(function ViewTable({
  view,
  entries,
  onSelectNote,
  locale = 'en',
}: ViewTableProps) {
  const filteredEntries = useMemo(
    () => evaluateView(view.definition, entries),
    [view.definition, entries],
  )
  const sortedEntries = useMemo(
    () => applySavedViewSort(filteredEntries, view.definition.sort),
    [filteredEntries, view.definition.sort],
  )
  const columns = useMemo(
    () => resolveViewTableColumns(view.definition.listPropertiesDisplay),
    [view.definition.listPropertiesDisplay],
  )
  const rows = useMemo(
    () => buildViewTableRows(sortedEntries, columns),
    [sortedEntries, columns],
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-5 py-3">
        <h2 className="m-0 truncate text-sm font-semibold text-foreground">{view.definition.name}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {translate(locale, 'viewTable.emptyState')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-background">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className="h-9 px-3 text-xs font-medium uppercase text-muted-foreground"
                  >
                    <span className="block truncate">{column.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.entry.path} className="border-b border-border/70 hover:bg-accent/70">
                  {columns.map((column, index) => (
                    <td key={column.id} className="h-10 min-w-0 px-3 align-middle text-foreground">
                      {index === 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto max-w-full justify-start overflow-hidden px-0 py-0 text-left text-sm font-medium hover:bg-transparent"
                          onClick={() => onSelectNote(row.entry)}
                        >
                          <span className="block truncate">{row.cells[column.id]}</span>
                        </Button>
                      ) : (
                        <span className="block truncate text-muted-foreground">{row.cells[column.id]}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})
