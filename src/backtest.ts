/**
 * Out-of-sample backtest of a replicated basket against the fund's own NAV.
 *
 * Methodology note, because this is where quant hobbyism usually goes wrong:
 * we never use a period's own holdings to predict that period. We take the
 * weights *as disclosed for that period* and hold them to the next disclosure,
 * then compare the realised path against NAV over the same days. A Top10 that
 * "beat the ETF last quarter" is therefore not evidence of anything, and the
 * rolling table in the UI is what exposes that.
 *
 * The other thing worth getting right: the basket and the fund must be aligned
 * on *dates*, not on array position. Constituents list on different calendars,
 * so any day a name is unpriced has to drop out of both series together.
 */
import type { Holding, HoldingsSnapshot, NavPoint, PriceSeries } from './types.ts';

export interface AlignedSeries {
  dates: string[];
  values: number[];
}

/** Forward-adjusted closes indexed by date, for O(1) lookup. */
export function priceMap(series: PriceSeries | undefined): Map<string, number> | null {
  if (!series) return null;
  const m = new Map<string, number>();
  series.dates.forEach((d, i) => m.set(d, series.closes[i] as number));
  return m;
}

/**
 * Weighted portfolio value on each requested date.
 *
 * A date is emitted only when every constituent is priced, because a partial
 * basket would understate the value and inject fake jumps on re-entry.
 */
export function portfolioValueSeries(
  maps: Array<Map<string, number> | null>,
  weights: number[],
  dates: string[],
): AlignedSeries {
  const out: AlignedSeries = { dates: [], values: [] };
  for (const d of dates) {
    let v = 0;
    let ok = true;
    for (let i = 0; i < maps.length; i++) {
      const p = maps[i]?.get(d);
      if (p === undefined) { ok = false; break; }
      v += p * (weights[i] as number);
    }
    if (!ok) continue;
    out.dates.push(d);
    out.values.push(v);
  }
  return out;
}

export interface ReturnSeries {
  dates: string[];
  rets: number[];
}

export function toReturns(s: AlignedSeries): ReturnSeries {
  const dates: string[] = [];
  const rets: number[] = [];
  for (let i = 1; i < s.values.length; i++) {
    const a = s.values[i - 1] as number;
    const b = s.values[i] as number;
    if (a === 0) continue;
    dates.push(s.dates[i] as string);
    rets.push(b / a - 1);
  }
  return { dates, rets };
}

export function navSeries(nav: NavPoint[]): AlignedSeries {
  return { dates: nav.map((n) => n.date), values: nav.map((n) => n.nav) };
}

/** Keep only dates present in both series, preserving order. */
export function alignReturns(a: ReturnSeries, b: ReturnSeries): [ReturnSeries, ReturnSeries] {
  const bMap = new Map(b.dates.map((d, i) => [d, b.rets[i] as number]));
  const dates: string[] = [];
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 0; i < a.dates.length; i++) {
    const d = a.dates[i] as string;
    const bv = bMap.get(d);
    if (bv === undefined) continue;
    dates.push(d);
    ra.push(a.rets[i] as number);
    rb.push(bv);
  }
  return [{ dates, rets: ra }, { dates, rets: rb }];
}

export interface SeriesStats {
  totalReturnPct: number;
  annualisedReturnPct: number;
  volatilityPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  observations: number;
}

export function computeStats(values: number[], rfAnnualPct = 1.5): SeriesStats | null {
  if (values.length < 2) return null;
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  if (first <= 0 || last <= 0) return null;

  const totalReturnPct = (last / first - 1) * 100;
  const years = values.length / 244;
  const annualisedReturnPct =
    years > 0.05 ? (Math.pow(last / first, 1 / years) - 1) * 100 : totalReturnPct;

  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) rets.push((values[i] as number) / (values[i - 1] as number) - 1);
  const n = rets.length || 1;
  const mean = rets.reduce((s, r) => s + r, 0) / n;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, n - 1);
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(244) * 100;
  const sharpe = volatilityPct > 0 ? (annualisedReturnPct - rfAnnualPct) / volatilityPct : 0;

  let peak = first;
  let maxDd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    maxDd = Math.min(maxDd, v / peak - 1);
  }
  return {
    totalReturnPct,
    annualisedReturnPct,
    volatilityPct,
    sharpe,
    maxDrawdownPct: maxDd * 100,
    observations: values.length,
  };
}

export function statsFromReturns(r: ReturnSeries): SeriesStats | null {
  return computeStats([1, ...cumulative(r.rets)]);
}

