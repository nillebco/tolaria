import { memo, useCallback, useMemo, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CaretDown, CaretUp, CaretUpDown, Copy, DotsSixVertical, DownloadSimple, GearSix } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import { isTauri } from '../mock-tauri'
import { trackViewTableCopied, trackViewTableConfigured, trackViewTableCsvExported } from '../lib/productAnalytics'
import type { VaultEntry, ViewDefinition, ViewFile, ViewTableColumnFilter, ViewTableConfig, ViewTableDensity } from '../types'
import { applySavedViewSort, parseSortConfig, serializeSortConfig, type SortDirection, type SortOption } from '../utils/noteListHelpers'
import { evaluateView } from '../utils/viewFilters'
import { viewTableCsvText, viewTableTsvText } from '../utils/viewTableCsv'
import { buildViewTableRowsResult, buildViewTableSummaries, resolveViewTableColumns, type ViewTableColumn } from '../utils/viewTableColumns'
import { ViewTableConfigDialog } from './ViewTableConfigDialog'

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

function csvFilename(name: string): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${stem || 'saved-view'}.csv`
}

function columnIds(columns: ViewTableColumn[]): string[] {
  return columns.map((column) => column.id)
}

function reorderColumnIds(columns: ViewTableColumn[], fromIndex: number, toIndex: number): string[] {
  const ids = columnIds(columns)
  const [moved] = ids.splice(fromIndex, 1)
  ids.splice(toIndex, 0, moved)
  return ids
}

function sortOptionForColumn(column: ViewTableColumn): SortOption | null {
  switch (column.kind) {
    case 'title':
      return 'title'
    case 'filename':
      return 'filename'
    case 'type':
      return 'type'
    case 'status':
      return 'status'
    case 'modified':
      return 'modified'
    case 'created':
      return 'created'
    case 'property':
      return column.propertyKey ? `property:${column.propertyKey}` : null
    case 'computed':
      return column.formula ? sortOptionForComputedSource(column.formula) : null
  }
}

function sortOptionForComputedSource(sourceField: string): SortOption | null {
  if (!/^[A-Za-z_][A-Za-z0-9_ -]*$/.test(sourceField.trim())) return null
  const normalized = sourceField.trim().toLowerCase()
  if (normalized === 'title') return 'title'
  if (normalized === 'filename') return 'filename'
  if (normalized === 'type') return 'type'
  if (normalized === 'status') return 'status'
  if (normalized === 'modified') return 'modified'
  if (normalized === 'created') return 'created'
  return `property:${sourceField}`
}

function nextSortDirection(current: SortDirection | null): SortDirection | null {
  if (current === null) return 'asc'
  if (current === 'asc') return 'desc'
  return null
}

function availableViewFields(entries: VaultEntry[], configuredProperties?: string[]): string[] {
  const fields = new Set(['title', 'filename', 'type', 'status', 'modified', 'created'])
  for (const property of configuredProperties ?? []) {
    const trimmed = property.trim()
    if (trimmed) fields.add(trimmed)
  }
  for (const entry of entries) {
    for (const key of Object.keys(entry.properties)) {
      fields.add(key)
    }
  }
  return Array.from(fields)
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
  const [draftColumnFilters, setDraftColumnFilters] = useState<Record<string, string>>({})
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const filteredEntries = useMemo(
    () => evaluateView(view.definition, entries),
    [view.definition, entries],
  )
  const sortedEntries = useMemo(
    () => applySavedViewSort(filteredEntries, view.definition.sort),
    [filteredEntries, view.definition.sort],
  )
  const columns = useMemo(
    () => resolveViewTableColumns(view.definition.listPropertiesDisplay, tableConfig?.columns, tableConfig?.computedColumns),
    [view.definition.listPropertiesDisplay, tableConfig?.columns, tableConfig?.computedColumns],
  )
  const availableFields = useMemo(
    () => availableViewFields(entries, view.definition.listPropertiesDisplay),
    [entries, view.definition.listPropertiesDisplay],
  )
  const rowModel = useMemo(
    () => buildViewTableRowsResult(sortedEntries, columns, tableConfig?.columnFilters),
    [sortedEntries, columns, tableConfig?.columnFilters],
  )
  const rows = rowModel.rows
  const formulaErrors = rowModel.formulaErrors
  const summaries = useMemo(
    () => buildViewTableSummaries(rows, columns, tableConfig?.summaries),
    [rows, columns, tableConfig?.summaries],
  )
  const density = tableConfig?.density ?? 'comfortable'
  const rowHeightClassName = density === 'compact' ? 'h-8' : 'h-10'
  const headerHeightClassName = density === 'compact' ? 'h-8' : 'h-9'
  const canPersistTable = Boolean(onUpdateViewDefinition)
  const currentSort = useMemo(() => parseSortConfig(view.definition.sort), [view.definition.sort])

  const saveTableConfig = useCallback((patch: Partial<ViewTableConfig>, action: 'density' | 'columns' | 'column_size' | 'computed_columns' | 'column_filters') => {
    const nextTable = {
      ...(view.definition.table ?? {}),
      ...patch,
    }
    onUpdateViewDefinition?.(view.filename, { table: nextTable }, view.rootPath)
    trackViewTableConfigured(action)
  }, [onUpdateViewDefinition, view.definition.table, view.filename, view.rootPath])

  const reorderColumns = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= columns.length || toIndex >= columns.length) return
    saveTableConfig({ columns: reorderColumnIds(columns, fromIndex, toIndex) }, 'columns')
  }, [columns, saveTableConfig])

  const startColumnDrag = useCallback((event: DragEvent<HTMLButtonElement>, column: ViewTableColumn) => {
    if (!canPersistTable) {
      event.preventDefault()
      return
    }
    setDraggedColumnId(column.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', column.id)
  }, [canPersistTable])

  const handleColumnDrop = useCallback((event: DragEvent<HTMLTableCellElement>, targetIndex: number) => {
    event.preventDefault()
    const draggedId = event.dataTransfer.getData('text/plain') || draggedColumnId
    const sourceIndex = columns.findIndex((column) => column.id === draggedId)
    reorderColumns(sourceIndex, targetIndex)
    setDraggedColumnId(null)
  }, [columns, draggedColumnId, reorderColumns])

  const cycleColumnSort = useCallback((column: ViewTableColumn) => {
    const option = sortOptionForColumn(column)
    if (!option || !canPersistTable) return
    const activeDirection = currentSort?.option === option ? currentSort.direction : null
    const direction = nextSortDirection(activeDirection)
    onUpdateViewDefinition?.(view.filename, { sort: direction ? serializeSortConfig({ option, direction }) : null }, view.rootPath)
  }, [canPersistTable, currentSort, onUpdateViewDefinition, view.filename, view.rootPath])

  const sortDirectionForColumn = useCallback((column: ViewTableColumn): SortDirection | null => {
    const option = sortOptionForColumn(column)
    return option && currentSort?.option === option ? currentSort.direction : null
  }, [currentSort])

  const toggleDensity = useCallback(() => {
    saveTableConfig({ density: nextDensity(density) }, 'density')
  }, [density, saveTableConfig])

  const columnWidth = useCallback((column: ViewTableColumn): number => {
    return draftColumnSize[column.id] ?? tableConfig?.columnSize?.[column.id] ?? (column.id === 'title' ? TITLE_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH)
  }, [draftColumnSize, tableConfig?.columnSize])

  const columnFilterText = useCallback((column: ViewTableColumn): string => {
    const draft = draftColumnFilters[column.id]
    if (draft !== undefined) return draft
    const filter = tableConfig?.columnFilters?.[column.id]
    if (!filter) return ''
    return filter.op === 'equals' ? `=${filter.value}` : filter.value
  }, [draftColumnFilters, tableConfig?.columnFilters])

  const saveColumnFilter = useCallback((column: ViewTableColumn, rawValue: string) => {
    const trimmed = rawValue.trim()
    const currentFilters = tableConfig?.columnFilters ?? {}
    const nextFilters: Record<string, ViewTableColumnFilter> = { ...currentFilters }
    if (!trimmed) {
      delete nextFilters[column.id]
    } else if (trimmed.startsWith('=')) {
      nextFilters[column.id] = { op: 'equals', value: trimmed.slice(1).trim() }
    } else {
      nextFilters[column.id] = { op: 'contains', value: trimmed }
    }
    setDraftColumnFilters((current) => {
      const next = { ...current }
      delete next[column.id]
      return next
    })
    saveTableConfig({ columnFilters: nextFilters }, 'column_filters')
  }, [saveTableConfig, tableConfig?.columnFilters])

  const startResize = useCallback((event: ReactPointerEvent, column: ViewTableColumn) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidth(column)

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX))
      setDraftColumnSize((current) => ({ ...current, [column.id]: nextWidth }))
    }

    const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
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

  const copyCsv = useCallback(async () => {
    const text = viewTableCsvText(columns, rows)
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('copy_text_to_clipboard', { text })
    } else {
      if (!navigator.clipboard) return
      await navigator.clipboard.writeText(text)
    }
    trackViewTableCsvExported('copy')
  }, [columns, rows])

  const copyTsv = useCallback(async () => {
    const text = viewTableTsvText(columns, rows)
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('copy_text_to_clipboard', { text })
    } else {
      if (!navigator.clipboard) return
      await navigator.clipboard.writeText(text)
    }
    trackViewTableCsvExported('copy_tsv')
  }, [columns, rows])

  const downloadCsv = useCallback(async () => {
    const csvText = viewTableCsvText(columns, rows)
    const filename = csvFilename(view.definition.name)
    if (isTauri()) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const path = await save({ defaultPath: filename, filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (!path) return
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_text_file', { path, content: csvText })
    } else {
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    }
    trackViewTableCsvExported('download')
  }, [columns, rows, view.definition.name])

  const saveViewConfig = useCallback((patch: Partial<ViewDefinition>) => {
    onUpdateViewDefinition?.(view.filename, patch, view.rootPath)
    if (patch.filters) trackViewTableConfigured('filters')
    if (patch.table?.computedColumns) trackViewTableConfigured('computed_columns')
  }, [onUpdateViewDefinition, view.filename, view.rootPath])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-semibold text-foreground">{view.definition.name}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {rows.length} {translate(locale, 'viewTable.rows')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyTsv}
          >
            <Copy size={14} className="mr-1" />
            {translate(locale, 'viewTable.copyTsv')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyCsv}
          >
            <Copy size={14} className="mr-1" />
            {translate(locale, 'viewTable.copyCsv')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadCsv}
          >
            <DownloadSimple size={14} className="mr-1" />
            {translate(locale, 'viewTable.exportCsv')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canPersistTable}
            onClick={() => setConfigOpen(true)}
          >
            <GearSix size={14} className="mr-1" />
            {translate(locale, 'viewTable.configure')}
          </Button>
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
      </div>
      <ViewTableConfigDialog
        open={configOpen}
        view={view.definition}
        currentColumns={columnIds(columns)}
        availableFields={availableFields}
        locale={locale}
        onClose={() => setConfigOpen(false)}
        onSave={saveViewConfig}
      />
      {formulaErrors.length > 0 ? (
        <div className="border-b border-border bg-destructive/10 px-5 py-2 text-xs text-destructive">
          {translate(locale, 'viewTable.formulaError')}: {formulaErrors.join(', ')}
        </div>
      ) : null}
      {sortedEntries.length === 0 ? (
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
                    onDragOver={(event) => {
                      if (!canPersistTable) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => handleColumnDrop(event, index)}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 cursor-grab"
                        disabled={!canPersistTable}
                        draggable={canPersistTable}
                        aria-label={translate(locale, 'viewTable.dragColumn')}
                        onDragStart={(event) => startColumnDrag(event, column)}
                        onDragEnd={() => setDraggedColumnId(null)}
                      >
                        <DotsSixVertical size={13} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 min-w-0 flex-1 justify-start gap-1 px-1 text-xs font-medium uppercase text-muted-foreground hover:text-foreground"
                        disabled={!canPersistTable || !sortOptionForColumn(column)}
                        aria-label={translate(locale, 'viewTable.sortColumn')}
                        onClick={() => cycleColumnSort(column)}
                      >
                        <span className="block min-w-0 truncate">{column.label}</span>
                        {sortDirectionForColumn(column) === 'asc' ? <CaretUp size={13} /> : null}
                        {sortDirectionForColumn(column) === 'desc' ? <CaretDown size={13} /> : null}
                        {sortDirectionForColumn(column) === null ? <CaretUpDown size={13} /> : null}
                      </Button>
                    </span>
                    <Input
                      value={columnFilterText(column)}
                      placeholder={translate(locale, 'viewTable.columnFilterPlaceholder')}
                      className="mt-1 h-7 text-xs normal-case"
                      disabled={!canPersistTable}
                      onChange={(event) => setDraftColumnFilters((current) => ({ ...current, [column.id]: event.target.value }))}
                      onBlur={(event) => saveColumnFilter(column, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          saveColumnFilter(column, event.currentTarget.value)
                          event.currentTarget.blur()
                        }
                      }}
                    />
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="h-16 px-3 text-center text-sm text-muted-foreground">
                    {translate(locale, 'viewTable.emptyState')}
                  </td>
                </tr>
              ) : null}
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
