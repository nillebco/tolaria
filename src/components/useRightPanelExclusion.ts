import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '../lib/telemetry'

interface RightPanelExclusionOptions {
  inspectorCollapsed: boolean
  onToggleAIChat?: () => void
  onToggleInspector: () => void
  showAIChat?: boolean
}

interface RightPanelToggleOptions extends RightPanelExclusionOptions {
  closeTableOfContents: () => void
  openTableOfContents?: () => void
  showTableOfContents?: boolean
}

type RightPanelId = 'ai' | 'properties' | 'toc'

function prepareRightPanelOpen(
  panel: 'ai' | 'properties',
  {
    closeTableOfContents,
    inspectorCollapsed,
    onToggleAIChat,
    onToggleInspector,
    showAIChat,
  }: RightPanelToggleOptions,
) {
  if (panel === 'properties' && !inspectorCollapsed) return
  if (panel === 'ai' && showAIChat) return

  closeTableOfContents()
  if (panel === 'properties' && showAIChat) onToggleAIChat?.()
  if (panel === 'ai' && !inspectorCollapsed) onToggleInspector()
}

function toggleTableOfContentsPanel({
  closeTableOfContents,
  inspectorCollapsed,
  onToggleAIChat,
  onToggleInspector,
  openTableOfContents,
  showAIChat,
  showTableOfContents,
}: RightPanelToggleOptions) {
  if (showTableOfContents) {
    closeTableOfContents()
    return
  }

  if (!inspectorCollapsed) onToggleInspector()
  if (showAIChat) onToggleAIChat?.()
  openTableOfContents?.()
}

export function useRightPanelExclusion({
  inspectorCollapsed,
  onToggleAIChat,
  onToggleInspector,
  showAIChat,
}: RightPanelExclusionOptions) {
  const [showTableOfContents, setShowTableOfContents] = useState(false)
  const lastSelectedPanelRef = useRef<RightPanelId>(onToggleAIChat ? 'ai' : 'properties')
  const closeTableOfContents = useCallback(() => setShowTableOfContents(false), [])
  const visiblePanel: RightPanelId | null = showAIChat
    ? 'ai'
    : showTableOfContents
      ? 'toc'
      : inspectorCollapsed === false
        ? 'properties'
        : null

  useEffect(() => {
    if (visiblePanel) lastSelectedPanelRef.current = visiblePanel
  }, [visiblePanel])

  const handleToggleInspectorPanel = useCallback(() => {
    if (inspectorCollapsed) lastSelectedPanelRef.current = 'properties'
    prepareRightPanelOpen('properties', {
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      showAIChat,
    })
    onToggleInspector()
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat])

  const handleToggleAIChatPanel = useCallback(() => {
    if (!showAIChat) lastSelectedPanelRef.current = 'ai'
    prepareRightPanelOpen('ai', {
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      showAIChat,
    })
    onToggleAIChat?.()
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat])

  const handleToggleTableOfContents = useCallback(() => {
    trackEvent('table_of_contents_toggled', { open: showTableOfContents ? 0 : 1 })
    if (!showTableOfContents) lastSelectedPanelRef.current = 'toc'
    toggleTableOfContentsPanel({
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      openTableOfContents: () => setShowTableOfContents(true),
      showAIChat,
      showTableOfContents,
    })
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat, showTableOfContents])

  const handleToggleSidePane = useCallback(() => {
    if (visiblePanel === 'ai') {
      onToggleAIChat?.()
      return
    }
    if (visiblePanel === 'toc') {
      closeTableOfContents()
      return
    }
    if (visiblePanel === 'properties') {
      onToggleInspector()
      return
    }

    const panelToOpen = lastSelectedPanelRef.current
    if (panelToOpen === 'ai' && onToggleAIChat) {
      handleToggleAIChatPanel()
      return
    }
    if (panelToOpen === 'toc') {
      handleToggleTableOfContents()
      return
    }
    handleToggleInspectorPanel()
  }, [
    closeTableOfContents,
    handleToggleAIChatPanel,
    handleToggleInspectorPanel,
    handleToggleTableOfContents,
    onToggleAIChat,
    onToggleInspector,
    visiblePanel,
  ])

  return {
    handleToggleAIChatPanel,
    handleToggleInspectorPanel,
    handleToggleSidePane,
    handleToggleTableOfContents,
    showTableOfContents,
  }
}
