import type { FolderNode, VaultEntry } from '../../types'

const filenameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
})

const isoDatePrefixPattern = /^(\d{4})-(\d{2})-(\d{2})(?:\b|[_\-. ])/

function basename(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash >= 0 ? path.substring(lastSlash + 1) : path
}

function isoDatePrefix(value: string): string | null {
  const match = basename(value).match(isoDatePrefixPattern)
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const isValidCalendarDate =
    date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)

  return isValidCalendarDate ? `${year}-${month}-${day}` : null
}

function compareNames(left: string, right: string): number {
  const leftDate = isoDatePrefix(left)
  const rightDate = isoDatePrefix(right)

  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1
  }

  const nameComparison = filenameCollator.compare(basename(left), basename(right))
  if (nameComparison !== 0) return nameComparison

  return filenameCollator.compare(left, right)
}

export function compareFileTreeEntries(left: VaultEntry, right: VaultEntry): number {
  return compareNames(left.filename || left.path, right.filename || right.path)
    || compareNames(left.path, right.path)
}

export function sortFileTreeEntries(entries: VaultEntry[]): VaultEntry[] {
  return [...entries].sort(compareFileTreeEntries)
}

export function sortFolderNodes(folders: FolderNode[]): FolderNode[] {
  return [...folders]
    .sort((left, right) => compareNames(left.name || left.path, right.name || right.path))
    .map((folder) => ({
      ...folder,
      children: sortFolderNodes(folder.children),
    }))
}
