import fs from 'fs'
import path from 'path'
import { test, expect, type Page, type Locator } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

const DRAG_NOTE_FILENAME = 'drag-test-note.md'

function writeDragTestNote(vaultDir: string): void {
  const notePath = path.join(vaultDir, 'note', DRAG_NOTE_FILENAME)
  fs.writeFileSync(
    notePath,
    `---
Is A: Note
Status: Active
---

# Drag Test

- [ ] Todo Alpha
- [ ] Todo Beta
- [ ] Todo Gamma

Para Alpha

Para Beta

Para Gamma

Para Delta
`,
    'utf8',
  )
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.getByText(title, { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getBlockByText(page: Page, text: string): Promise<Locator> {
  return page.locator('.bn-block-content').filter({ hasText: text }).first()
}

function dragTestNoteContent(): string {
  return fs.readFileSync(path.join(tempVaultDir, 'note', DRAG_NOTE_FILENAME), 'utf8')
}

async function hoverBlockAndGetHandle(page: Page, block: Locator): Promise<Locator> {
  await block.hover()
  const handle = page.locator('.bn-side-menu button:has([data-test="dragHandle"])').first()
  await expect(handle).toBeVisible({ timeout: 5_000 })
  await expect(handle).not.toHaveAttribute('draggable', 'true')
  return handle
}

async function dragBlockBelow(
  page: Page,
  sourceBlock: Locator,
  targetBlock: Locator,
  options: { keepHandleX?: boolean } = {},
): Promise<void> {
  const handle = await hoverBlockAndGetHandle(page, sourceBlock)

  const handleBox = await handle.boundingBox()
  const targetBox = await targetBlock.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  const handleCenterX = handleBox!.x + handleBox!.width / 2
  const handleCenterY = handleBox!.y + handleBox!.height / 2
  const dropX = options.keepHandleX ? handleCenterX : targetBox!.x + targetBox!.width / 2

  await page.mouse.move(handleCenterX, handleCenterY)
  await page.mouse.down()
  await page.mouse.move(handleCenterX + 4, handleCenterY + 4, { steps: 4 })
  await page.mouse.move(handleCenterX + 16, handleCenterY + 16, { steps: 8 })
  await page.mouse.move(dropX, targetBox!.y + targetBox!.height + 5, { steps: 20 })

  const dragPreview = page.getByTestId('editor-block-drag-preview')
  const dropIndicator = page.getByTestId('editor-block-drop-indicator')
  await expect(dragPreview).toBeVisible()
  await expect(dropIndicator).toBeVisible()

  await page.mouse.up()
  await expect(dragPreview).toHaveCount(0)
  await expect(dropIndicator).toHaveCount(0)
}

test.describe('block drag regression', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
    writeDragTestNote(tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('drag handle appears for checkListItem blocks', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await openNote(page, 'Drag Test')

    const todoAlpha = await getBlockByText(page, 'Todo Alpha')
    await expect(todoAlpha).toBeVisible({ timeout: 5_000 })

    const handle = await hoverBlockAndGetHandle(page, todoAlpha)
    expect(handle).toBeTruthy()
    await expect(handle).toBeVisible()
  })

  test('drag handle appears for paragraph blocks', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await openNote(page, 'Drag Test')

    const paraAlpha = await getBlockByText(page, 'Para Alpha')
    await expect(paraAlpha).toBeVisible({ timeout: 5_000 })

    const handle = await hoverBlockAndGetHandle(page, paraAlpha)
    expect(handle).toBeTruthy()
    await expect(handle).toBeVisible()
  })

  test('can drag checkListItem block to reorder', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await openNote(page, 'Drag Test')

    const todoAlpha = await getBlockByText(page, 'Todo Alpha')
    const todoBeta = await getBlockByText(page, 'Todo Beta')
    const todoGamma = await getBlockByText(page, 'Todo Gamma')

    await expect(todoAlpha).toBeVisible({ timeout: 5_000 })
    await expect(todoBeta).toBeVisible()
    await expect(todoGamma).toBeVisible()

    // Verify initial order: Alpha is above Beta
    const alphaBefore = await todoAlpha.boundingBox()
    const betaBefore = await todoBeta.boundingBox()
    expect(alphaBefore!.y).toBeLessThan(betaBefore!.y)

    // Drag "Todo Alpha" below "Todo Gamma"
    await dragBlockBelow(page, todoAlpha, todoGamma)

    // After drag, "Todo Alpha" should be below "Todo Gamma"
    const gammaAfter = await todoGamma.boundingBox()
    const alphaAfter = await todoAlpha.boundingBox()
    expect(alphaAfter!.y).toBeGreaterThan(gammaAfter!.y)
    await expect.poll(dragTestNoteContent).toMatch(/Todo Beta[\s\S]*Todo Gamma[\s\S]*Todo Alpha/)
  })

  test('can drag checkListItem block from the handle gutter to reorder', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await openNote(page, 'Drag Test')

    const todoAlpha = await getBlockByText(page, 'Todo Alpha')
    const todoGamma = await getBlockByText(page, 'Todo Gamma')
    await expect(todoAlpha).toBeVisible({ timeout: 5_000 })
    await expect(todoGamma).toBeVisible()

    await dragBlockBelow(page, todoAlpha, todoGamma, { keepHandleX: true })

    const gammaAfter = await todoGamma.boundingBox()
    const alphaAfter = await todoAlpha.boundingBox()
    expect(alphaAfter!.y).toBeGreaterThan(gammaAfter!.y)
    await expect.poll(dragTestNoteContent).toMatch(/Todo Beta[\s\S]*Todo Gamma[\s\S]*Todo Alpha/)
  })

  test('can drag paragraph block to reorder', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await openNote(page, 'Drag Test')

    const paraAlpha = await getBlockByText(page, 'Para Alpha')
    const paraBeta = await getBlockByText(page, 'Para Beta')
    const paraGamma = await getBlockByText(page, 'Para Gamma')

    await expect(paraAlpha).toBeVisible({ timeout: 5_000 })
    await expect(paraBeta).toBeVisible()
    await expect(paraGamma).toBeVisible()

    // Verify initial order
    const alphaBefore = await paraAlpha.boundingBox()
    const betaBefore = await paraBeta.boundingBox()
    expect(alphaBefore!.y).toBeLessThan(betaBefore!.y)

    // Drag "Para Alpha" below "Para Gamma"
    await dragBlockBelow(page, paraAlpha, paraGamma)

    // After drag, "Para Alpha" should be below "Para Gamma"
    const gammaAfter = await paraGamma.boundingBox()
    const alphaAfter = await paraAlpha.boundingBox()
    expect(alphaAfter!.y).toBeGreaterThan(gammaAfter!.y)
  })
})
