type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem

type ImageClipboardDependencies = {
  ClipboardItem?: ClipboardItemConstructor
  clipboard?: Pick<Clipboard, 'write'>
  fetch?: typeof fetch
}

function resolveImageMimeType(blob: Blob): string {
  if (blob.type.startsWith('image/')) return blob.type
  throw new Error('Preview source is not an image')
}

export async function copyImageSourceToClipboard(
  imageSrc: string,
  dependencies: ImageClipboardDependencies = {},
): Promise<void> {
  const fetchImage = dependencies.fetch ?? globalThis.fetch
  const clipboard = dependencies.clipboard ?? navigator.clipboard
  const ClipboardItemCtor = dependencies.ClipboardItem ?? globalThis.ClipboardItem

  if (!fetchImage || !clipboard?.write || !ClipboardItemCtor) {
    throw new Error('Image clipboard API is unavailable')
  }

  const response = await fetchImage(imageSrc)
  if (!response.ok) throw new Error('Could not load image for copying')

  const blob = await response.blob()
  await clipboard.write([
    new ClipboardItemCtor({
      [resolveImageMimeType(blob)]: blob,
    }),
  ])
}
