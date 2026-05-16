import type { VaultEntry, ViewFile } from '../types'
import { notePathsMatch } from './notePathIdentity'

export const VIEW_TAB_PREFIX = 'view:'

function encodeViewTabPart(value: string): string {
  return encodeURIComponent(value)
}

function decodeViewTabPart(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function viewTabPath(view: ViewFile): string {
  return `${VIEW_TAB_PREFIX}${encodeViewTabPart(view.rootPath ?? '')}:${encodeViewTabPart(view.filename)}`
}

export function isViewTabPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(VIEW_TAB_PREFIX)
}

export function tabPathsMatch(leftPath: string | null | undefined, rightPath: string | null | undefined): boolean {
  if (!leftPath || !rightPath) return false
  if (isViewTabPath(leftPath) || isViewTabPath(rightPath)) return leftPath === rightPath
  return notePathsMatch(leftPath, rightPath)
}

export function parseViewTabPath(path: string | null | undefined): { filename: string; rootPath?: string } | null {
  if (typeof path !== 'string' || !isViewTabPath(path)) return null
  const viewPath: string = path
  const payload = viewPath.slice(VIEW_TAB_PREFIX.length)
  const separatorIndex = payload.indexOf(':')
  if (separatorIndex < 0) return null

  const rootPath = decodeViewTabPart(payload.slice(0, separatorIndex))
  const filename = decodeViewTabPart(payload.slice(separatorIndex + 1))
  if (rootPath === null || !filename) return null
  return rootPath ? { filename, rootPath } : { filename }
}

export function viewFromTabPath(path: string | null | undefined, views: readonly ViewFile[]): ViewFile | null {
  const parsed = parseViewTabPath(path)
  if (!parsed) return null
  return views.find((view) => view.filename === parsed.filename && (view.rootPath ?? '') === (parsed.rootPath ?? '')) ?? null
}

export function viewTabEntry(view: ViewFile): VaultEntry {
  return {
    path: viewTabPath(view),
    filename: view.filename,
    title: view.definition.name,
    workspace: view.workspace,
    isA: 'View',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 0,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: view.definition.icon ?? null,
    color: view.definition.color ?? null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: true,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: false,
    fileKind: 'text',
  }
}
