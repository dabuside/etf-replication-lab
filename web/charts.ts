/**
 * Zero-dependency Canvas line/drawdown charting with O(N) drawdown computation
 * and HiDPI (Retina) scaling.
 */
import type { LabCurvePoint } from './types.ts';

export interface ChartSeries {
  label: string;
  color: string;
  points: LabCurvePoint[];
}

export interface PlottedPoint {
  date: string;
  v: number;
}

/**
 * Convert a cumulative value curve into percentage drawdown in a single O(N)
 * pass (replaces the earlier O(N^2) nested scan).
 */
export function computeDrawdownSeries(points: LabCurvePoint[]): PlottedPoint[] {
  let peak = 0;
  return points.map((p) => {
    if (p.value > peak) peak = p.value;
    return {
      date: p.date,
      v: peak > 0 ? (p.value / peak - 1) * 100 : 0,
    };
  });
}

export function drawLineChart(
  canvasId: string,
  series: ChartSeries[],
  opts: { drawdown?: boolean } = {},
): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Preserve logical dimensions across re-renders when HiDPI scaling is active.
  const logicalW = Number(canvas.getAttribute?.('width')) || canvas.width || 860;
  const logicalH = Number(canvas.getAttribute?.('height')) || canvas.height || 300;
  const dpr =
    typeof window !== 'undefined' &&
    typeof window.devicePixelRatio === 'number' &&
    typeof ctx.setTransform === 'function'
      ? Math.min(Math.max(window.devicePixelRatio, 1), 2)
      : 1;

  if (dpr > 1 && canvas.width !== Math.round(logicalW * dpr)) {
    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
  }
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const W = logicalW;
  const H = logicalH;
  const padL = 56;
  const padR = 14;
  const padT = 22;
  const padB = 26;
  ctx.clearRect(0, 0, W, H);

  const mapped: PlottedPoint[][] = series.map((s) =>
    opts.drawdown
      ? computeDrawdownSeries(s.points)
      : s.points.map((p) => ({ date: p.date, v: p.value })),
  );

  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const m of mapped) {
    for (const q of m) {
      if (q.v < lo) lo = q.v;
      if (q.v > hi) hi = q.v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  if (hi - lo < 1e-9) hi = lo + 1;
  if (!opts.drawdown && lo > 0.9) lo = 0.9;

  const X = (i: number, n: number): number =>
    padL + ((W - padL - padR) * i) / Math.max(1, n - 1);
  const Y = (v: number): number =>
    padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  // Horizontal grid + y-axis ticks
  ctx.strokeStyle = '#e3e8ef';
  ctx.fillStyle = '#5b6b82';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4;
    const y = Y(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(opts.drawdown ? `${v.toFixed(0)}%` : v.toFixed(2), 6, y + 4);
  }

  // Series paths
  mapped.forEach((m, si) => {
    const s = series[si];
    if (!s || m.length === 0) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = si === 0 ? 2.2 : 1.5;
    ctx.beginPath();
    m.forEach((q, i) => {
      const x = X(i, m.length);
      const y = Y(q.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // X-axis date labels: drawn once (first, middle, last) to prevent overdraw
  const primary = mapped[0];
  if (primary && primary.length > 0) {
    ctx.fillStyle = '#5b6b82';
    ctx.font = '11px sans-serif';
    const first = primary[0];
    const mid = primary[Math.floor(primary.length / 2)];
    const last = primary[primary.length - 1];
    if (first) ctx.fillText(first.date.slice(0, 7), padL, H - 8);
    if (mid && primary.length >= 3) {
      const midLabel = mid.date.slice(0, 7);
      const midX = padL + (W - padL - padR) / 2 - ctx.measureText(midLabel).width / 2;
      ctx.fillText(midLabel, midX, H - 8);
    }
    if (last) ctx.fillText(last.date.slice(0, 7), W - padR - 52, H - 8);
  }

  // Legend
  ctx.font = '12px sans-serif';
  let lx = padL;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 6, 14, 8);
    ctx.fillStyle = '#1a2332';
    ctx.fillText(s.label, lx + 18, 14);
    lx += 18 + ctx.measureText(s.label).width + 22;
  }
}
