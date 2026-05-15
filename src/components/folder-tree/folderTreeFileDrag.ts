export const FOLDER_TREE_FILE_DRAG_TYPE = 'application/x-tolaria-folder-tree-file'

export interface FolderTreeFileDragData {
  path: string
}

export function parseFolderTreeFileDrag(dataTransfer: DataTransfer): FolderTreeFileDragData | null {
  const raw = dataTransfer.getData(FOLDER_TREE_FILE_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<FolderTreeFileDragData>
    return typeof parsed.path === 'string' && parsed.path.length > 0
      ? { path: parsed.path }
      : null
  } catch {
    return null
  }
}
