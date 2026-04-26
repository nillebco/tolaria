import { useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import type { FolderNode } from '../../types'
import type { FolderFileActions } from '../../hooks/useFileActions'
import { useSidebarContextMenu } from '../sidebar/sidebarHooks'

interface UseFolderContextMenuInput {
  onCreateFolderInside?: (folderPath: string) => void
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  onStartRenameFolder?: (folderPath: string) => void
}

export function useFolderContextMenu({
  onCreateFolderInside,
  onDeleteFolder,
  folderFileActions,
  onStartRenameFolder,
}: UseFolderContextMenuInput) {
  const {
    closeContextMenu,
    contextMenu,
    contextMenuRef,
    openContextMenuFromPointer,
  } = useSidebarContextMenu<string>()

  const handleOpenMenu = useCallback((node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => {
    openContextMenuFromPointer(node.path, event)
  }, [openContextMenuFromPointer])

  const handleRenameFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    onStartRenameFolder?.(folderPath)
  }, [closeContextMenu, onStartRenameFolder])

  const handleDeleteFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    onDeleteFolder?.(folderPath)
  }, [closeContextMenu, onDeleteFolder])

  const handleCreateChildFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    onCreateFolderInside?.(folderPath)
  }, [closeContextMenu, onCreateFolderInside])

  const handleRevealFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    folderFileActions?.revealFolder(folderPath)
  }, [closeContextMenu, folderFileActions])

  const handleCopyPathFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    folderFileActions?.copyFolderPath(folderPath)
  }, [closeContextMenu, folderFileActions])
  const menu = contextMenu ? {
    path: contextMenu.target,
    x: contextMenu.pos.x,
    y: contextMenu.pos.y,
  } : null

  return {
    closeContextMenu,
    contextMenu: menu,
    handleCopyPathFromMenu,
    handleCreateChildFromMenu,
    handleDeleteFromMenu,
    handleOpenMenu,
    handleRevealFromMenu,
    handleRenameFromMenu,
    menuRef: contextMenuRef,
  }
}
