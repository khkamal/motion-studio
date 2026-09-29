import type { BrowserCapabilities } from '../types/motion';

export interface SegmentationDeviceProfile {
  webAssembly: boolean;
  imageBitmap: boolean;
  canvas: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  saveData: boolean;
  effectiveType?: string;
}

type NavigatorWithResourceHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

export function readSegmentationDeviceProfile(): SegmentationDeviceProfile {
  const browserNavigator = typeof navigator === 'undefined' ? null : navigator as NavigatorWithResourceHints;
  return {
    webAssembly: typeof WebAssembly !== 'undefined',
    imageBitmap: typeof createImageBitmap === 'function',
    canvas: typeof document !== 'undefined' && typeof document.createElement === 'function',
    hardwareConcurrency: browserNavigator?.hardwareConcurrency ?? 0,
    deviceMemoryGb: browserNavigator?.deviceMemory,
    saveData: browserNavigator?.connection?.saveData ?? false,
    effectiveType: browserNavigator?.connection?.effectiveType,
  };
}

/**
 * Segmentation is optional and runs once per subject image, not per frame. Skip it on browsers
 * without the required APIs and on clearly constrained/data-saving devices so the stable local
 * fallback stays responsive.
 */
export function canRunLocalSegmentation(profile = readSegmentationDeviceProfile()): boolean {
  if (!profile.webAssembly || !profile.imageBitmap || !profile.canvas) return false;
  if (profile.hardwareConcurrency > 0 && profile.hardwareConcurrency < 2) return false;
  if (profile.deviceMemoryGb !== undefined && profile.deviceMemoryGb < 2) return false;
  if (profile.saveData || profile.effectiveType === 'slow-2g' || profile.effectiveType === '2g') return false;
  return true;
}

export async function detectBrowserCapabilities(): Promise<BrowserCapabilities> {
  const canvas = document.createElement('canvas');
  const gl2 = canvas.getContext('webgl2');
  const gl = gl2 ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
  const webCodecsAvailable = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  let supportedMp4 = false;
  if (webCodecsAvailable) {
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec: 'avc1.42001f', width: 1280, height: 720, framerate: 30, bitrate: 2_500_000,
      });
      supportedMp4 = Boolean(result.supported);
    } catch {
      supportedMp4 = false;
    }
  }
  const supportedWebm = typeof MediaRecorder !== 'undefined' && [
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
  ].some((type) => MediaRecorder.isTypeSupported(type));
  gl2?.getExtension('WEBGL_lose_context')?.loseContext();
  if (!gl2) (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  const segmentationProfile = readSegmentationDeviceProfile();
  return {
    webgl: Boolean(gl),
    webgl2: Boolean(gl2),
    webCodecs: webCodecsAvailable,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    supportedMp4,
    supportedWebm,
    subjectSegmentation: canRunLocalSegmentation(segmentationProfile),
    hardwareConcurrency: segmentationProfile.hardwareConcurrency,
    deviceMemoryGb: segmentationProfile.deviceMemoryGb,
  };
}
