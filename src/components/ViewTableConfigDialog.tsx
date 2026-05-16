import { useMemo, useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import type { FilterGroup, ViewDefinition } from '../types'
import { FilterBuilder } from './FilterBuilder'
import { FilterFieldCombobox } from './FilterFieldCombobox'

interface ComputedColumnDraft {
  id: string
  alias: string
  sourceField: string
}

interface ViewTableConfigDialogProps {
  open: boolean
  view: ViewDefinition
  currentColumns: string[]
  availableFields: string[]
  locale: AppLocale
  onClose: () => void
  onSave: (patch: Partial<ViewDefinition>) => void
}

interface ViewTableConfigDialogFormProps extends ViewTableConfigDialogProps {
  fields: string[]
}

function cloneFilters(filters: FilterGroup): FilterGroup {
  return structuredClone(filters)
}

function computedColumnsToDrafts(computedColumns: Record<string, string> | undefined): ComputedColumnDraft[] {
  return Object.entries(computedColumns ?? {}).map(([alias, sourceField]) => ({
    id: `${alias}:${sourceField}`,
    alias,
    sourceField,
  }))
}

function draftsToComputedColumns(drafts: ComputedColumnDraft[]): Record<string, string> {
  return Object.fromEntries(
    drafts
      .map((draft) => [draft.alias.trim(), draft.sourceField.trim()] as const)
      .filter(([alias, sourceField]) => alias.length > 0 && sourceField.length > 0),
  )
}

function computedColumnIds(computedColumns: Record<string, string>): string[] {
  return Object.keys(computedColumns).map((alias) => `computed:${alias}`)
}

function nextTableColumns(currentColumns: string[] | undefined, computedColumns: Record<string, string>): string[] {
  const computedIds = computedColumnIds(computedColumns)
  const keptColumns = (currentColumns ?? []).filter((column) => !column.startsWith('computed:') || computedIds.includes(column))
  return [...keptColumns, ...computedIds.filter((column) => !keptColumns.includes(column))]
}

function ViewTableConfigDialogForm({
  view,
  currentColumns,
  fields,
  locale,
  onClose,
  onSave,
}: ViewTableConfigDialogFormProps) {
  const [filters, setFilters] = useState<FilterGroup>(() => cloneFilters(view.filters))
  const [computedDrafts, setComputedDrafts] = useState<ComputedColumnDraft[]>(() => computedColumnsToDrafts(view.table?.computedColumns))
  const [alias, setAlias] = useState('')
  const [sourceField, setSourceField] = useState(fields[0] ?? 'type')

  const addComputedColumn = () => {
    const trimmedAlias = alias.trim()
    const trimmedSource = sourceField.trim()
    if (!trimmedAlias || !trimmedSource) return
    setComputedDrafts((current) => [
      ...current.filter((draft) => draft.alias.toLowerCase() !== trimmedAlias.toLowerCase()),
      { id: `${trimmedAlias}:${trimmedSource}`, alias: trimmedAlias, sourceField: trimmedSource },
    ])
    setAlias('')
  }

  const removeComputedColumn = (id: string) => {
    setComputedDrafts((current) => current.filter((draft) => draft.id !== id))
  }

  const save = () => {
    const computedColumns = draftsToComputedColumns(computedDrafts)
    onSave({
      filters,
      table: {
        ...(view.table ?? {}),
        computedColumns,
        columns: nextTableColumns(view.table?.columns ?? currentColumns, computedColumns),
      },
    })
    onClose()
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{translate(locale, 'viewTable.filtersLabel')}</h3>
          <FilterBuilder group={filters} onChange={setFilters} availableFields={fields} />
        </section>
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{translate(locale, 'viewTable.computedColumnsLabel')}</h3>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={alias}
              placeholder={translate(locale, 'viewTable.computedAliasPlaceholder')}
              onChange={(event) => setAlias(event.target.value)}
            />
            <FilterFieldCombobox value={sourceField} fields={fields} onChange={setSourceField} />
            <Button type="button" variant="outline" onClick={addComputedColumn} disabled={!alias.trim() || !sourceField.trim()}>
              <Plus size={14} className="mr-1" />
              {translate(locale, 'viewTable.addComputedColumn')}
            </Button>
          </div>
          {computedDrafts.length > 0 ? (
            <div className="divide-y divide-border rounded-md border border-border">
              {computedDrafts.map((draft) => (
                <div key={draft.id} className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <span className="truncate font-medium text-foreground">{draft.alias}</span>
                  <span className="truncate text-muted-foreground">{draft.sourceField}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 justify-self-end"
                    aria-label={translate(locale, 'viewTable.removeComputedColumn')}
                    onClick={() => removeComputedColumn(draft.id)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{translate(locale, 'viewTable.computedColumnsEmpty')}</p>
          )}
        </section>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{translate(locale, 'common.cancel')}</Button>
        <Button type="button" onClick={save}>{translate(locale, 'common.save')}</Button>
      </DialogFooter>
    </>
  )
}

export function ViewTableConfigDialog(props: ViewTableConfigDialogProps) {
  const fields = useMemo(() => props.availableFields.length > 0 ? props.availableFields : ['type'], [props.availableFields])
  const formKey = `${props.view.name}:${JSON.stringify(props.view.filters)}:${JSON.stringify(props.view.table?.computedColumns ?? {})}`

  return (
    <Dialog open={props.open} onOpenChange={(isOpen) => { if (!isOpen) props.onClose() }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>{translate(props.locale, 'viewTable.settingsTitle')}</DialogTitle>
          <DialogDescription>
            {translate(props.locale, 'viewTable.settingsDescription')}
          </DialogDescription>
        </DialogHeader>
        {props.open && <ViewTableConfigDialogForm key={formKey} {...props} fields={fields} />}
      </DialogContent>
    </Dialog>
  )
}
