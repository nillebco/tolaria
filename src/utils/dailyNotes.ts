import { format } from 'date-fns'
import type { VaultEntry } from '../types'

export interface DailyNotesConfig {
  folder?: string
  format?: string
}

const DEFAULT_DAILY_NOTE_FORMAT = 'YYYY-MM-DD'

const MOMENT_TO_DATE_FNS_TOKENS: Array<[string, string]> = [
  ['YYYY', 'yyyy'],
  ['YY', 'yy'],
  ['MMMM', 'MMMM'],
  ['MMM', 'MMM'],
  ['MM', 'MM'],
  ['M', 'M'],
  ['DD', 'dd'],
  ['D', 'd'],
  ['dddd', 'EEEE'],
  ['ddd', 'EEE'],
]

function escapeDateFnsLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function translateMomentFormat(momentFormat: string): string {
  let result = ''
  let index = 0

  while (index < momentFormat.length) {
    if (momentFormat[index] === '[') {
      const end = momentFormat.indexOf(']', index + 1)
      if (end >= 0) {
        result += escapeDateFnsLiteral(momentFormat.slice(index + 1, end))
        index = end + 1
        continue
      }
    }

    const token = MOMENT_TO_DATE_FNS_TOKENS.find(([momentToken]) => (
      momentFormat.startsWith(momentToken, index)
    ))
    if (token) {
      result += token[1]
      index += token[0].length
      continue
    }

    result += momentFormat[index]
    index += 1
  }

  return result
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}

function ensureMarkdownExtension(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

export function parseDailyNotesConfig(raw: string | null): DailyNotesConfig {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      folder: typeof parsed.folder === 'string' ? parsed.folder : undefined,
      format: typeof parsed.format === 'string' ? parsed.format : undefined,
    }
  } catch {
    return {}
  }
}

export function dailyNoteRelativePath(config: DailyNotesConfig, date: Date): string {
  const noteFormat = config.format?.trim() || DEFAULT_DAILY_NOTE_FORMAT
  const formattedPath = format(date, translateMomentFormat(noteFormat))
  const folder = trimSlashes(config.folder?.trim() ?? '')
  const relativePath = folder ? `${folder}/${trimSlashes(formattedPath)}` : trimSlashes(formattedPath)
  return ensureMarkdownExtension(relativePath)
}

export function dailyNoteAbsolutePath(vaultPath: string, relativePath: string): string {
  return `${vaultPath.replace(/\/+$/g, '')}/${trimSlashes(relativePath)}`
}

export function findDailyNoteEntry(entries: VaultEntry[], absolutePath: string): VaultEntry | undefined {
  return entries.find((entry) => entry.path === absolutePath)
}

export function dailyNoteHeading(date: Date): string {
  return format(date, 'EEEE, MMMM d, yyyy')
}

export function buildDailyNoteContent(date: Date): string {
  return `---\ntype: Note\n---\n\n# ${dailyNoteHeading(date)}\n`
}

export function buildDailyNoteEntry(absolutePath: string, date: Date): VaultEntry {
  const now = Math.floor(Date.now() / 1000)
  const filename = absolutePath.split('/').pop() ?? 'daily.md'
  const title = filename.replace(/\.md$/i, '').replace(/-/g, ' ')
  return {
    path: absolutePath,
    filename,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: now,
    createdAt: now,
    fileSize: 0,
    snippet: dailyNoteHeading(date),
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    outgoingLinks: [],
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    properties: {},
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    hasH1: true,
  }
}
