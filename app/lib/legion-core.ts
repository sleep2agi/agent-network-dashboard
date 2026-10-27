/**
 * ANet core medallion. The mark is direction C from anet-design PR #8:
 * brand/logo/c-iso-a.svg @ ffc30cdaa278b53dbf2c40c82b646b1603a7b857.
 * Preserve its proportions and flat fills. Only the surrounding network rings
 * move; every visible part stays inside the existing circular hit/label body.
 */
type CorePalette = { bg: string; accent: string; accentFg: string };

let mark: { right: Path2D; left: Path2D; bar: Path2D } | undefined;

export function drawLegionCore(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
  palette: CorePalette, phase: number, detailed: boolean) {
  // Lazy: this module is also evaluated by Next's server renderer.
  mark ??= {
    right: new Path2D('M32 13 L45 47 L38.5 47 L32 28.5 Z'),
    left: new Path2D('M32 13 L19 47 L25.5 47 L32 28.5 Z'),
    bar: new Path2D('M24.5 35.5 h15 v4.6 h-15 Z'),
  };
  const alpha = ctx.globalAlpha;
  ctx.save();
  // Opaque housing keeps network links behind the core, rather than through A.
  ctx.fillStyle = palette.bg;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.min(2, Math.max(1.4, radius * 0.045));
  ctx.stroke();

  if (detailed && radius >= 14) {
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const start = phase + i * Math.PI * 2 / 3;
      ctx.globalAlpha = alpha * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.87, start, start + Math.PI * 0.42);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(x + Math.cos(start) * radius * 0.87, y + Math.sin(start) * radius * 0.87,
        Math.min(2.2, radius * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  ctx.fill();
  // Same 64×64 coordinate system as the canonical SVG, including its whitespace.
  // Keep the monogram upright while the camera and orbit indicators turn.
  ctx.translate(x - radius, y - radius);
  ctx.scale(radius / 32, radius / 32);
  ctx.fillStyle = palette.accentFg;
  ctx.fill(mark.right);
  ctx.globalAlpha = alpha * 0.82;
  ctx.fill(mark.left);
  ctx.globalAlpha = alpha * 0.95;
  ctx.fill(mark.bar);
  ctx.restore();
}
