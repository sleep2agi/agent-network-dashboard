export interface ChatWindowRect { x: number; y: number; width: number; height: number }
export const CHAT_COLLAPSED_HEIGHT = 66;

/** Bounds are the visible part of the host, in the host's coordinate space. */
export function fitChatWindow(rect: ChatWindowRect, bounds: ChatWindowRect, minimized = false): ChatWindowRect {
  const width = Math.min(Math.max(300, rect.width), bounds.width);
  const height = Math.min(Math.max(320, rect.height), bounds.height);
  const visibleWidth = minimized ? Math.min(width, 340) : width;
  const visibleHeight = minimized ? Math.min(CHAT_COLLAPSED_HEIGHT, bounds.height) : height;
  return { width, height,
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - visibleWidth, rect.x)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - visibleHeight, rect.y)) };
}

export function initialChatWindow(bounds: ChatWindowRect): ChatWindowRect {
  const width = Math.min(480, bounds.width);
  const height = Math.min(620, bounds.width < 640 ? bounds.height * .72 : bounds.height * .86);
  return fitChatWindow({ x: bounds.x + bounds.width - width, y: bounds.y + bounds.height - height, width, height }, bounds);
}
