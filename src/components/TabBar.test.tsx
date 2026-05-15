import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TabBar } from './TabBar'
import type { VaultEntry } from '../types'

function makeEntry(path: string, title: string): VaultEntry {
  return {
    path,
    filename: `${title.toLowerCase()}.md`,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1700000000,
    createdAt: null,
    fileSize: 10,
    snippet: '',
    wordCount: 1,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    template: null,
    sort: null,
    outgoingLinks: [],
  }
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn(),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value)
    }),
    setDragImage: vi.fn(),
  }
}

describe('TabBar', () => {
  it('reorders tabs by dropping one tab onto another', () => {
    const onReorderTabs = vi.fn()
    const dataTransfer = createDataTransfer()
    render(
      <TabBar
        tabs={[
          { entry: makeEntry('/vault/a.md', 'Alpha'), content: '# Alpha' },
          { entry: makeEntry('/vault/b.md', 'Beta'), content: '# Beta' },
          { entry: makeEntry('/vault/c.md', 'Gamma'), content: '# Gamma' },
        ]}
        activeTabPath="/vault/a.md"
        onSwitchTab={vi.fn()}
        onCloseTab={vi.fn()}
        onReorderTabs={onReorderTabs}
      />,
    )

    fireEvent.dragStart(screen.getByRole('tab', { name: /Gamma/ }), { dataTransfer })
    fireEvent.dragOver(screen.getByRole('tab', { name: /Alpha/ }), { dataTransfer })
    fireEvent.drop(screen.getByRole('tab', { name: /Alpha/ }), { dataTransfer })

    expect(onReorderTabs).toHaveBeenCalledWith('/vault/c.md', '/vault/a.md')
  })
})
