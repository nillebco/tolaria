import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Plus,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { FolderNode, SidebarSelection, VaultEntry } from '../types'
import { EmojiPicker } from './EmojiPicker'
import { FolderContextMenu } from './folder-tree/FolderContextMenu'
import { FolderNameInput } from './folder-tree/FolderNameInput'
import { FolderTreeRow } from './folder-tree/FolderTreeRow'
import { FileItemRow } from './folder-tree/FileItemRow'
import { sortFileTreeEntries } from './folder-tree/fileTreeSort'
import { REQUEST_CREATE_FOLDER_EVENT } from './folder-tree/folderTreeEvents'
import { folderNodeKey } from './folder-tree/folderTreeUtils'
import { useFolderContextMenu } from './folder-tree/useFolderContextMenu'
import { useFolderTreeDisclosure } from './folder-tree/useFolderTreeDisclosure'
import { SidebarGroupHeader } from './sidebar/SidebarGroupHeader'
import { translate, type AppLocale } from '../lib/i18n'
import type { FolderFileActions } from '../hooks/useFileActions'

interface FolderTreeProps {
  folders: FolderNode[]
  entries?: VaultEntry[]
  activeNotePath?: string
  vaultPath?: string
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onSelectNote?: (entry: VaultEntry) => void
  onCreateFolder?: (name: string, parentPath?: string) => Promise<boolean> | boolean
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  renamingFolderPath?: string | null
  onStartRenameFolder?: (folderPath: string) => void
  onCancelRenameFolder?: () => void
  collapsed?: boolean
  locale?: AppLocale
  onToggle?: () => void
  vaultRootPath?: string
  icons?: Record<string, string>
  showOriginalFilenames?: boolean
  onSetPathIcon?: (relativePath: string, emoji: string | null) => void
}

interface FolderTreeBodyProps extends Pick<
  FolderTreeProps,
  | 'locale'
  | 'onCancelRenameFolder'
  | 'onDeleteFolder'
  | 'onRenameFolder'
  | 'onSelect'
  | 'onSelectNote'
  | 'onStartRenameFolder'
  | 'renamingFolderPath'
  | 'selection'
> {
  activeNotePath?: string
  entries: VaultEntry[]
  displayedExpanded: Record<string, boolean>
  displayedFolders: FolderNode[]
  icons: Record<string, string>
  isCreating: boolean
  creatingFolderParentPath: string | null
  onCancelCreateFolder: () => void
  onCreateFolderSubmit: (value: string) => Promise<boolean>
  onOpenIconPicker: (relativePath: string, x: number, y: number) => void
  rootFiles: VaultEntry[]
  rootPath?: string
  sectionCollapsed: boolean
  showOriginalFilenames: boolean
  toggleFolder: (path: string) => void
  vaultPath?: string
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onRemoveIcon?: (relativePath: string) => void
}

function vaultRootLabel(vaultRootPath: string, locale: AppLocale): string {
  const trimmed = vaultRootPath.trim().replace(/[\\/]+$/g, '')
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || translate(locale, 'status.vault.default')
}

function buildRootNode(folders: FolderNode[], vaultRootPath: string | undefined, locale: AppLocale): FolderNode | null {
  if (!vaultRootPath?.trim()) return null
  return {
    name: vaultRootLabel(vaultRootPath, locale),
    path: '',
    rootPath: vaultRootPath,
    children: folders,
  }
}

function useDisplayedFolders(folders: FolderNode[], expanded: Record<string, boolean>, vaultRootPath: string | undefined, locale: AppLocale) {
  return useMemo(() => {
    if (folders.some((folder) => folder.rootPath)) {
      const expandedRoots = Object.fromEntries(
        folders
          .filter((folder) => folder.path === '' && folder.rootPath)
          .map((folder) => [folderNodeKey(folder), true]),
      )
      return {
        displayedExpanded: { ...expandedRoots, ...expanded },
        displayedFolders: folders,
      }
    }
    const rootNode = buildRootNode(folders, vaultRootPath, locale)
    return {
      displayedExpanded: rootNode ? { [folderNodeKey(rootNode)]: true, ...expanded } : expanded,
      displayedFolders: rootNode ? [rootNode] : folders,
    }
  }, [expanded, folders, locale, vaultRootPath])
}

function entryRelativePath(entry: VaultEntry, vaultPath?: string): string {
  return vaultPath && entry.path.startsWith(`${vaultPath}/`)
    ? entry.path.slice(vaultPath.length + 1)
    : entry.path
}

function entryParentPath(entry: VaultEntry, vaultPath?: string): string {
  const relativePath = entryRelativePath(entry, vaultPath)
  const lastSlash = relativePath.lastIndexOf('/')
  return lastSlash >= 0 ? relativePath.slice(0, lastSlash) : ''
}

function collectFolderPaths(folders: FolderNode[]): Set<string> {
  const paths = new Set<string>()
  for (const folder of folders) {
    paths.add(folder.path)
    for (const childPath of collectFolderPaths(folder.children)) paths.add(childPath)
  }
  return paths
}

