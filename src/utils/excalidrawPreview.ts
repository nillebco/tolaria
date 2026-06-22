export type ExcalidrawRenderableElement =
  | ExcalidrawShapeElement
  | ExcalidrawTextElement

export interface ExcalidrawShapeElement {
  type: 'arrow' | 'diamond' | 'ellipse' | 'freedraw' | 'line' | 'rectangle'
  x: number
  y: number
  width: number
  height: number
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
  opacity: number
  points: ReadonlyArray<readonly [number, number]>
}

export interface ExcalidrawTextElement {
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  strokeColor: string
  opacity: number
  text: string
  fontSize: number
}

export interface ExcalidrawPreviewScene {
  backgroundColor: string
  elements: ExcalidrawRenderableElement[]
  viewBox: {
    height: number
    minX: number
    minY: number
    width: number
  }
}

type UnknownRecord = Record<string, unknown>

const DEFAULT_BACKGROUND_COLOR = '#ffffff'
const DEFAULT_STROKE_COLOR = '#1e1e1e'
const DEFAULT_STROKE_WIDTH = 2
const DEFAULT_FONT_SIZE = 20
const VIEWBOX_PADDING = 48
const EMPTY_SCENE_SIZE = 640
const SHAPE_TYPES = new Set(['arrow', 'diamond', 'ellipse', 'freedraw', 'line', 'rectangle'])

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function booleanValue(value: unknown): boolean {
  return typeof value === 'boolean' && value
}

function pointsValue(value: unknown): ReadonlyArray<readonly [number, number]> {
  if (!Array.isArray(value)) return []

  return value.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const x = numberValue(point[0], Number.NaN)
    const y = numberValue(point[1], Number.NaN)
    return Number.isFinite(x) && Number.isFinite(y) ? [[x, y] as const] : []
  })
}

function parseTextElement(element: UnknownRecord): ExcalidrawTextElement {
  return {
    type: 'text',
    x: numberValue(element.x, 0),
    y: numberValue(element.y, 0),
    width: Math.abs(numberValue(element.width, 0)),
    height: Math.abs(numberValue(element.height, 0)),
    strokeColor: stringValue(element.strokeColor, DEFAULT_STROKE_COLOR),
    opacity: numberValue(element.opacity, 100),
    text: stringValue(element.text, ''),
    fontSize: numberValue(element.fontSize, DEFAULT_FONT_SIZE),
  }
}

function parseShapeElement(element: UnknownRecord, type: ExcalidrawShapeElement['type']): ExcalidrawShapeElement {
  return {
    type,
    x: numberValue(element.x, 0),
    y: numberValue(element.y, 0),
    width: numberValue(element.width, 0),
    height: numberValue(element.height, 0),
    strokeColor: stringValue(element.strokeColor, DEFAULT_STROKE_COLOR),
    backgroundColor: stringValue(element.backgroundColor, 'transparent'),
    strokeWidth: numberValue(element.strokeWidth, DEFAULT_STROKE_WIDTH),
    opacity: numberValue(element.opacity, 100),
    points: pointsValue(element.points),
  }
}

function parseElement(element: unknown): ExcalidrawRenderableElement | null {
  if (!isRecord(element) || booleanValue(element.isDeleted)) return null

  const type = stringValue(element.type, '')
  if (type === 'text') return parseTextElement(element)
  if (SHAPE_TYPES.has(type)) return parseShapeElement(element, type as ExcalidrawShapeElement['type'])
  return null
}

function elementBounds(element: ExcalidrawRenderableElement): { maxX: number; maxY: number; minX: number; minY: number } {
  if (element.type === 'text') {
    return {
      minX: element.x,
      minY: element.y,
      maxX: element.x + element.width,
      maxY: element.y + element.height,
    }
  }

  const absolutePoints = element.points.map(([x, y]) => [element.x + x, element.y + y] as const)
  const xs = [element.x, element.x + element.width, ...absolutePoints.map(([x]) => x)]
  const ys = [element.y, element.y + element.height, ...absolutePoints.map(([, y]) => y)]

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function sceneViewBox(elements: ExcalidrawRenderableElement[]): ExcalidrawPreviewScene['viewBox'] {
  if (elements.length === 0) {
    return { minX: 0, minY: 0, width: EMPTY_SCENE_SIZE, height: EMPTY_SCENE_SIZE }
  }

  const bounds = elements.map(elementBounds)
  const minX = Math.min(...bounds.map((bound) => bound.minX)) - VIEWBOX_PADDING
  const minY = Math.min(...bounds.map((bound) => bound.minY)) - VIEWBOX_PADDING
  const maxX = Math.max(...bounds.map((bound) => bound.maxX)) + VIEWBOX_PADDING
  const maxY = Math.max(...bounds.map((bound) => bound.maxY)) + VIEWBOX_PADDING

  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function sceneBackgroundColor(value: unknown): string {
  if (!isRecord(value)) return DEFAULT_BACKGROUND_COLOR
  return stringValue(value.viewBackgroundColor, DEFAULT_BACKGROUND_COLOR)
}

export function parseExcalidrawPreviewScene(content: string): ExcalidrawPreviewScene {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || parsed.type !== 'excalidraw' || !Array.isArray(parsed.elements)) {
    throw new Error('Invalid Excalidraw scene')
  }

  const elements = parsed.elements.flatMap((element) => {
    const parsedElement = parseElement(element)
    return parsedElement ? [parsedElement] : []
  })

  return {
    backgroundColor: sceneBackgroundColor(parsed.appState),
    elements,
    viewBox: sceneViewBox(elements),
  }
}
