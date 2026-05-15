import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorRightPanel } from './EditorRightPanel'
import type { VaultEntry } from '../types'

vi.mock('./Inspector', () => ({
  Inspector: () => <div data-testid="properties-panel">Properties</div>,
}))

vi.mock('./TableOfContentsPanel', () => ({
  TableOfContentsPanel: () => <div data-testid="table-of-contents-panel">Table of contents</div>,
}))

vi.mock('./AiPanel', () => ({
  AiPanelView: () => <div data-testid="ai-panel">AI panel</div>,
}))

vi.mock('./useAiPanelController', () => ({
  useAiPanelController: () => ({
    handleNewChat: vi.fn(),
  }),
}))

const entry: VaultEntry = {
  path: '/vault/test.md',
  filename: 'test.md',
  title: 'Test',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
}

const defaultProps = {
  inspectorCollapsed: true,
  inspectorWidth: 280,
  editor: {},
  defaultAiAgentReady: true,
  inspectorEntry: entry,
  inspectorContent: '# Test',
  entries: [entry],
  gitHistory: [],
  vaultPath: '/vault',
  onToggleInspector: vi.fn(),
  onToggleAIChat: vi.fn(),
  onToggleTableOfContents: vi.fn(),
  onNavigateWikilink: vi.fn(),
  onViewCommitDiff: vi.fn(async () => {}),
}

describe('EditorRightPanel', () => {
  it('shows AI instead of Properties when both panes are marked open during a switch', () => {
    render(
      <EditorRightPanel
        {...defaultProps}
        showAIChat
        inspectorCollapsed={false}
      />,
    )

    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('properties-panel')).not.toBeInTheDocument()
  })
})
