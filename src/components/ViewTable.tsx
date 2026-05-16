import { memo, useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Copy } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import { trackViewTableCopied, trackViewTableConfigured } from '../lib/productAnalytics'
import type { VaultEntry, ViewDefinition, ViewFile, ViewTableConfig, ViewTableDensity } from '../types'
import { applySavedViewSort } from '../utils/noteListHelpers'
import { evaluateView } from '../utils/viewFilters'
import { buildViewTableRows, buildViewTableSummaries, resolveViewTableColumns, type ViewTableColumn } from '../utils/viewTableColumns'

interface ViewTableProps {
  view: ViewFile
  entries: VaultEntry[]
  onSelectNote: (entry: VaultEntry) => void
  onUpdateViewDefinition?: (filename: string, patch: Partial<ViewDefinition>, rootPath?: string) => void
  locale?: AppLocale
}

const DEFAULT_COLUMN_WIDTH = 180
const TITLE_COLUMN_WIDTH = 260
const MIN_COLUMN_WIDTH = 96
const MAX_COLUMN_WIDTH = 520

function nextDensity(density: ViewTableDensity | undefined): ViewTableDensity {
  return density === 'compact' ? 'comfortable' : 'compact'
}

function rowClipboardText(row: { cells: Record<string, string> }, columns: ViewTableColumn[]): string {
  return columns.map((column) => row.cells[column.id] ?? '').join('\t')
}

function columnIds(columns: ViewTableColumn[]): string[] {
  return columns.map((column) => column.id)
}

