import { useCallback, useState, type DragEvent } from 'react'
import { X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { NoteTitleIcon } from './NoteTitleIcon'
import { useDragRegion } from '../hooks/useDragRegion'
import type { VaultEntry } from '../types'

const TAB_DRAG_MIME = 'application/x-tolaria-tab-path'

interface Tab {
  entry: VaultEntry
  content: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTabPath: string | null
  onSwitchTab: (path: string) => void
  onCloseTab: (path: string) => void
  onReorderTabs?: (sourcePath: string, targetPath: string) => void
  unsavedPaths?: Set<string>
}

export function TabBar({ tabs, activeTabPath, onSwitchTab, onCloseTab, onReorderTabs, unsavedPaths }: TabBarProps) {
  const { onMouseDown } = useDragRegion()
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, path: string) => {
    if (!onReorderTabs) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TAB_DRAG_MIME, path)
    setDraggedPath(path)
  }, [onReorderTabs])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>, path: string) => {
    if (!onReorderTabs || !draggedPath || draggedPath === path) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverPath(path)
  }, [draggedPath, onReorderTabs])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>, targetPath: string) => {
    if (!onReorderTabs) return
    event.preventDefault()
    const sourcePath = event.dataTransfer.getData(TAB_DRAG_MIME) || draggedPath
    if (sourcePath && sourcePath !== targetPath) {
      onReorderTabs(sourcePath, targetPath)
    }
    setDraggedPath(null)
    setDragOverPath(null)
  }, [draggedPath, onReorderTabs])

  const clearDragState = useCallback(() => {
    setDraggedPath(null)
    setDragOverPath(null)
  }, [])

  return (
    <div className="tab-bar flex shrink-0 border-b border-border bg-muted/30 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {tabs.map(tab => {
        const isActive = tab.entry.path === activeTabPath
        const isUnsaved = unsavedPaths?.has(tab.entry.path) ?? false
        const isDragged = draggedPath === tab.entry.path
        const isDropTarget = dragOverPath === tab.entry.path
        return (
          <div
            key={tab.entry.path}
            role="tab"
            aria-selected={isActive}
            draggable={onReorderTabs ? true : undefined}
            className={cn(
              'tab-bar__tab group flex items-center gap-1.5 px-3 shrink-0 max-w-52 min-w-0 cursor-pointer select-none border-r border-border',
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/60',
              isDragged && 'opacity-60',
              isDropTarget && 'bg-accent text-accent-foreground'
            )}
            style={{ height: 36 }}
            onClick={() => onSwitchTab(tab.entry.path)}
            onDragStart={(event) => handleDragStart(event, tab.entry.path)}
            onDragOver={(event) => handleDragOver(event, tab.entry.path)}
            onDragLeave={() => setDragOverPath((current) => current === tab.entry.path ? null : current)}
            onDrop={(event) => handleDrop(event, tab.entry.path)}
            onDragEnd={clearDragState}
          >
            <NoteTitleIcon icon={tab.entry.icon} size={13} className="shrink-0" />
            <span className="truncate min-w-0 flex-1 text-sm">
              {tab.entry.title || tab.entry.filename}
            </span>
            {isUnsaved && (
              <span
                className="tab-bar__unsaved-dot w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0 group-hover:hidden"
                aria-label="unsaved"
              />
            )}
            <button
              className={cn(
                'tab-bar__close shrink-0 flex items-center justify-center rounded-sm p-0.5',
                'text-muted-foreground hover:text-foreground hover:bg-muted',
                isUnsaved
                  ? 'hidden group-hover:flex'
                  : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              )}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.entry.path) }}
              onDragStart={(e) => { e.stopPropagation() }}
              draggable={false}
              aria-label={`Close ${tab.entry.title || tab.entry.filename}`}
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        )
      })}
      <div
        className="flex-1 min-w-4"
        data-tauri-drag-region
        onMouseDown={onMouseDown}
        aria-hidden="true"
      />
    </div>
  )
}
