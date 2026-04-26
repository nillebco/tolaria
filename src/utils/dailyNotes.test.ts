import { describe, expect, it } from 'vitest'
import {
  dailyNoteAbsolutePath,
  dailyNoteRelativePath,
  parseDailyNotesConfig,
} from './dailyNotes'

describe('dailyNotes', () => {
  it('builds the daily note path from Obsidian daily-notes.json format', () => {
    const config = parseDailyNotesConfig(JSON.stringify({
      folder: 'Daily',
      format: 'YYYY/MM-MMMM/YYYY-MM-DD-dddd',
    }))

    expect(dailyNoteRelativePath(config, new Date(2026, 3, 25))).toBe(
      'Daily/2026/04-April/2026-04-25-Saturday.md',
    )
  })

  it('falls back to root YYYY-MM-DD notes when config is missing values', () => {
    expect(dailyNoteRelativePath({}, new Date(2026, 3, 25))).toBe('2026-04-25.md')
  })

  it('joins daily note paths under the selected vault', () => {
    expect(dailyNoteAbsolutePath('/vault/', '/Daily/2026-04-25.md')).toBe(
      '/vault/Daily/2026-04-25.md',
    )
  })
})
