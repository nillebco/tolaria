import { render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'

vi.mock('@blocknote/core/extensions', () => ({
  SideMenuExtension: {},
  SuggestionMenu: {},
}))

const mockEditorElement = document.createElement('div')
mockEditorElement.className = 'bn-editor'

const mockEditor = {
  domElement: mockEditorElement,
  getBlock: vi.fn(() => ({
    children: [],
    content: { type: 'tableContent' },
    id: 'block-1',
    type: 'table',
  })),
  insertBlocks: vi.fn(() => [{ id: 'inserted-block' }]),
  removeBlocks: vi.fn(),
  setTextCursorPosition: vi.fn(),
  settings: { tables: { headers: true } },
  updateBlock: vi.fn(),
}

vi.mock('@blocknote/react', () => ({
  DragHandleMenu: ({ children }: PropsWithChildren) => (
    <div data-testid="drag-handle-menu">{children}</div>
  ),
  SideMenu: ({ children }: PropsWithChildren) => <div data-testid="side-menu">{children}</div>,
  useBlockNoteEditor: () => mockEditor,
  useComponentsContext: () => ({
    Generic: {
      Menu: {
        Item: ({ children }: PropsWithChildren) => <div>{children}</div>,
        Root: ({ children }: PropsWithChildren) => <div>{children}</div>,
        Trigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
      },
    },
    SideMenu: {
      Button: ({ icon }: { icon?: ReactNode }) => <button>{icon}</button>,
    },
  }),
  useDictionary: () => ({
    drag_handle: {
      colors_menuitem: 'Colors',
      delete_menuitem: 'Delete',
      header_column_menuitem: 'Header column',
      header_row_menuitem: 'Header row',
    },
    side_menu: {
      add_block_label: 'Add block',
      drag_handle_label: 'Drag block',
    },
  }),
  useExtension: () => ({
    freezeMenu: vi.fn(),
    openSuggestionMenu: vi.fn(),
    unfreezeMenu: vi.fn(),
  }),
  useExtensionState: () => ({
    content: { type: 'tableContent' },
    id: 'block-1',
    type: 'table',
  }),
}))

describe('TolariaSideMenu', () => {
  it('replaces BlockNote block colors with markdown-safe drag-handle items', () => {
    render(<TolariaSideMenu />)

    expect(screen.getByTestId('side-menu')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Header row')).toBeInTheDocument()
    expect(screen.getByText('Header column')).toBeInTheDocument()
    expect(screen.queryByText('Colors')).not.toBeInTheDocument()
  })
})
