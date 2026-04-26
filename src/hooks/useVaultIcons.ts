import { useState, useEffect } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'

const SVG_PREFIX = 'svg:'

/** Resolve a raw icon value returned by get_vault_icons to a renderable string.
 *  svg:<abs_path> → a Tauri asset URL; everything else is returned as-is. */
export function resolveIconValue(raw: string): string {
  if (raw.startsWith(SVG_PREFIX)) {
    return convertFileSrc(raw.slice(SVG_PREFIX.length))
  }
  return raw
}

/** Returns true when the resolved icon value should be rendered as an <img>. */
export function isIconUrl(resolved: string): boolean {
  return resolved.startsWith('http://')
    || resolved.startsWith('https://')
    || resolved.startsWith('asset://')
    || resolved.startsWith('data:image/')
}

/** Loads the icon map from the Obsidian icon-folder plugin data.json (if present).
 *  Each value is already resolved: emoji strings or asset:// URLs for SVGs. */
export function useVaultIcons(vaultPath: string): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!vaultPath || !isTauri()) return
    let cancelled = false

    Promise.resolve().then(() => {
      if (!cancelled) setIcons({})
    })

    invoke<Record<string, string>>('get_vault_icons', { vaultPath })
      .then((raw) => {
        if (cancelled) return
        const resolved: Record<string, string> = {}
        for (const [key, value] of Object.entries(raw)) {
          resolved[key] = resolveIconValue(value)
        }
        setIcons(resolved)
      })
      .catch(() => {
        if (!cancelled) setIcons({})
        // No icon data (not an Obsidian vault, or plugin not installed)
      })
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  return icons
}
