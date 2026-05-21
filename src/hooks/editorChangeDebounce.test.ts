import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useDebouncedEditorChange, RICH_EDITOR_CHANGE_DEBOUNCE_MS } from './editorChangeDebounce'

describe('useDebouncedEditorChange', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls onActivity immediately on handleEditorChange before debounce fires', () => {
    const onFlush = vi.fn()
    const onActivity = vi.fn()
    const { result } = renderHook(() => {
      const suppressChangeRef = useRef(false)
      return useDebouncedEditorChange({ onFlush, onActivity, suppressChangeRef })
    })

    act(() => { result.current.handleEditorChange() })

    expect(onActivity).toHaveBeenCalledTimes(1)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('calls onActivity before onFlush when debounce fires', () => {
    const calls: string[] = []
    const onFlush = vi.fn(() => calls.push('flush'))
    const onActivity = vi.fn(() => calls.push('activity'))
    const { result } = renderHook(() => {
      const suppressChangeRef = useRef(false)
      return useDebouncedEditorChange({ onFlush, onActivity, suppressChangeRef })
    })

    act(() => { result.current.handleEditorChange() })
    act(() => { vi.advanceTimersByTime(RICH_EDITOR_CHANGE_DEBOUNCE_MS) })

    expect(calls).toEqual(['activity', 'flush'])
  })

  it('does not call onActivity when suppressed', () => {
    const onFlush = vi.fn()
    const onActivity = vi.fn()
    const { result } = renderHook(() => {
      const suppressChangeRef = useRef(true)
      return useDebouncedEditorChange({ onFlush, onActivity, suppressChangeRef })
    })

    act(() => { result.current.handleEditorChange() })

    expect(onActivity).not.toHaveBeenCalled()
  })

  it('works without onActivity (backwards compat)', () => {
    const onFlush = vi.fn()
    const { result } = renderHook(() => {
      const suppressChangeRef = useRef(false)
      return useDebouncedEditorChange({ onFlush, suppressChangeRef })
    })

    expect(() => {
      act(() => { result.current.handleEditorChange() })
      act(() => { vi.advanceTimersByTime(RICH_EDITOR_CHANGE_DEBOUNCE_MS) })
    }).not.toThrow()
    expect(onFlush).toHaveBeenCalledTimes(1)
  })
})
