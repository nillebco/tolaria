import { memo, useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { FileText, Smiley, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { isIconUrl } from '../../hooks/useVaultIcons'
import type { VaultEntry } from '../../types'
import { FOLDER_TREE_FILE_DRAG_TYPE } from './folderTreeFileDrag'

interface FileItemRowProps {
  entry: VaultEntry
  depthIndent: number
  isActive: boolean
  icon?: string
  showOriginalFilename?: boolean
  relativePath: string
  onSelect: (entry: VaultEntry) => void
  onOpenIconPicker?: (relativePath: string, x: number, y: number) => void
  onRemoveIcon?: (relativePath: string) => void
}

export const FileItemRow = memo(function FileItemRow({
  entry,
  depthIndent,
  isActive,
  icon,
  showOriginalFilename = false,
  relativePath,
  onSelect,
  onOpenIconPicker,
  onRemoveIcon,
}: FileItemRowProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const displayName = showOriginalFilename ? entry.filename : (entry.title || entry.filename)

  const closeMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu()
    }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [closeMenu, contextMenu])

  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    if (!onOpenIconPicker && !onRemoveIcon) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [onOpenIconPicker, onRemoveIcon])

  const handleDragStart = useCallback((event: ReactDragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(FOLDER_TREE_FILE_DRAG_TYPE, JSON.stringify({ path: entry.path }))
    event.dataTransfer.setData('text/plain', entry.path)
  }, [entry.path])

  return (
    <>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors',
          isActive
            ? 'bg-[var(--accent-blue-light)] text-primary'
            : 'text-foreground hover:bg-accent',
        )}
        style={{ paddingLeft: depthIndent + 8 }}
        title={entry.path}
        onClick={() => onSelect(entry)}
        onContextMenu={handleContextMenu}
        draggable={true}
        onDragStart={handleDragStart}
        data-testid={`file-row:${entry.path}`}
      >
        {icon ? (
          isIconUrl(icon)
            ? <img src={icon} className="size-[14px] shrink-0 object-contain" alt="" />
            : <span className="size-[14px] shrink-0 text-center text-sm leading-none">{icon}</span>
        ) : (
          <FileText size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{displayName}</span>
      </button>
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 160 }}
        >
          {onOpenIconPicker && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
              onClick={() => { closeMenu(); onOpenIconPicker(relativePath, contextMenu.x, contextMenu.y) }}
            >
              <Smiley size={14} />
              Set icon…
            </Button>
          )}
          {icon && onRemoveIcon && (
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
              onClick={() => { closeMenu(); onRemoveIcon(relativePath) }}
            >
              <X size={14} />
              Remove icon
            </Button>
          )}
        </div>
      )}
    </>
  )
})
