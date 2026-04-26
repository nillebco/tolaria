import { describe, expect, it } from 'vitest'
import { isIconUrl } from './useVaultIcons'

describe('useVaultIcons', () => {
  it('treats Tauri asset URLs as image icons', () => {
    expect(isIconUrl('asset://localhost/Users/me/vault/.obsidian/icons/folder.svg')).toBe(true)
  })

  it('treats SVG data URLs as image icons', () => {
    expect(isIconUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true)
  })

  it('keeps emoji values as non-image icons', () => {
    expect(isIconUrl('📁')).toBe(false)
  })
})
