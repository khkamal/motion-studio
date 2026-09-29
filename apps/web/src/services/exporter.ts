import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { EditorSettings, MediaAsset, MotionPlan, VideoFormat } from '../types/motion';
import { frameTime, totalFrames } from '../engine/motionEngine';
import { createRenderRuntime, disposeRenderRuntime, renderScene } from '../engine/renderer';

export interface ExportRequest {
  asset: MediaAsset;
  plan: MotionPlan;
  settings: EditorSettings;
  format: VideoFormat;
  width: number;
  height: number;
  duration: number;
  fps: EditorSettings['fps'];
  quality: number;
  signal: AbortSignal;
  onProgress: (currentFrame: number, totalFrames: number, elapsedMs: number) => void;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  totalFrames: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  elapsedMs: number;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function qualityBitrate(width: number, height: number, fps: number, quality: number): number {
  return Math.min(60_000_000, Math.max(800_000, Math.round(width * height * fps * (0.06 + quality * 0.11))));
}

function avcCodecCandidates(width: number, height: number, fps: number): string[] {
  const edge = Math.max(width, height);
  if (edge >= 3600) return fps >= 50
    ? ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.4d0033', 'avc1.420033']
    : ['avc1.640033', 'avc1.640032', 'avc1.640028', 'avc1.4d0032', 'avc1.420032'];
  if (edge >= 2500) return fps >= 50
    ? ['avc1.640033', 'avc1.640032', 'avc1.4d0032', 'avc1.420032']
    : ['avc1.640032', 'avc1.640028', 'avc1.4d0032', 'avc1.420032'];
  if (edge >= 1900) return fps >= 50
    ? ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a']
    : ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
  return ['avc1.42001f', 'avc1.4d001f', 'avc1.42001e'];
}

function makeExportSettings(settings: EditorSettings, request: ExportRequest): EditorSettings {
  return {
    ...settings,
    width: request.width,
    height: request.height,
    duration: request.duration,
    fps: request.fps,
    export: { ...settings.export, width: request.width, height: request.height, format: request.format, quality: request.quality },
  };
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function exportMp4(sceneCanvas: HTMLCanvasElement, scene: Parameters<typeof renderScene>[0], request: ExportRequest, frames: number, startedAt: number): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('MP4 export requires WebCodecs in this browser. Choose WebM or use a supported Chromium browser.');
  const baseConfiguration: Omit<VideoEncoderConfig, 'codec'> = {
    width: sceneCanvas.width,
    height: sceneCanvas.height,
    framerate: request.fps,
    bitrate: qualityBitrate(request.width, request.height, request.fps, request.quality),
    bitrateMode: 'variable',
  };
  let supportedConfiguration: VideoEncoderConfig | null = null;
  for (const codec of avcCodecCandidates(request.width, request.height, request.fps)) {
    const candidate: VideoEncoderConfig = { ...baseConfiguration, codec };
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported) {
      supportedConfiguration = support.config ?? candidate;
      break;
    }
  }
  if (!supportedConfiguration) throw new Error('H.264 encoding is not supported at this resolution and frame rate. Choose WebM or a smaller export size.');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: request.width, height: request.height, frameRate: request.fps },
    fastStart: false,
  });
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => { encoderError = error; },
  });
  encoder.configure(supportedConfiguration);
  const frameDuration = Math.round(1_000_000 / request.fps);
  try {
    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      throwIfAborted(request.signal);
      renderScene(scene, frameTime(frameIndex, request.fps));
      const frame = new VideoFrame(sceneCanvas, {
        timestamp: Math.round(frameIndex * 1_000_000 / request.fps),
        duration: frameDuration,
      });
      encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % (request.fps * 2) === 0 });
      frame.close();
      request.onProgress(frameIndex + 1, frames, performance.now() - startedAt);
      if (encoderError) throw encoderError;
      if (encoder.encodeQueueSize > 6) {
        await new Promise<void>((resolve) => {
          const onDequeue = () => {
            encoder.removeEventListener('dequeue', onDequeue);
            resolve();
          };
          encoder.addEventListener('dequeue', onDequeue, { once: true });
        });
      }
      if (frameIndex % 2 === 1) await yieldToBrowser();
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    throwIfAborted(request.signal);
    muxer.finalize();
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      extension: 'mp4',
      totalFrames: frames,
      duration: request.duration,
      width: request.width,
      height: request.height,
      fps: request.fps,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Export cancelled.', 'AbortError'));
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Export cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function exportWebm(sceneCanvas: HTMLCanvasElement, scene: Parameters<typeof renderScene>[0], request: ExportRequest, frames: number, startedAt: number): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined' || typeof sceneCanvas.captureStream !== 'function') {
    throw new Error('WebM export is not available in this browser. Try Chrome, Edge, or Firefox with MediaRecorder support.');
  }
  const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('No supported WebM codec was found by this browser.');

  let stream = sceneCanvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  if (!track?.requestFrame) {
    stream.getTracks().forEach((entry) => entry.stop());
    stream = sceneCanvas.captureStream(request.fps);
    track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  }
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: qualityBitrate(request.width, request.height, request.fps, request.quality),
  });
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onerror = (event) => reject((event as ErrorEvent).error ?? new Error('WebM recording failed.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.start();
  const interval = 1000 / request.fps;
  const wallStart = performance.now();
  try {
    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      throwIfAborted(request.signal);
      if (frameIndex > 0) {
        const due = wallStart + frameIndex * interval;
        await wait(Math.max(0, due - performance.now()), request.signal);
      }
      renderScene(scene, frameTime(frameIndex, request.fps));
      track?.requestFrame?.();
      request.onProgress(frameIndex + 1, frames, performance.now() - startedAt);
    }
    await wait(Math.max(0, wallStart + frames * interval - performance.now()), request.signal);
    recorder.stop();
    const blob = await done;
    return {
      blob,
      mimeType,
      extension: 'webm',
      totalFrames: frames,
      duration: request.duration,
      width: request.width,
      height: request.height,
      fps: request.fps,
      elapsedMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    await done.catch(() => undefined);
    throw error;
  } finally {
    stream.getTracks().forEach((entry) => entry.stop());
  }
}

export async function exportMotionVideo(request: ExportRequest): Promise<ExportResult> {
  if (request.width < 16 || request.height < 16 || request.width > 7680 || request.height > 7680) throw new Error('Export dimensions are outside the supported range.');
  const frames = totalFrames(request.duration, request.fps);
  if (!frames || frames > 10_000) throw new Error('The selected duration and FPS create an unsupported frame count.');
  const startedAt = performance.now();
  const settings = makeExportSettings(request.settings, request);
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = request.width;
  exportCanvas.height = request.height;
  let runtime: Awaited<ReturnType<typeof createRenderRuntime>> | null = null;
  try {
    runtime = await createRenderRuntime(request.asset, request.plan, settings, undefined, request.signal);
    const scene = { canvas: exportCanvas, plan: request.plan, settings, runtime, showTransparencyGrid: false };
    throwIfAborted(request.signal);
    if (request.format === 'mp4') return await exportMp4(exportCanvas, scene, request, frames, startedAt);
    return await exportWebm(exportCanvas, scene, request, frames, startedAt);
  } finally {
    if (runtime) disposeRenderRuntime(runtime);
    exportCanvas.width = 1;
    exportCanvas.height = 1;
  }
}

export function getFrameCount(duration: number, fps: number): number {
  return totalFrames(duration, fps);
}