function isRootFile(entry: VaultEntry, folders: FolderNode[], vaultPath?: string): boolean {
  const folderPaths = collectFolderPaths(folders)
  return !folderPaths.has(entryParentPath(entry, vaultPath))
}

export const FolderTree = memo(function FolderTree({
  folders,
  entries = [],
  activeNotePath,
  vaultPath,
  selection,
  onSelect,
  onSelectNote,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderFileActions,
  renamingFolderPath,
  onStartRenameFolder,
  onCancelRenameFolder,
  collapsed: externalCollapsed,
  locale = 'en',
  onToggle,
  vaultRootPath,
  icons = {},
  showOriginalFilenames = false,
  onSetPathIcon,
}: FolderTreeProps) {
  const [iconPickerState, setIconPickerState] = useState<{ relativePath: string; x: number; y: number } | null>(null)
  const [creatingFolderParentPath, setCreatingFolderParentPath] = useState<string | null>(null)
  const {
    closeCreateForm,
    expandFolder,
    expanded,
    handleToggleSection,
    isCreating,
    openCreateForm,
    sectionCollapsed,
    toggleFolder,
  } = useFolderTreeDisclosure({
    collapsed: externalCollapsed,
    onToggle,
    renamingFolderPath,
    selection,
  })
  const openRootCreateForm = useCallback(() => {
    setCreatingFolderParentPath(null)
    openCreateForm()
  }, [openCreateForm])

  useEffect(() => {
    const handleRequestCreateFolder = () => {
      if (onCreateFolder) openRootCreateForm()
    }

    window.addEventListener(REQUEST_CREATE_FOLDER_EVENT, handleRequestCreateFolder)
    return () => window.removeEventListener(REQUEST_CREATE_FOLDER_EVENT, handleRequestCreateFolder)
  }, [onCreateFolder, openRootCreateForm])
  const {
    closeContextMenu,
    contextMenu,
    handleCopyPathFromMenu,
    handleDeleteFromMenu,
    handleCreateChildFromMenu,
    handleOpenMenu,
    handleRevealFromMenu,
    handleRenameFromMenu,
    menuRef,
  } = useFolderContextMenu({
    onCreateFolderInside: (folderPath) => {
      setCreatingFolderParentPath(folderPath)
      expandFolder(folderPath)
      openCreateForm()
    },
    onDeleteFolder,
    folderFileActions,
    onStartRenameFolder,
  })

  const handleOpenIconPicker = useCallback((relativePath: string, x: number, y: number) => {
    setIconPickerState({ relativePath, x, y })
  }, [])

  const handleSetIconFromMenu = useCallback((path: string, x: number, y: number) => {
    closeContextMenu()
    setIconPickerState({ relativePath: path, x, y })
  }, [closeContextMenu])

  const handleRemoveIcon = useCallback((relativePath: string) => {
    onSetPathIcon?.(relativePath, null)
  }, [onSetPathIcon])

  const handleSelectEmoji = useCallback((emoji: string) => {
    if (!iconPickerState) return
    onSetPathIcon?.(iconPickerState.relativePath, emoji)
    setIconPickerState(null)
  }, [iconPickerState, onSetPathIcon])

  const handleCreateFolderSubmit = useCallback(async (value: string) => {
    const nextName = value.trim()
    if (!nextName || !onCreateFolder) {
      closeCreateForm()
      return true
    }

    const created = await onCreateFolder(nextName, creatingFolderParentPath ?? undefined)
    if (created) {
      setCreatingFolderParentPath(null)
      closeCreateForm()
    }
    return created
  }, [closeCreateForm, creatingFolderParentPath, onCreateFolder])

  const handleCreateFolderClick = useCallback(() => {
    closeContextMenu()
    openRootCreateForm()
  }, [closeContextMenu, openRootCreateForm])

  const { displayedExpanded, displayedFolders } = useDisplayedFolders(folders, expanded, vaultRootPath, locale)
  const rootFiles = useMemo(() => sortFileTreeEntries(entries.filter((entry) => isRootFile(entry, displayedFolders, vaultPath))), [displayedFolders, entries, vaultPath])

  if (displayedFolders.length === 0 && rootFiles.length === 0 && !isCreating) return null

  return (
    <div className="border-b border-border" style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={translate(locale, 'sidebar.group.folders')} collapsed={sectionCollapsed} onToggle={handleToggleSection}>
        {onCreateFolder && (
          <CreateFolderButton locale={locale} onCreate={handleCreateFolderClick} />
        )}
      </SidebarGroupHeader>
      <FolderTreeBody
        displayedExpanded={displayedExpanded}
        displayedFolders={displayedFolders}
        creatingFolderParentPath={creatingFolderParentPath}
        entries={entries}
        activeNotePath={activeNotePath}
        vaultPath={vaultPath}
        icons={icons}
        isCreating={isCreating}
        locale={locale}
        onCancelCreateFolder={() => {
          setCreatingFolderParentPath(null)
          closeCreateForm()
        }}
        onCancelRenameFolder={onCancelRenameFolder}
        onCreateFolderSubmit={handleCreateFolderSubmit}
        onDeleteFolder={onDeleteFolder}
        onOpenIconPicker={handleOpenIconPicker}
        onOpenMenu={handleOpenMenu}
        onRemoveIcon={handleRemoveIcon}
        onRenameFolder={onRenameFolder}
        onSelect={onSelect}
        onSelectNote={onSelectNote}
        onStartRenameFolder={onStartRenameFolder}
        renamingFolderPath={renamingFolderPath}
        rootPath={vaultRootPath}
        rootFiles={rootFiles}
        sectionCollapsed={sectionCollapsed}
        selection={selection}
        showOriginalFilenames={showOriginalFilenames}
        toggleFolder={toggleFolder}
      />
      <FolderContextMenu
        menu={contextMenu}
        menuRef={menuRef}
        onCreateChild={onCreateFolder ? handleCreateChildFromMenu : undefined}
        onDelete={handleDeleteFromMenu}
        onReveal={handleRevealFromMenu}
        onCopyPath={handleCopyPathFromMenu}
        onRename={handleRenameFromMenu}
        onSetIcon={onSetPathIcon ? handleSetIconFromMenu : undefined}
        onRemoveIcon={onSetPathIcon ? handleRemoveIcon : undefined}
        hasIcon={!!(contextMenu && icons[contextMenu.path])}
        locale={locale}
      />
      {iconPickerState && (
        <div style={{ position: 'fixed', left: iconPickerState.x - 54, top: iconPickerState.y, zIndex: 100 }}>
          <EmojiPicker onSelect={handleSelectEmoji} onClose={() => setIconPickerState(null)} />
        </div>
      )}
    </div>
  )
})

