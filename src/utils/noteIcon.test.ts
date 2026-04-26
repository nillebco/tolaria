import { describe, expect, it } from 'vitest'
import { resolveNoteIcon } from './noteIcon'

describe('resolveNoteIcon', () => {
  it('treats SVG data URLs as image icons', () => {
    expect(resolveNoteIcon('data:image/svg+xml;base64,PHN2Zy8+')).toEqual({
      kind: 'image',
      src: 'data:image/svg+xml;base64,PHN2Zy8+',
    })
  })

  it('treats Tauri asset URLs as image icons', () => {
    expect(resolveNoteIcon('asset://localhost/%2Fvault%2Ficon.svg')).toEqual({
      kind: 'image',
      src: 'asset://localhost/%2Fvault%2Ficon.svg',
    })
  })
})
