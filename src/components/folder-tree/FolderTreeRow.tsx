import { memo, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import type { FolderNode, SidebarSelection, VaultEntry } from '../../types'
import { FolderNameInput } from './FolderNameInput'
import { FolderItemRow } from './FolderItemRow'
import { FileItemRow } from './FileItemRow'
import { FOLDER_ROW_CONTENT_INSET, getFolderConnectorLeft, getFolderDepthIndent } from './folderTreeLayout'
import { folderNodeKey } from './folderTreeUtils'
import { sortFileTreeEntries, sortFolderNodes } from './fileTreeSort'
import { translate, type AppLocale } from '../../lib/i18n'

interface FolderTreeRowProps {
  depth: number
  entries: VaultEntry[]
  expanded: Record<string, boolean>
  node: FolderNode
  activeNotePath?: string
  vaultPath?: string
  icons?: Record<string, string>
  showOriginalFilenames?: boolean
  onDeleteFolder?: (folderPath: string) => void
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onSelect: (selection: SidebarSelection) => void
  onSelectNote?: (entry: VaultEntry) => void
  onOpenIconPicker?: (relativePath: string, x: number, y: number) => void
  onRemoveIcon?: (relativePath: string) => void
  onMoveFileToFolder?: (filePath: string, folderPath: string, rootPath?: string) => void
  creatingFolderParentPath?: string | null
  isCreatingFolder?: boolean
  onCancelCreateFolder?: () => void
  onCreateFolderSubmit?: (value: string) => Promise<boolean> | boolean
  onStartRenameFolder?: (folderPath: string) => void
  onToggle: (path: string) => void
  onCancelRenameFolder?: () => void
  locale?: AppLocale
  renamingFolderPath?: string | null
  rootPath?: string
  selection: SidebarSelection
}

function FolderRenameRow({
  contentInset,
  depthIndent,
  node,
  locale,
  onCancelRenameFolder,
  onRenameFolder,
}: {
  contentInset: number
  depthIndent: number
  node: FolderNode
  locale: AppLocale
  onCancelRenameFolder: () => void
  onRenameFolder: (folderPath: string, nextName: string) => Promise<boolean> | boolean
}) {
  return (
    <div style={{ paddingLeft: depthIndent }}>
      <FolderNameInput
        ariaLabel={translate(locale, 'sidebar.folder.name')}
        initialValue={node.name}
        placeholder={translate(locale, 'sidebar.folder.name')}
        leftInset={contentInset}
        selectTextOnFocus={true}
        testId="rename-folder-input"
        onCancel={onCancelRenameFolder}
        onSubmit={(nextName) => onRenameFolder(node.path, nextName)}
      />
    </div>
  )
}

function FolderChildren({
  depth,
  entries,
  expanded,
  node,
  activeNotePath,
  vaultPath,
  icons,
  showOriginalFilenames,
  onDeleteFolder,
  onOpenMenu,
  onRenameFolder,
  onSelect,
  onSelectNote,
  onOpenIconPicker,
  onRemoveIcon,
  onMoveFileToFolder,
  creatingFolderParentPath,
  isCreatingFolder,
  onCancelCreateFolder,
  onCreateFolderSubmit,
  onStartRenameFolder,
  onToggle,
  onCancelRenameFolder,
  locale,
  renamingFolderPath,
  rootPath,
  selection,
}: FolderTreeRowProps) {
  const isExpanded = expanded[folderNodeKey({ path: node.path, rootPath: node.rootPath ?? rootPath })] ?? false
  const childFolders = sortFolderNodes(node.children)
  const childFiles = sortFileTreeEntries(directFiles(entries, node.path, node.rootPath ?? rootPath ?? vaultPath))
  const hasChildren = childFolders.length > 0 || childFiles.length > 0
  const isCreatingChildFolder = !!isCreatingFolder && creatingFolderParentPath === node.path
  if (!isExpanded || (!hasChildren && !isCreatingChildFolder)) return null
  const childDepthIndent = getFolderDepthIndent(depth + 1) + FOLDER_ROW_CONTENT_INSET

  return (
    <div className="relative" data-testid={`folder-children:${node.path}`}>
      <div
        className="absolute top-0 bottom-0 bg-border"
        data-testid={`folder-connector:${node.path}`}
        style={{ left: getFolderConnectorLeft(depth), width: 1 }}
      />
      {childFolders.map((child) => (
        <FolderTreeRow
          key={folderNodeKey({ path: child.path, rootPath: child.rootPath ?? rootPath })}
          depth={depth + 1}
          entries={entries}
          expanded={expanded}
          node={child}
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
          onMoveFileToFolder={onMoveFileToFolder}
          creatingFolderParentPath={creatingFolderParentPath}
          isCreatingFolder={isCreatingFolder}
          onCancelCreateFolder={onCancelCreateFolder}
          onCreateFolderSubmit={onCreateFolderSubmit}
          onStartRenameFolder={onStartRenameFolder}
          onToggle={onToggle}
          onCancelRenameFolder={onCancelRenameFolder}
          locale={locale}
          renamingFolderPath={renamingFolderPath}
          rootPath={rootPath}
          selection={selection}
        />
      ))}
      {childFiles.map((entry) => {
        const relativePath = entryRelativePath(entry, node.rootPath ?? rootPath ?? vaultPath)
        return (
          <FileItemRow
            key={entry.path}
            entry={entry}
            depthIndent={childDepthIndent}
            isActive={entry.path === activeNotePath}
            icon={icons?.[relativePath]}
            showOriginalFilename={showOriginalFilenames}
            relativePath={relativePath}
            onSelect={(selected) => onSelectNote?.(selected)}
            onOpenIconPicker={onOpenIconPicker}
            onRemoveIcon={onRemoveIcon}
          />
        )
      })}
      {isCreatingChildFolder && onCancelCreateFolder && onCreateFolderSubmit && (
        <div style={{ paddingLeft: childDepthIndent }}>
          <FolderNameInput
            ariaLabel={`New folder inside ${node.name}`}
            initialValue=""
            placeholder="Folder name"
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

function entryRelativePath(entry: VaultEntry, vaultPath?: string): string {
  return vaultPath && entry.path.startsWith(`${vaultPath}/`)
    ? entry.path.slice(vaultPath.length + 1)
    : entry.path
}

function directFiles(entries: VaultEntry[], folderPath: string, vaultPath?: string): VaultEntry[] {
  return entries.filter((entry) => {
    const relativePath = entryRelativePath(entry, vaultPath)
    const lastSlash = relativePath.lastIndexOf('/')
    const parentPath = lastSlash >= 0 ? relativePath.slice(0, lastSlash) : ''
    return parentPath === folderPath
  })
}

function folderSelectionMatches(
  selection: SidebarSelection,
  node: FolderNode,
  defaultRootPath?: string,
): boolean {
  if (selection.kind !== 'folder' || selection.path !== node.path) return false

  const nodeRootPath = node.rootPath ?? defaultRootPath
  if (!nodeRootPath) return !selection.rootPath
  if (selection.rootPath) return selection.rootPath === nodeRootPath
  return nodeRootPath === defaultRootPath
}

export const FolderTreeRow = memo(function FolderTreeRow({
  depth,
  entries,
  expanded,
  node,
  activeNotePath,
  vaultPath,
  icons,
  showOriginalFilenames,
  onDeleteFolder,
  onOpenMenu,
  onRenameFolder,
  onSelect,
  onSelectNote,
  onOpenIconPicker,
  onRemoveIcon,
  onMoveFileToFolder,
  creatingFolderParentPath,
  isCreatingFolder,
  onCancelCreateFolder,
  onCreateFolderSubmit,
  onStartRenameFolder,
  onToggle,
  onCancelRenameFolder,
  locale = 'en',
  renamingFolderPath,
  rootPath,
  selection,
}: FolderTreeRowProps) {
  const nodeKey = folderNodeKey({ path: node.path, rootPath: node.rootPath ?? rootPath })
  const nodeRootPath = node.rootPath ?? rootPath
  const isExpanded = expanded[nodeKey] ?? false
  const isSelected = folderSelectionMatches(selection, { ...node, rootPath: nodeRootPath }, rootPath)
  const canUseDefaultFolderActions = !nodeRootPath || nodeRootPath === rootPath
  const canMutateFolder = node.path.length > 0 && canUseDefaultFolderActions
  const canDropFiles = canUseDefaultFolderActions && !!onMoveFileToFolder
  const isRenaming = canMutateFolder && renamingFolderPath === node.path
  const depthIndent = getFolderDepthIndent(depth)
  const contentInset = FOLDER_ROW_CONTENT_INSET
  const hasChildren = node.children.length > 0 || directFiles(entries, node.path, nodeRootPath ?? rootPath ?? vaultPath).length > 0
  const selectFolder = useCallback(() => {
    onSelect(nodeRootPath
      ? { kind: 'folder', path: node.path, rootPath: nodeRootPath }
      : { kind: 'folder', path: node.path })
  }, [node.path, nodeRootPath, onSelect])
  const row = (
    <FolderItemRow
      canOpenMenu={canUseDefaultFolderActions}
      contentInset={contentInset}
      depthIndent={depthIndent}
      hasChildren={hasChildren}
      isExpanded={isExpanded}
      isSelected={isSelected}
      icon={icons?.[node.path]}
      node={node}
      onOpenMenu={onOpenMenu}
      onSelect={selectFolder}
      onStartRenameFolder={canMutateFolder ? onStartRenameFolder : undefined}
      onToggle={() => onToggle(nodeKey)}
      onMoveFileToFolder={(filePath, folderPath) => onMoveFileToFolder?.(filePath, folderPath, nodeRootPath)}
      canDropFiles={canDropFiles}
    />
  )

  return (
    <>
      {isRenaming && onRenameFolder && onCancelRenameFolder ? (
        <FolderRenameRow
          contentInset={contentInset}
          depthIndent={depthIndent}
          node={node}
          locale={locale}
          onCancelRenameFolder={onCancelRenameFolder}
          onRenameFolder={onRenameFolder}
        />
      ) : row}
      <FolderChildren
        depth={depth}
        entries={entries}
        expanded={expanded}
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
        onMoveFileToFolder={onMoveFileToFolder}
        creatingFolderParentPath={creatingFolderParentPath}
        isCreatingFolder={isCreatingFolder}
        onCancelCreateFolder={onCancelCreateFolder}
        onCreateFolderSubmit={onCreateFolderSubmit}
        onStartRenameFolder={onStartRenameFolder}
        onToggle={onToggle}
        onCancelRenameFolder={onCancelRenameFolder}
        locale={locale}
        renamingFolderPath={renamingFolderPath}
        rootPath={rootPath}
        selection={selection}
      />
    </>
  )
})
