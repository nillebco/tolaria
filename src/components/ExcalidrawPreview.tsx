import { useEffect, useMemo } from 'react'
import {
  parseExcalidrawPreviewScene,
  type ExcalidrawPreviewScene,
  type ExcalidrawRenderableElement,
  type ExcalidrawShapeElement,
} from '../utils/excalidrawPreview'

interface ExcalidrawPreviewProps {
  content: string
  title: string
  onPreviewError: () => void
}

function opacityValue(opacity: number): number {
  return Math.max(0, Math.min(1, opacity / 100))
}

function fillColor(element: ExcalidrawShapeElement): string {
  return element.backgroundColor === 'transparent' ? 'none' : element.backgroundColor
}

function pointPath(element: ExcalidrawShapeElement): string {
  const points = element.points.length > 0
    ? element.points
    : [[0, 0], [element.width, element.height]] as const

  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${element.x + x} ${element.y + y}`).join(' ')
}

function renderShape(element: ExcalidrawShapeElement, key: number) {
  const style = {
    opacity: opacityValue(element.opacity),
  }
  const strokeProps = {
    stroke: element.strokeColor,
    strokeWidth: element.strokeWidth,
    style,
  }

  if (element.type === 'rectangle') {
    return <rect key={key} x={element.x} y={element.y} width={element.width} height={element.height} rx={8} fill={fillColor(element)} {...strokeProps} />
  }

  if (element.type === 'ellipse') {
    return (
      <ellipse
        key={key}
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={Math.abs(element.width / 2)}
        ry={Math.abs(element.height / 2)}
        fill={fillColor(element)}
        {...strokeProps}
      />
    )
  }

  if (element.type === 'diamond') {
    const points = [
      [element.x + element.width / 2, element.y],
      [element.x + element.width, element.y + element.height / 2],
      [element.x + element.width / 2, element.y + element.height],
      [element.x, element.y + element.height / 2],
    ]
    return <polygon key={key} points={points.map(([x, y]) => `${x},${y}`).join(' ')} fill={fillColor(element)} {...strokeProps} />
  }

  return <path key={key} d={pointPath(element)} fill="none" strokeLinecap="round" strokeLinejoin="round" {...strokeProps} />
}

function renderText(element: Extract<ExcalidrawRenderableElement, { type: 'text' }>, key: number) {
  const lines = element.text.split('\n')
  return (
    <text
      key={key}
      x={element.x}
      y={element.y + element.fontSize}
      fill={element.strokeColor}
      fontFamily="Virgil, ui-sans-serif, system-ui, sans-serif"
      fontSize={element.fontSize}
      opacity={opacityValue(element.opacity)}
    >
      {lines.map((line, index) => (
        <tspan key={`${key}-${index}`} x={element.x} dy={index === 0 ? 0 : element.fontSize * 1.25}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

function renderElement(element: ExcalidrawRenderableElement, key: number) {
  return element.type === 'text' ? renderText(element, key) : renderShape(element, key)
}

function ExcalidrawSvg({ scene, title }: { scene: ExcalidrawPreviewScene; title: string }) {
  const { minX, minY, width, height } = scene.viewBox

  return (
    <svg
      role="img"
      aria-label={title}
      data-testid="excalidraw-file-preview"
      className="h-full max-h-full w-full max-w-full rounded-sm border border-border bg-background"
      viewBox={`${minX} ${minY} ${width} ${height}`}
    >
      <rect x={minX} y={minY} width={width} height={height} fill={scene.backgroundColor} />
      {scene.elements.map(renderElement)}
    </svg>
  )
}

export function ExcalidrawPreview({ content, title, onPreviewError }: ExcalidrawPreviewProps) {
  const scene = useMemo(() => {
    try {
      return parseExcalidrawPreviewScene(content)
    } catch {
      return null
    }
  }, [content])

  useEffect(() => {
    if (!scene) onPreviewError()
  }, [onPreviewError, scene])

  if (!scene) return null

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center overflow-auto p-6">
      <ExcalidrawSvg scene={scene} title={title} />
    </div>
  )
}
