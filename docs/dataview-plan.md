# Plan: Open Saved Views as Dynamic Tables

## Context

The goal is **not** to support Obsidian `.base` files. The goal is to add a
dynamic table presentation for Tolaria's existing Saved Views.

Tolaria already has the core model needed for this:

- `ViewFile` / `ViewDefinition` represent Saved Views.
- `ViewDefinition.filters` is a `FilterGroup` tree.
- `src/utils/viewFilters.ts` evaluates those filters.
- `ViewDefinition.sort` stores saved-view sorting.
- `ViewDefinition.listPropertiesDisplay` stores the properties selected for
  that view's note-list chips.

This plan adds an **Open as Table** action for Saved Views. It renders the
selected Saved View as a full editor-area table, without introducing a new file
format.

---

## Product Shape

Saved Views keep their current sidebar behavior. Selecting a Saved View still
filters the note list as it does today.

A new action, **Open as Table**, opens a transient table surface in the editor
area:

- Rows are notes matching the Saved View filters.
- Columns come from the Saved View's visible properties, plus built-in columns.
- Clicking a row opens the note.
- The table is read-only in the first version.
- No `.base` files are created or parsed.
- No backend file-kind changes are needed.

The table is a presentation mode for a Saved View, not a new storage model.

---

## Phase 1 — Read-only Table for Saved Views

### 1. Define a transient table target

**File: `src/App.tsx`**

Add state for the Saved View currently opened as a table.

Prefer storing a stable view reference and resolving the latest `ViewFile` from
`vault.views` during render:

```ts
const [tableViewRef, setTableViewRef] = useState<{ filename: string; rootPath?: string } | null>(null)
```

Then derive:

```ts
const tableView = tableViewRef
  ? vault.views.find((view) => viewMatchesSelection(view, { kind: 'view', ...tableViewRef }))
  : null
```

Verified local context:

- `src/utils/viewIdentity.ts` exports `viewMatchesSelection(view, selection)`,
  `viewSelectionForView(view)`, and `viewIdentityKey(view)`.
- `SidebarSelection` for Saved Views is `{ kind: 'view'; filename: string; rootPath?: string }`.
- `App.tsx` already reads `vault.views` in multiple view flows and passes it to
  `Sidebar` and `NoteList`, so it is the correct source for resolving the latest
  `ViewFile`.

This avoids stale definitions and supports duplicate Saved View filenames across
mounted workspaces.

Storing `ViewFile | null` directly is acceptable for a very small first patch,
but the reference-and-resolve shape is safer if view files can be edited,
reloaded, deleted, or duplicated across workspaces.

Only Saved Views should be accepted. The state should be cleared when:

- the active vault changes
- the referenced view is deleted
- the user opens a normal note in the editor area
- the user closes the table surface, if a close action is added

The table should be transient UI state. Do not persist it to the vault in Phase 1.

Normal note-opening paths that should clear the transient table include:

- table row click
- Favorites
- note-list row click
- Quick Open
- wikilink navigation
- history / Pulse note opening
- direct folder-tree file opening
- tab switch (the plan does not use a pseudo-tab, so switching tabs always clears the table)

### 2. Add "Open as Table" to Saved View actions

**Likely files:**

- `src/components/sidebar/SidebarViewItem.tsx`
- `src/components/sidebar/SidebarViewActions.tsx`
- `src/components/sidebar/SidebarSections.tsx`
- `src/components/Sidebar.tsx`
- `src/hooks/useAppCommands.ts`
- `src/hooks/commands/viewCommands.ts` or a dedicated saved-view command module

Add an action that is enabled only when a Saved View is selected or when the user
opens the context menu on a Saved View row.

Behavior:

```ts
onOpenViewAsTable({ filename, rootPath })
```

The action should not affect normal Saved View selection. It should only open the
editor-area table by setting `tableViewRef`.

Command palette label:

```text
Open View as Table
```

Suggested keywords:

```text
view, table, data, columns, properties
```

### 3. Reuse the existing view filter engine

**File: `src/utils/viewFilters.ts`**

Call the existing exported `evaluateView(definition, entries)` directly.

`evaluateView()` already filters by `ViewDefinition.filters` and excludes
archived entries (`!e.archived`). The table follows the same policy: archived
notes are not shown in this read-only table, consistent with current Saved View
note-list behavior.