function FolderTreeBody({
  activeNotePath,
  creatingFolderParentPath,
  displayedExpanded,
  displayedFolders,
  entries,
  icons,
  isCreating,
  locale = 'en',
  onCancelCreateFolder,
  onCancelRenameFolder,
  onCreateFolderSubmit,
  onDeleteFolder,
  onOpenIconPicker,
  onOpenMenu,
  onRemoveIcon,
  onRenameFolder,
  onSelect,
  onSelectNote,
  onStartRenameFolder,
  renamingFolderPath,
  rootPath,
  rootFiles,
  sectionCollapsed,
  selection,
  showOriginalFilenames,
  toggleFolder,
  vaultPath,
}: FolderTreeBodyProps) {
  if (sectionCollapsed) return null

  return (
    <div className="flex flex-col gap-0.5 pb-2">
      {displayedFolders.map((node) => (
        <FolderTreeRow
          key={folderNodeKey(node)}
          depth={0}
          entries={entries}
          expanded={displayedExpanded}
          node={node}
          activeNotePath={activeNotePath}
          vaultPath={vaultPath}
          icons={icons}
          showOriginalFilenames={showOriginalFilenames}
          onDeleteFolder={onDeleteFolder}
          onOpenMenu={onOpenMenu}
          onRenameFolder={onRenameFolder}
          onSelect={onSelect}
          onSelectNote={onSelectNote}
          onOpenIconPicker={onOpenIconPicker}
          onRemoveIcon={onRemoveIcon}
          creatingFolderParentPath={creatingFolderParentPath}
          isCreatingFolder={isCreating}
          onCancelCreateFolder={onCancelCreateFolder}
          onCreateFolderSubmit={onCreateFolderSubmit}
          onStartRenameFolder={onStartRenameFolder}
          onToggle={toggleFolder}
          onCancelRenameFolder={onCancelRenameFolder}
          locale={locale}
          renamingFolderPath={renamingFolderPath}
          rootPath={rootPath}
          selection={selection}
        />
      ))}
      {rootFiles.map((entry) => {
        const relativePath = entryRelativePath(entry, vaultPath)
        return (
          <FileItemRow
            key={entry.path}
            entry={entry}
            depthIndent={8}
            isActive={entry.path === activeNotePath}
            icon={icons[relativePath]}
            showOriginalFilename={showOriginalFilenames}
            relativePath={relativePath}
            onSelect={(selected) => onSelectNote?.(selected)}
            onOpenIconPicker={onOpenIconPicker}
            onRemoveIcon={onRemoveIcon}
          />
        )
      })}
      {isCreating && creatingFolderParentPath === null && (
        <div style={{ paddingLeft: 8 }}>
          <FolderNameInput
            ariaLabel={translate(locale, 'sidebar.folder.newName')}
            initialValue=""
            placeholder={translate(locale, 'sidebar.folder.name')}
            submitOnBlur={true}
            testId="new-folder-input"
            onCancel={onCancelCreateFolder}
            onSubmit={onCreateFolderSubmit}
          />
        </div>
      )}
    </div>
  )
}

function CreateFolderButton({
  locale,
  onCreate,
}: {
  locale: AppLocale
  onCreate: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      data-testid="create-folder-btn"
      title={translate(locale, 'sidebar.action.createFolder')}
      aria-label={translate(locale, 'sidebar.action.createFolder')}
      onClick={(event) => {
        event.stopPropagation()
        onCreate()
      }}
    >
      <Plus size={12} className="text-muted-foreground hover:text-foreground" />
    </Button>
  )
}
