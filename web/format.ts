/**
 * Formatting, provenance badges, HTML escaping, and shared UI constants.
 */
import type { Provenance } from '../src/types.ts';

export const CAPITAL_PRESETS = [
  100_000,
  200_000,
  500_000,
  1_000_000,
  2_000_000,
  5_000_000,
  10_000_000,
] as const;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

export function fmtSignedPct(v: number, digits = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export function fmtYuan(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(2)} 万`;
  return `${v.toFixed(0)} 元`;
}

export function fmtNum(v: number, digits = 2): string {
  return v.toFixed(digits);
}

export function cls(v: number): string {
  return v > 0 ? 'num-pos' : v < 0 ? 'num-neg' : '';
}

export function tag(kind: Provenance): string {
  const label =
    kind === 'disclosed'
      ? '真实披露数据'
      : kind === 'statistical'
        ? '历史统计估计'
        : '模型假设';
  return `<span class="tag t-${kind}">${label}</span>`;
}

export function capitalLabel(v: number): string {
  return `${v / 10_000} 万`;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}