export function cumulative(rets: number[]): number[] {
  let v = 1;
  const out: number[] = [];
  for (const r of rets) {
    v *= 1 + r;
    out.push(v);
  }
  return out;
}

export interface Regression {
  beta: number;
  alphaPct: number;
  correlation: number;
  trackingErrorPct: number;
}

/** OLS of basket returns on fund returns, plus annualised tracking error. */
export function regress(basket: ReturnSeries, fund: ReturnSeries): Regression {
  const n = Math.min(basket.rets.length, fund.rets.length);
  if (n < 30) return { beta: 0, alphaPct: 0, correlation: 0, trackingErrorPct: 0 };

  const x = fund.rets.slice(0, n);
  const y = basket.rets.slice(0, n);
  const mx = x.reduce((s, r) => s + r, 0) / n;
  const my = y.reduce((s, r) => s + r, 0) / n;

  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    cov += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  const beta = varX > 0 ? cov / varX : 0;
  const correlation = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;

  const active = x.map((_, i) => (y[i] as number) - (x[i] as number));
  const mActive = active.reduce((s, r) => s + r, 0) / n;
  const te = Math.sqrt(active.reduce((s, r) => s + (r - mActive) ** 2, 0) / Math.max(1, n - 1)) * Math.sqrt(244) * 100;
  const alphaPct = (my - beta * mx) * 244 * 100;

  return { beta, alphaPct, correlation, trackingErrorPct: te };
}

/** |w_basket - w_fund| summed over all names, halved. */
export function activeSharePct(
  basket: Array<{ code: string; weightPct: number }>,
  fundHoldings: Holding[],
): number {
  const fundMap = new Map(fundHoldings.map((h) => [h.code, h.weightPct]));
  const basketMap = new Map(basket.map((w) => [w.code, w.weightPct]));
  let sum = 0;
  for (const code of new Set([...fundMap.keys(), ...basketMap.keys()])) {
    sum += Math.abs((basketMap.get(code) ?? 0) - (fundMap.get(code) ?? 0));
  }
  return sum / 2;
}

export interface WindowAttribution {
  period: string;
  /** Constituent count actually used in this window. */
  names: number;
  start: string;
  end: string;
  basketReturnPct: number;
  fundReturnPct: number;
  tradingDays: number;
}

export interface MethodBacktest {
  label: string;
  totalReturnPct: number;
  annualisedReturnPct: number;
  volatilityPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  trackingErrorPct: number;
  beta: number;
  alphaPct: number;
  correlation: number;
  activeSharePct: number;
  observations: number;
  windows: number;
  /** Windows with more than 10 names, i.e. interim/annual full disclosure. */
  fullWindows: number;
  /** Per-window basket vs fund, so a gap can be localised instead of wondered at. */
  attribution: WindowAttribution[];
  /** Cumulative basket index, for the chart. */
  curve: Array<{ date: string; value: number }>;
  /** Fund NAV curve on the same dates, normalised to 1. */
  fundCurve: Array<{ date: string; value: number }>;
  notes: string[];
}

/**
 * Evaluate one replication method over consecutive disclosure windows.
 *
 * Windows where disclosure covers fewer names than the method needs are still
 * evaluated but recorded, because a "Top30" built from a 10-name disclosure is
 * not a Top30 and the report should say so rather than quietly understate risk.
 */
