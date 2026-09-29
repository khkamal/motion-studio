import type { MediaAsset } from '../types/motion';

const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function normalizedMime(file: File): string {
  if (ACCEPTED_MIME.has(file.type.toLowerCase())) return file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  };
  return byExtension[extension ?? ''] ?? '';
}

function sanitizeSvg(source: string): string {
  if (source.length > 10 * 1024 * 1024) throw new Error('SVG files must be smaller than 10 MB.');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== 'svg' || document.querySelector('parsererror')) throw new Error('This SVG file is not valid XML.');
  const blocked = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video'];
  document.querySelectorAll(blocked.join(',')).forEach((element) => element.remove());
  document.querySelectorAll('style').forEach((style) => {
    if (/@import|expression\s*\(|url\s*\(\s*['"]?(?!#)/i.test(style.textContent ?? '')) style.remove();
  });
  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if (['href', 'xlink:href', 'src'].includes(name) && value && !value.startsWith('#') && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value)) {
        element.removeAttribute(attribute.name);
      } else if (name === 'style' && /url\s*\(\s*['"]?(?!#)|expression\s*\(/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(root);
}

async function measureImage(blob: Blob, url: string): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    } catch {
      // SVG decoding differs across browsers; use a detached image element as a safe fallback.
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image could not be decoded by this browser.'));
    image.src = url;
  });
}

export async function createMediaAsset(file: File): Promise<MediaAsset> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Images must be smaller than 100 MB.');
  const mimeType = normalizedMime(file);
  if (!mimeType) throw new Error('Choose a PNG, JPG, JPEG, WebP, or SVG image.');
  let blob: Blob = file;
  if (mimeType === 'image/svg+xml') {
    const safeSvg = sanitizeSvg(await file.text());
    blob = new Blob([safeSvg], { type: 'image/svg+xml' });
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const { width, height } = await measureImage(blob, objectUrl);
    if (!width || !height || width > 30_000 || height > 30_000) throw new Error('The image dimensions are not supported.');
    return {
      id: crypto.randomUUID(),
      name: file.name || 'Pasted image',
      type: mimeType,
      width,
      height,
      blob,
      objectUrl,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function isEditableField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function imageFilesFromClipboard(event: ClipboardEvent): File[] {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