export const ViewTable = memo(function ViewTable({
  view,
  entries,
  onSelectNote,
  onUpdateViewDefinition,
  locale = 'en',
}: ViewTableProps) {
  const tableConfig = view.definition.table ?? undefined
  const [draftColumnSize, setDraftColumnSize] = useState<Record<string, number>>({})
  const filteredEntries = useMemo(
    () => evaluateView(view.definition, entries),
    [view.definition, entries],
  )
  const sortedEntries = useMemo(
    () => applySavedViewSort(filteredEntries, view.definition.sort),
    [filteredEntries, view.definition.sort],
  )
  const columns = useMemo(
    () => resolveViewTableColumns(view.definition.listPropertiesDisplay, tableConfig?.columns),
    [view.definition.listPropertiesDisplay, tableConfig?.columns],
  )
  const rows = useMemo(
    () => buildViewTableRows(sortedEntries, columns),
    [sortedEntries, columns],
  )
  const summaries = useMemo(
    () => buildViewTableSummaries(rows, columns, tableConfig?.summaries),
    [rows, columns, tableConfig?.summaries],
  )
  const density = tableConfig?.density ?? 'comfortable'
  const rowHeightClassName = density === 'compact' ? 'h-8' : 'h-10'
  const headerHeightClassName = density === 'compact' ? 'h-8' : 'h-9'
  const canPersistTable = Boolean(onUpdateViewDefinition)

  const saveTableConfig = useCallback((patch: Partial<ViewTableConfig>, action: 'density' | 'columns' | 'column_size') => {
    const nextTable = {
      ...(view.definition.table ?? {}),
      ...patch,
    }
    onUpdateViewDefinition?.(view.filename, { table: nextTable }, view.rootPath)
    trackViewTableConfigured(action)
  }, [onUpdateViewDefinition, view.definition.table, view.filename, view.rootPath])

  const moveColumn = useCallback((columnIndex: number, direction: -1 | 1) => {
    const nextIndex = columnIndex + direction
    if (nextIndex < 0 || nextIndex >= columns.length) return
    const ids = columnIds(columns)
    const [moved] = ids.splice(columnIndex, 1)
    ids.splice(nextIndex, 0, moved)
    saveTableConfig({ columns: ids }, 'columns')
  }, [columns, saveTableConfig])

  const toggleDensity = useCallback(() => {
    saveTableConfig({ density: nextDensity(density) }, 'density')
  }, [density, saveTableConfig])

  const columnWidth = useCallback((column: ViewTableColumn): number => {
    return draftColumnSize[column.id] ?? tableConfig?.columnSize?.[column.id] ?? (column.id === 'title' ? TITLE_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH)
  }, [draftColumnSize, tableConfig?.columnSize])

  const startResize = useCallback((event: PointerEvent, column: ViewTableColumn) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidth(column)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX))
      setDraftColumnSize((current) => ({ ...current, [column.id]: nextWidth }))
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      const nextWidth = Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + upEvent.clientX - startX)))
      setDraftColumnSize((current) => ({ ...current, [column.id]: nextWidth }))
      saveTableConfig({
        columnSize: {
          ...(tableConfig?.columnSize ?? {}),
          [column.id]: nextWidth,
        },
      }, 'column_size')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [columnWidth, saveTableConfig, tableConfig?.columnSize])

  const focusSiblingRow = useCallback((event: KeyboardEvent<HTMLTableRowElement>, delta: -1 | 1) => {
    const rowsInTable = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLTableRowElement>('[data-view-table-row]') ?? [])
    const currentIndex = rowsInTable.indexOf(event.currentTarget)
    rowsInTable[currentIndex + delta]?.focus()
  }, [])

  const handleRowKeyDown = useCallback((event: KeyboardEvent<HTMLTableRowElement>, entry: VaultEntry) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusSiblingRow(event, 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusSiblingRow(event, -1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onSelectNote(entry)
    }
  }, [focusSiblingRow, onSelectNote])

  const copyText = useCallback((text: string, source: 'cell' | 'row') => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(text)
    trackViewTableCopied(source)
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-semibold text-foreground">{view.definition.name}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {rows.length} {translate(locale, 'viewTable.rows')}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPersistTable}
          onClick={toggleDensity}
        >
          {density === 'compact' ? translate(locale, 'viewTable.comfortableDensity') : translate(locale, 'viewTable.compactDensity')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {translate(locale, 'viewTable.emptyState')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              {columns.map((column) => (
                <col key={column.id} style={{ width: `${columnWidth(column)}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-background">
              <tr>
                {columns.map((column, index) => (
                  <th
                    key={column.id}
                    scope="col"
                    className={`${headerHeightClassName} relative px-3 text-xs font-medium uppercase text-muted-foreground`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="block min-w-0 flex-1 truncate">{column.label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={!canPersistTable || index === 0}
                        aria-label={translate(locale, 'viewTable.moveColumnLeft')}
                        onClick={() => moveColumn(index, -1)}
                      >
                        <ArrowLeft size={13} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={!canPersistTable || index === columns.length - 1}
                        aria-label={translate(locale, 'viewTable.moveColumnRight')}
                        onClick={() => moveColumn(index, 1)}
                      >
                        <ArrowRight size={13} />
                      </Button>
                    </span>
                    <span
                      className="absolute right-0 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize border-r border-border"
                      aria-hidden="true"
                      title={translate(locale, 'viewTable.resizeColumn')}
                      onPointerDown={(event) => startResize(event, column)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.entry.path}
                  tabIndex={0}
                  data-view-table-row
                  className="border-b border-border/70 outline-none hover:bg-accent/70 focus:bg-accent focus:ring-2 focus:ring-ring focus:ring-inset"
                  onKeyDown={(event) => handleRowKeyDown(event, row.entry)}
                >
                  {columns.map((column, index) => (
                    <td key={column.id} className={`${rowHeightClassName} min-w-0 px-3 align-middle text-foreground`}>
                      {index === 0 ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto max-w-full min-w-0 justify-start overflow-hidden px-0 py-0 text-left text-sm font-medium hover:bg-transparent"
                            onClick={() => onSelectNote(row.entry)}
                          >
                            <span className="block truncate">{row.cells[column.id]}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            aria-label={translate(locale, 'viewTable.copyRow')}
                            onClick={() => copyText(rowClipboardText(row, columns), 'row')}
                          >
                            <Copy size={13} />
                          </Button>
                        </span>
                      ) : (
                        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                          <span className="block min-w-0 flex-1 truncate">{row.cells[column.id]}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            aria-label={translate(locale, 'viewTable.copyCell')}
                            onClick={() => copyText(row.cells[column.id] ?? '', 'cell')}
                          >
                            <Copy size={13} />
                          </Button>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {summaries.length > 0 ? (
              <tfoot className="border-t border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {columns.map((column) => {
                    const summary = summaries.find((candidate) => candidate.columnId === column.id)
                    return (
                      <td key={column.id} className="h-8 px-3 font-medium">
                        {summary ? `${translate(locale, 'viewTable.summary')}: ${summary.value}` : null}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  )
})
