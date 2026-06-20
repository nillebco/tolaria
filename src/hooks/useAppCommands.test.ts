import { describe, expect, it, vi } from 'vitest'
import { createMenuEventVaultHandlers } from './useAppCommands'

describe('createMenuEventVaultHandlers', () => {
  it('passes tab navigation handlers to native menu dispatch', () => {
    const onNextTab = vi.fn()
    const onPrevTab = vi.fn()

    const handlers = createMenuEventVaultHandlers({
      onCommitPush: vi.fn(),
      onNextTab,
      onPrevTab,
    }, vi.fn())

    handlers.onNextTab?.()
    handlers.onPrevTab?.()

    expect(onNextTab).toHaveBeenCalledOnce()
    expect(onPrevTab).toHaveBeenCalledOnce()
  })
})
