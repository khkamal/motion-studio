import { createRuntimeDocument } from './codeRuntime';

const CHANNEL = 'motion-code-v1';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function ensureStandaloneSvg(markup: string): string {
  const svg = markup.trim();
  if (!/^<svg\b/i.test(svg)) throw new Error('Generated frame is not an SVG document.');
  const openingTag = svg.match(/^<svg\b[^>]*>/i)?.[0] ?? '';
  return /\bxmlns\s*=/.test(openingTag) ? svg : svg.replace(/^<svg\b/i, `<svg xmlns="${SVG_NAMESPACE}"`);
}

export interface CodeFrameRenderer {
  renderFrame: (canvas: HTMLCanvasElement, timeSeconds: number, signal: AbortSignal) => Promise<void>;
  destroy: () => void;
}

/** Run generated code in the same scripts-only iframe used by preview, then rasterize deterministic SVG frames. */
export async function createCodeFrameRenderer(code: string, duration: number, fps: number, looping: boolean): Promise<CodeFrameRenderer> {
  if (!code.trim()) throw new Error('There is no generated animation code to render.');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1920px;height:1080px;opacity:0;pointer-events:none;border:0;';

  let disposed = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  let pendingFrame: { resolve: (svg: string) => void; reject: (error: Error) => void; time: number } | null = null;
  let timeout = 0;

  const failPending = (error: Error) => {
    if (pendingFrame) {
      pendingFrame.reject(error);
      pendingFrame = null;
    } else if (readyReject) {
      readyReject(error);
      readyReject = null;
    }
  };
  const onMessage = (event: MessageEvent) => {
    const message = event.data;
    if (event.source !== iframe.contentWindow || !message || message.channel !== CHANNEL) return;
    if (message.type === 'error') {
      failPending(new Error(typeof message.message === 'string' ? message.message : 'The animation runtime failed.'));
    } else if (message.type === 'ready') {
      window.clearTimeout(timeout);
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
    } else if (message.type === 'frame' && pendingFrame) {
      if (typeof message.svg !== 'string') {
        pendingFrame.reject(new Error('The animation renderer returned no SVG frame.'));
      } else if (Math.abs(Number(message.time) - pendingFrame.time) > 1e-6) {
        pendingFrame.reject(new Error('The animation renderer returned a frame for the wrong timestamp.'));
      } else {
        pendingFrame.resolve(message.svg);
      }
      pendingFrame = null;
    }
  };
  window.addEventListener('message', onMessage);

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
    timeout = window.setTimeout(() => reject(new Error('Timed out while preparing the generated animation for export.')), 15_000);
  });

  iframe.addEventListener('load', () => {
    iframe.contentWindow?.postMessage({ channel: CHANNEL, type: 'run', code, duration, fps, looping, autoplay: false }, '*');
  }, { once: true });
  iframe.srcdoc = createRuntimeDocument();
  document.body.appendChild(iframe);

  try {
    await ready;
  } catch (error) {
    window.clearTimeout(timeout);
    window.removeEventListener('message', onMessage);
    iframe.remove();
    throw error;
  }

  return {
    renderFrame(canvas, timeSeconds, signal) {
      if (disposed) return Promise.reject(new Error('The code animation renderer has been disposed.'));
      if (signal.aborted) return Promise.reject(new DOMException('Export cancelled.', 'AbortError'));
      if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > duration) return Promise.reject(new Error('Requested frame time is outside the animation duration.'));
      const svg = new Promise<string>((resolve, reject) => {
        const onAbort = () => {
          pendingFrame = null;
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('Export cancelled.', 'AbortError'));
        };
        pendingFrame = {
          time: timeSeconds,
          resolve: (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
          reject: (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
        };
        signal.addEventListener('abort', onAbort, { once: true });
        iframe.contentWindow?.postMessage({ channel: CHANNEL, type: 'frame', time: timeSeconds }, '*');
      });
      return svg.then(async (markup) => {
        if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
        const image = new Image();
        const standaloneSvg = ensureStandaloneSvg(markup);
        const url = URL.createObjectURL(new Blob([standaloneSvg], { type: 'image/svg+xml;charset=utf-8' }));
        try {
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Could not rasterize a generated SVG frame for export.'));
            image.src = url;
          });
          if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
          const context = canvas.getContext('2d', { alpha: true });
          if (!context) throw new Error('This browser could not create the export canvas context.');
          context.clearRect(0, 0, canvas.width, canvas.height);
          const sourceWidth = image.naturalWidth || canvas.width;
          const sourceHeight = image.naturalHeight || canvas.height;
          const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        } finally {
          URL.revokeObjectURL(url);
        }
      });
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(timeout);
      iframe.contentWindow?.postMessage({ channel: CHANNEL, type: 'stop' }, '*');
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}