export function backtestMethod(args: {
  label: string;
  build: (holdings: Holding[]) => Array<{ code: string; weightPct: number }> | null;
  snapshots: HoldingsSnapshot[];
  nav: NavPoint[];
  prices: Map<string, PriceSeries>;
  cumulativeEtfWeightPct?: number;
}): MethodBacktest | null {
  const { build, snapshots, nav, prices, label } = args;
  const notes: string[] = [];

  const usable = snapshots.filter((s) => s.holdings.length > 0);
  if (usable.length === 0 || nav.length < 30) return null;

  const navDates = nav.map((n) => n.date);
  const firstNavDate = navDates[0] ?? '';
  const lastNavDate = navDates[navDates.length - 1] ?? '';
  const fund = navSeries(nav);

  // Hold each disclosure's weights until the next disclosure.
  const segments: Array<{ holdings: Holding[]; start: string; end: string; period: string }> = [];
  for (let i = 0; i < usable.length; i++) {
    const snap = usable[i]!;
    const next = usable[i + 1];
    const start = snap.asOf > firstNavDate ? snap.asOf : firstNavDate;
    const end = next ? next.asOf : lastNavDate;
    if (start < end) segments.push({ holdings: snap.holdings, start, end, period: snap.period });
  }

  const curve: Array<{ date: string; value: number }> = [];
  const fundCurve: Array<{ date: string; value: number }> = [];
  const attribution: WindowAttribution[] = [];
  const allBasket: ReturnSeries = { dates: [], rets: [] };
  const allFund: ReturnSeries = { dates: [], rets: [] };
  let windows = 0;
  let fullWindows = 0;
  let lastValue = 1;
  let lastFundValue = 1;

  for (const seg of segments) {
    const weights = build(seg.holdings);
    if (!weights || weights.length === 0) continue;

    const dates = navDates.filter((d) => d >= seg.start && d <= seg.end);
    if (dates.length < 30) continue;
    if (seg.holdings.length < weights.length) {
      notes.push(`${seg.period} 期仅披露 ${seg.holdings.length} 只，该窗口实际按 ${weights.length} 只计算`);
    }

    const maps = weights.map((w) => priceMap(prices.get(w.code)));
    const basketVals = portfolioValueSeries(maps, weights.map((w) => w.weightPct), dates);

    // The fund series must be indexed by the *same* dates the basket produced.
    // Building it from the window's own date list instead silently pairs each
    // return with the wrong NAV, which drives correlation toward zero.
    const navMap = new Map(nav.map((n) => [n.date, n.nav]));
    const fundVals: AlignedSeries = { dates: [], values: [] };
    for (const d of basketVals.dates) {
      const v = navMap.get(d);
      if (v === undefined) continue;
      fundVals.dates.push(d);
      fundVals.values.push(v);
    }
    if (basketVals.values.length < 30 || fundVals.values.length < 30) continue;

    const [ab, af] = alignReturns(toReturns(basketVals), toReturns(fundVals));
    if (ab.rets.length < 20) continue;

    const bCum = ab.rets.reduce((v, r) => v * (1 + r), 1);
    const fCum = af.rets.reduce((v, r) => v * (1 + r), 1);
    attribution.push({
      period: seg.period,
      names: weights.length,
      start: seg.start,
      end: seg.end,
      basketReturnPct: (bCum - 1) * 100,
      fundReturnPct: (fCum - 1) * 100,
      tradingDays: ab.rets.length,
    });

    // Chain into the overall curve using the window's own compounding.
    let v = lastValue;
    for (let i = 0; i < ab.rets.length; i++) {
      v *= 1 + (ab.rets[i] as number);
      curve.push({ date: ab.dates[i] as string, value: v });
    }
    let fv = lastFundValue;
    for (let i = 0; i < af.rets.length; i++) {
      fv *= 1 + (af.rets[i] as number);
      fundCurve.push({ date: af.dates[i] as string, value: fv });
    }
    lastValue = v;
    lastFundValue = fv;

    allBasket.rets.push(...ab.rets);
    allBasket.dates.push(...ab.dates);
    allFund.rets.push(...af.rets);
    allFund.dates.push(...af.dates);
    windows++;
    if (seg.holdings.length > 10) fullWindows++;
  }

  const totalObs = allBasket.rets.length;
  if (totalObs < 40) {
    notes.push(`样本不足（${totalObs} 个交易日），不给出结论`);
    return null;
  }

  const stats = computeStats([1, ...cumulative(allBasket.rets)])!;
  const [ab2, af2] = alignReturns(allBasket, allFund);
  const reg = regress(ab2, af2);

  // Active share is measured against the most complete disclosure, not the
  // latest partial one: scoring a full-book replication against a 10-name
  // quarter-end list would report a large "active share" that is pure missing
  // data, not portfolio choice.
  const richest = [...usable].sort(
    (a, b) => b.holdings.length - a.holdings.length || b.asOf.localeCompare(a.asOf),
  )[0]!;
  const builtRichest = build(richest.holdings) ?? [];

  return {
    label,
    totalReturnPct: stats.totalReturnPct,
    annualisedReturnPct: stats.annualisedReturnPct,
    volatilityPct: stats.volatilityPct,
    sharpe: stats.sharpe,
    maxDrawdownPct: stats.maxDrawdownPct,
    trackingErrorPct: reg.trackingErrorPct,
    beta: reg.beta,
    alphaPct: reg.alphaPct,
    correlation: reg.correlation,
    activeSharePct: activeSharePct(builtRichest, richest.holdings),
    observations: totalObs,
    windows,
    fullWindows,
    attribution,
    curve,
    fundCurve,
    notes: [...new Set(notes)],
  };
}
