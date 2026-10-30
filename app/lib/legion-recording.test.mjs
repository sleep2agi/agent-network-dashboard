import { describe, expect, test } from 'bun:test';
import {
  LOOP_DURATION_MS, EXPORT_WIDTH, EXPORT_HEIGHT, loopYaw, loopProgress, containRect,
  pickRecordingMime, recordingExtension, recordingFileName,
  exportDimensions, EXPORT_1080_WIDTH, EXPORT_1080_HEIGHT,
} from './legion-recording';

describe('军团 3D 录屏模式 — 循环几何与容器选择', () => {
  test('一圈正好 2π：首尾相接，帧率无关', () => {
    const start = 0.37;
    expect(loopYaw(start, 0)).toBe(start);
    expect(loopYaw(start, LOOP_DURATION_MS / 2)).toBeCloseTo(start + Math.PI, 9);
    expect(loopYaw(start, LOOP_DURATION_MS)).toBeCloseTo(start + Math.PI * 2, 9);
    // 超过一圈不继续漂：导出结束时停在闭环点。
    expect(loopYaw(start, LOOP_DURATION_MS * 3)).toBeCloseTo(start + Math.PI * 2, 9);
    expect(loopYaw(start, -50)).toBe(start);
  });

  test('进度夹在 0..1，便于 UI 与取消', () => {
    expect(loopProgress(0)).toBe(0);
    expect(loopProgress(LOOP_DURATION_MS / 4)).toBeCloseTo(0.25, 9);
    expect(loopProgress(LOOP_DURATION_MS * 2)).toBe(1);
    expect(loopProgress(-1)).toBe(0);
  });

  test('1280×720 内等比放置：不拉伸、居中、留边', () => {
    expect(containRect(1280, 720, EXPORT_WIDTH, EXPORT_HEIGHT)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    const tall = containRect(720, 1280, EXPORT_WIDTH, EXPORT_HEIGHT);
    expect(tall.height).toBe(720);
    expect(tall.width).toBe(405);
    expect(tall.x).toBe(Math.round((1280 - 405) / 2));
    expect(tall.y).toBe(0);
    const wide = containRect(1920, 800, EXPORT_WIDTH, EXPORT_HEIGHT);
    expect(wide.width).toBe(1280);
    expect(wide.height).toBe(533);
    expect(wide.y).toBe(Math.round((720 - 533) / 2));
    expect(containRect(0, 0, 10, 10)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  test('优先 mp4，浏览器不支持时退 webm；全不支持返回 null', () => {
    expect(pickRecordingMime(() => true)).toBe('video/mp4;codecs=avc1.42E01E');
    expect(pickRecordingMime(m => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
    expect(pickRecordingMime(() => false)).toBeNull();
    expect(pickRecordingMime(() => { throw new Error('no MediaRecorder'); })).toBeNull();
    expect(recordingExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(recordingExtension('video/webm;codecs=vp9')).toBe('webm');
  });

  test('文件名带尺寸与时间戳，扩展名跟随容器', () => {
    const at = new Date(2026, 9, 30, 12, 5, 9);
    expect(recordingFileName('video/webm;codecs=vp9', at)).toBe('legion-3d-loop-1280x720-20261030-120509.webm');
    expect(recordingFileName('video/mp4;codecs=avc1', at)).toBe('legion-3d-loop-1280x720-20261030-120509.mp4');
  });
});

describe('export size option', () => {
  test('default stays 720p; 1080p is opt-in', () => {
    expect(exportDimensions(false)).toEqual({ width: 1280, height: 720, label: '720p' });
    expect(exportDimensions(true)).toEqual({ width: EXPORT_1080_WIDTH, height: EXPORT_1080_HEIGHT, label: '1080p' });
  });

  test('file names carry the actual frame size', () => {
    const at = new Date('2026-10-31T09:05:07');
    expect(recordingFileName('video/mp4', at)).toMatch(/^legion-3d-loop-1280x720-\d{8}-\d{6}\.mp4$/);
    expect(recordingFileName('video/mp4', at, 1920, 1080)).toMatch(/^legion-3d-loop-1920x1080-\d{8}-\d{6}\.mp4$/);
  });
});
