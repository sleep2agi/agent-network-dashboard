/**
 * 军团 3D「演示 / 录屏模式」的纯函数。
 *
 * 为什么单独抽出来：录屏的难点不是按钮，而是**循环接缝**。镜头如果在任意
 * 帧率下按 `yaw += speed*dt` 累加，12 秒后不一定正好回到起点；导出视频的
 * 最后一帧和第一帧就会跳一下。这里把 yaw 定义成「已录时长 → 角度」的纯函数，
 * 一圈固定 2π，帧率再抖也不会漂。
 */

/** 一圈的时长。越长越慢；16s 在 PPT 里看起来是「匀速环绕」而不是「转圈」。 */
export const LOOP_DURATION_MS = 16_000;
/** 导出画幅：神明 PPT 用的 720p（默认）；1080p 仅作可选。 */
export const EXPORT_WIDTH = 1280;
export const EXPORT_HEIGHT = 720;
export const EXPORT_1080_WIDTH = 1920;
export const EXPORT_1080_HEIGHT = 1080;

/** 录制尺寸 + 文案：默认 720p，可选 1080p（PPT 侧仍要求 720p）。 */
export function exportDimensions(highDefinition: boolean): { width: number; height: number; label: string } {
  return highDefinition
    ? { width: EXPORT_1080_WIDTH, height: EXPORT_1080_HEIGHT, label: '1080p' }
    : { width: EXPORT_WIDTH, height: EXPORT_HEIGHT, label: '720p' };
}
export const EXPORT_FPS = 30;

/** 录制文件的候选容器：先 mp4（PPT 最稳），浏览器不支持时退 webm。 */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export function isSupportedMime(mime: string, isTypeSupported: (m: string) => boolean): boolean {
  try {
    return isTypeSupported(mime);
  } catch {
    return false;
  }
}

/** 第一个浏览器真的能编码的容器；都不支持时返回 null（UI 必须明确报错）。 */
export function pickRecordingMime(
  isTypeSupported: (m: string) => boolean,
  candidates: readonly string[] = MIME_CANDIDATES,
): string | null {
  for (const mime of candidates) {
    if (isSupportedMime(mime, isTypeSupported)) return mime;
  }
  return null;
}

export function recordingExtension(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** 循环角度：t=0 与 t=duration 都是 2π 的整数倍，接缝连续。 */
export function loopYaw(startYaw: number, elapsedMs: number, durationMs = LOOP_DURATION_MS): number {
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return startYaw + Math.PI * 2 * t;
}

/** 已录时长 → 0..1，供进度条使用。 */
export function loopProgress(elapsedMs: number, durationMs = LOOP_DURATION_MS): number {
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

export interface FitRect { x: number; y: number; width: number; height: number }

/**
 * 把任意比例的画布等比放进 1280×720，四周留主题底色。
 * 拉伸填满是错的：竖屏或宽屏会把圆环压成椭圆，PPT 里一眼假。
 */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): FitRect {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);
  return { x: Math.round((dstW - width) / 2), y: Math.round((dstH - height) / 2), width, height };
}

/** 给导出文件名加时间戳，避免同一个目录里互相覆盖。 */
export function recordingFileName(mime: string, at: Date, width = EXPORT_WIDTH, height = EXPORT_HEIGHT): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `legion-3d-loop-${width}x${height}-${stamp}.${recordingExtension(mime)}`;
}