Do not add a `filterEntriesForViewTable()` wrapper unless table behavior later
diverges from normal Saved View filtering.

Do not add a new filter language.
Do not parse SQL-like or Dataview-like strings.
Do not add `.base` filter parsing.

### 4. Reuse existing sort behavior

**Likely file: `src/utils/noteListHelpers.ts`**

Saved Views already store sort in `ViewDefinition.sort`, and the note list
already parses and applies saved sort options.

The table should use the same sort semantics as the note list:

- If the view has `definition.sort`, use it.
- Otherwise use the same default as the selected Saved View note list.

Prefer extracting existing sort helpers instead of creating a parallel sort
implementation.

### 5. Resolve table columns

**New file: `src/utils/viewTableColumns.ts`**

Build a small column model:

```ts
type ViewTableColumnKind =
  | 'title'
  | 'filename'
  | 'type'
  | 'status'
  | 'modified'
  | 'created'
  | 'property'

interface ViewTableColumn {
  id: string
  label: string
  kind: ViewTableColumnKind
  propertyKey?: string
}
```

Before implementing, verify the exact shape of `ViewDefinition.listPropertiesDisplay`
in `src/types.ts`. If it is a `string[]` of property keys the mapping is direct;
if it is a richer type (with display names or widths) the resolver must unwrap it
to obtain the key before constructing a `ViewTableColumn`.

Initial column rules:

- Always include a primary title/name column.
- Add `type`, `status`, `modified`, and/or `created` only if chosen by the view
  or needed by the design.
- Add `ViewDefinition.listPropertiesDisplay` as property columns.
- If `listPropertiesDisplay` is empty, use a conservative default like
  `title`, `type`, `status`, `modified`.

Keep this deterministic. Do not infer dozens of columns from all properties in
Phase 1.

### 6. Render the table

**New component: `src/components/ViewTable.tsx`**

Props:

```ts
interface ViewTableProps {
  view: ViewFile
  entries: VaultEntry[]
  onSelectNote: (entry: VaultEntry) => void
}
```

Responsibilities:

- Filter entries through the Saved View definition.
- Sort rows using existing sort semantics.
- Resolve columns from `listPropertiesDisplay`.
- Render a full editor-area table.
- Row click opens the note via `onSelectNote(entry)`.
- Empty state: show a restrained message when no notes match.

Rendering guidance:

- Use Tolaria's existing quiet workspace visual language.
- If shadcn `Table` is not already present, either add the shadcn table component
  or use a locally styled semantic table that matches the app.
- Keep the table dense and scannable, not card-based.
- Do not put the table inside a decorative card.
- Keep text truncation predictable for long titles and property values.

### 7. Route editor-area rendering

**File: `src/App.tsx` and/or `src/components/Editor.tsx`**

Add a route for the transient table surface.

Recommended approach:

- Resolve `tableViewRef` to the latest `ViewFile` from `vault.views`.
- Pass `tableView` into `Editor`.
- In `EditorLayout`, render `ViewTable` when `tableView` is present and there is
  no active binary preview requiring priority.
- The right side pane can remain available, but the Properties panel may not have
  an active note unless a row is selected.

Be explicit about priority:

1. Empty state if no active tab and no table view.
2. Binary preview if the active tab is binary.
3. View table if `tableView` is set.
4. Normal editor content.

Alternative:

- Treat the table as a pseudo-tab. This gives it tab behavior, but it is more
  invasive and should not be Phase 1 unless the existing tab model already makes
  it easy.

### 8. Keep note opening behavior clear

When the user clicks a table row:

- Open/switch to the note using the existing note-opening path.
- Clear the transient table view unless the product decision is to keep it open
  while the note opens in another tab.

Recommended Phase 1 behavior:

- Clicking a row opens the note and closes the table surface.
- The `onSelectNote` handler must both open the note via the existing path **and**
  call `setTableViewRef(null)` so the table is cleared before the routing
  priority check re-evaluates.

Also clear `tableViewRef` in the other normal note-opening paths listed in
Phase 1 step 1. The table should not linger when the user navigates to a note by
Favorites, Quick Open, wikilinks, history, folder-tree files, or note-list rows.

This matches the current "editor area shows one main thing" model and avoids
requiring table pseudo-tabs immediately.

---

## Phase 2 — Table Polish

Add table behavior after the first version is stable:

- Column resizing.
- Column order editing.
- Per-view table column persistence.
- Sticky header.
- Keyboard navigation.
- Copy cell / copy row.
- Optional row density setting.
- Summaries:
  - Count
  - Empty
  - Unique
  - Sum for numeric columns

Persistence decision for Phase 2:

- Prefer extending `ViewDefinition` with table-specific fields, for example:
  ```ts
  table?: {
    columns?: string[]
    columnSize?: Record<string, number>
    summaries?: Record<string, 'count' | 'empty' | 'unique' | 'sum'>
  }
  ```
- Store this in the existing Saved View `.yml` file.
- Do not create a new file type.

---

## Phase 3 — View Editing and Formula Columns

Only after table rendering and persistence are stable:

- Add a table configuration panel.
- Reuse `CreateViewDialog` / `FilterBuilder` for filters.
- Add computed columns.

Formula scope should start small:

- Simple aliases, e.g. `hours = Hours`.
- Simple numeric transforms later.
- Avoid a general expression language until there is a concrete use case.

---

## Phase 4 — CSV Export

Add export actions for the currently rendered Saved View table:

- Export the current table rows and visible columns as CSV.
- Copy the generated CSV to the clipboard.
- Keep export scoped to the current table presentation:
  - use the same filtered rows
  - use the same sort order
  - use the same visible table columns
- Do not export hidden properties or unrelated note metadata.
- Escape CSV values according to standard CSV rules:
  - quote values containing commas, quotes, or newlines
  - double embedded quotes
  - preserve empty cells as empty fields
- Include a header row using the visible column labels.
- Do not include note content/body by default.

Suggested UI:

- Add a small toolbar action on the table surface.
- Use separate actions:
  - **Copy CSV**
  - **Export CSV**
- Copy should write the CSV string through the existing clipboard path.
- Export should download/save a `.csv` file named from the Saved View, using a
  portable filename stem.

Suggested telemetry:

```ts
trackEvent('view_table_csv_exported', { row_count, column_count })
trackEvent('view_table_csv_copied', { row_count, column_count })
```

Do not include view names, filenames, property names, filters, note titles, note
paths, note content, or cell values in telemetry.

Suggested tests:

- CSV serialization escapes commas, quotes, and newlines.
- Copy CSV uses the current filtered/sorted rows and visible columns.
- Export CSV uses the current filtered/sorted rows and visible columns.
- Empty table export still includes headers.

---

## Phase 5 — Direct Table Interactions

Add richer table interactions once the saved YAML schema and CSV export are
stable:

- Drag and drop column headers to reorder table columns instead of requiring the
  current arrow controls.
- Persist the resulting order back to `table.columns` in the Saved View `.yml`
  file.
- Add a clickable sort affordance in each column header.
- Clicking a column sort control should cycle through:
  - ascending
  - descending
  - no table-specific sort
- Support date-aware sorting for date columns and date-like frontmatter
  properties.
- Keep sort persistence in the Saved View YAML, using the existing top-level
  `sort` field where possible.
- Do not infer private telemetry fields from column names or cell values.

Suggested tests:

- Dragging a header persists the new `table.columns` order.
- Header sort controls update the saved `sort` value.
- Date columns sort by date value, not lexicographic text.
- Removing table-specific sort returns the view to its default saved-view order.

---

## Files Touched

| File | Change |
|---|---|
| `src/App.tsx` | Transient table-view state and action wiring |
| `src/components/sidebar/SidebarViewItem.tsx` | Pass the "Open as Table" action into the view row menu |
| `src/components/sidebar/SidebarViewActions.tsx` | Add the Saved View context-menu action |
| `src/components/sidebar/SidebarSections.tsx` | Thread the action through normal and sortable view rows |
| `src/components/Sidebar.tsx` | Thread the action from App into the Views section |
| `src/hooks/useAppCommands.ts` | Expose command action when a Saved View is selected |
| `src/hooks/commands/viewCommands.ts` or saved-view command module | Command-palette entry |
| `src/utils/viewFilters.ts` | No new wrapper expected; call existing `evaluateView()` directly |
| `src/utils/noteListHelpers.ts` | Reuse/extract sort helpers if needed |
| `src/utils/viewTableColumns.ts` *(new)* | Resolve table columns |
| `src/components/ViewTable.tsx` *(new)* | Render Saved View as table |
| `src/components/Editor.tsx` | Route transient table surface |
| `src/components/ViewTable.test.tsx` *(new)* | Table rendering and row click tests |
| `src/utils/viewTableColumns.test.ts` *(new)* | Column resolution tests |
| `src/lib/locales/en.json` | Add UI copy strings (see Localization below) |

