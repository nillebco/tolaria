import { describe, expect, it } from 'vitest'
import { parseExcalidrawPreviewScene } from './excalidrawPreview'

describe('parseExcalidrawPreviewScene', () => {
  it('keeps visible Excalidraw elements and computes a padded view box', () => {
    const scene = parseExcalidrawPreviewScene(JSON.stringify({
      type: 'excalidraw',
      appState: { viewBackgroundColor: '#f8f9fa' },
      elements: [
        {
          type: 'rectangle',
          isDeleted: false,
          x: 100,
          y: 120,
          width: 200,
          height: 80,
          strokeColor: '#111111',
          backgroundColor: '#ffffff',
          strokeWidth: 3,
          opacity: 75,
        },
        {
          type: 'text',
          isDeleted: false,
          x: 140,
          y: 145,
          width: 80,
          height: 30,
          text: 'Payroll',
          fontSize: 24,
        },
        {
          type: 'ellipse',
          isDeleted: true,
          x: 0,
          y: 0,
          width: 2000,
          height: 2000,
        },
      ],
    }))

    expect(scene.backgroundColor).toBe('#f8f9fa')
    expect(scene.elements).toHaveLength(2)
    expect(scene.viewBox).toEqual({
      minX: 52,
      minY: 72,
      width: 296,
      height: 176,
    })
  })

  it('rejects non-Excalidraw JSON', () => {
    expect(() => parseExcalidrawPreviewScene('{"type":"not-excalidraw","elements":[]}')).toThrow(
      'Invalid Excalidraw scene',
    )
  })
})
