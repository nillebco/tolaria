import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { useRightPanelExclusion } from './useRightPanelExclusion'

describe('useRightPanelExclusion', () => {
  it('toggles side-pane visibility without changing the selected panel', () => {
    const { result } = renderHook(() => {
      const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
      const [showAIChat, setShowAIChat] = useState(false)
      const rightPanel = useRightPanelExclusion({
        inspectorCollapsed,
        onToggleAIChat: () => setShowAIChat((current) => !current),
        onToggleInspector: () => setInspectorCollapsed((current) => !current),
        showAIChat,
      })

      return { inspectorCollapsed, showAIChat, ...rightPanel }
    })

    act(() => result.current.handleToggleInspectorPanel())
    expect(result.current.inspectorCollapsed).toBe(false)
    expect(result.current.showAIChat).toBe(false)

    act(() => result.current.handleToggleSidePane())
    expect(result.current.inspectorCollapsed).toBe(true)
    expect(result.current.showAIChat).toBe(false)

    act(() => result.current.handleToggleSidePane())
    expect(result.current.inspectorCollapsed).toBe(false)
    expect(result.current.showAIChat).toBe(false)
  })

  it('toggles the AI panel and replaces Properties', () => {
    const { result } = renderHook(() => {
      const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
      const [showAIChat, setShowAIChat] = useState(false)
      const rightPanel = useRightPanelExclusion({
        inspectorCollapsed,
        onToggleAIChat: () => setShowAIChat((current) => !current),
        onToggleInspector: () => setInspectorCollapsed((current) => !current),
        showAIChat,
      })

      return { inspectorCollapsed, showAIChat, ...rightPanel }
    })

    act(() => result.current.handleToggleAIChatPanel())
    expect(result.current.inspectorCollapsed).toBe(true)
    expect(result.current.showAIChat).toBe(true)

    act(() => result.current.handleToggleAIChatPanel())
    expect(result.current.inspectorCollapsed).toBe(true)
    expect(result.current.showAIChat).toBe(false)
  })

  it('replaces the AI panel with Properties when toggling Properties', () => {
    const { result } = renderHook(() => {
      const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
      const [showAIChat, setShowAIChat] = useState(true)
      const rightPanel = useRightPanelExclusion({
        inspectorCollapsed,
        onToggleAIChat: () => setShowAIChat((current) => !current),
        onToggleInspector: () => setInspectorCollapsed((current) => !current),
        showAIChat,
      })

      return { inspectorCollapsed, showAIChat, ...rightPanel }
    })

    act(() => result.current.handleToggleInspectorPanel())
    expect(result.current.inspectorCollapsed).toBe(false)
    expect(result.current.showAIChat).toBe(false)
    expect(result.current.showTableOfContents).toBe(false)
  })

  it('replaces the table of contents with Properties when toggling Properties', () => {
    const { result } = renderHook(() => {
      const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
      const [showAIChat, setShowAIChat] = useState(false)
      const rightPanel = useRightPanelExclusion({
        inspectorCollapsed,
        onToggleAIChat: () => setShowAIChat((current) => !current),
        onToggleInspector: () => setInspectorCollapsed((current) => !current),
        showAIChat,
      })

      return { inspectorCollapsed, showAIChat, ...rightPanel }
    })

    act(() => result.current.handleToggleTableOfContents())
    expect(result.current.showTableOfContents).toBe(true)

    act(() => result.current.handleToggleInspectorPanel())
    expect(result.current.inspectorCollapsed).toBe(false)
    expect(result.current.showAIChat).toBe(false)
    expect(result.current.showTableOfContents).toBe(false)
  })
})