---

## Localization

All user-facing strings must live in `src/lib/locales/en.json`. Run
`pnpm l10n:translate` after adding them and verify `pnpm l10n:validate` passes.

Strings introduced by Phase 1:

| Key (suggested) | Value |
|---|---|
| `commands.openViewAsTable.label` | `Open View as Table` |
| `viewTable.emptyState` | `No notes match this view's filters.` |

---

## PostHog

Emit a `view_opened_as_table` event when the user triggers "Open as Table".
Safe metadata to include:

```ts
trackEvent('view_opened_as_table', { row_count: filteredEntries.length })
```

Use Tolaria's existing telemetry wrapper (`trackEvent` from `src/lib/telemetry.ts`)
or a small helper in `src/lib/productAnalytics.ts`. Do not call PostHog directly.

Do not include the view name, view ID, root path, workspace name, filter details,
or any note content — these may contain user data. `row_count` is sufficient to
evaluate adoption and filter health.

---

## Performance

Clearing `tableViewRef` on every note-open path has no cost — React bails out
when `setTableViewRef(null)` is called and the state is already `null`.

Keep the table-specific work inside `ViewTable.tsx`, not `App.tsx`. `App.tsx`
should only resolve the current `ViewFile`; filtering, sorting, column
resolution, and cell derivation should run only while the table is actually
mounted.

The implementation needs explicit memoization in these places:

**`App.tsx` — memoize the view lookup**

The `vault.views.find()` derivation runs on every render of `App.tsx`, including
editor keystrokes:

```ts
const tableView = useMemo(
  () => tableViewRef
    ? vault.views.find((view) => viewMatchesSelection(view, { kind: 'view', ...tableViewRef }))
    : null,
  [tableViewRef, vault.views],
)
```

**`ViewTable.tsx` — memoize filtered and sorted entries**

`evaluateView()` walks the full entry list on every render. For vaults with
thousands of notes this is expensive if `ViewTable` re-renders on unrelated
state changes:

```ts
const filteredEntries = useMemo(
  () => evaluateView(view.definition, entries),
  [view.definition, entries],
)

const sortedEntries = useMemo(
  () => applySavedViewSort(filteredEntries, view.definition.sort),
  [filteredEntries, view.definition.sort],
)
```

Replace `applySavedViewSort` with whatever sort helper is extracted from
`noteListHelpers.ts` in step 4.

**`ViewTable.tsx` — memoize columns and row models**

Resolve configured display properties once per view definition. Do not rebuild
column definitions inside each row render.

```ts
const columns = useMemo(
  () => resolveViewTableColumns(view.definition.listPropertiesDisplay),
  [view.definition.listPropertiesDisplay],
)
```

If cell value extraction is non-trivial, build a memoized row model from
`sortedEntries` and `columns` so rendering does not repeatedly resolve the same
frontmatter fields during React reconciliation:

```ts
const rows = useMemo(
  () => buildViewTableRows(sortedEntries, columns),
  [sortedEntries, columns],
)
```

Phase 1 should render only the resolved visible columns. Do not compute values
for hidden properties.

Virtualization is not required for Phase 1, but keep the table structure
compatible with adding it later. Use the `row_count` telemetry to decide whether
real saved views regularly exceed a few hundred rows; if they do, add row
virtualization before adding richer table interactions.

---

## Verification

```bash
pnpm test -- --testPathPattern="ViewTable|viewTableColumns"
npx tsc --noEmit
```

Manual checks:

1. Create or select a Saved View.
2. Run "Open View as Table" from the command palette or Saved View context menu.
3. Verify the editor area shows a table of matching notes.
4. Verify filters match the normal Saved View note-list result.
5. Verify sort order matches the normal Saved View note-list result.
6. Verify configured visible properties become columns.
7. Click a row and verify the note opens through the existing note path.
8. Switch to another normal note and verify the transient table closes.

Playwright smoke is optional for Phase 1 unless this becomes a core pre-push
workflow. A focused component/integration test should be enough for the first
read-only version.
