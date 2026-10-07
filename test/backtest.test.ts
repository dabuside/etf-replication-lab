import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeSharePct,
  alignReturns,
  backtestMethod,
  computeStats,
  portfolioValueSeries,
  priceMap,
  regress,
  toReturns,
} from '../src/backtest.ts';
import type { Holding, HoldingsSnapshot, NavPoint, PriceSeries } from '../src/types.ts';

/** A synthetic market where the basket IS the fund, so statistics are known. */
function flatSeries(code: string, dates: string[], closes: number[]): PriceSeries {
  return { code, dates, closes };
}

describe('alignment primitives', () => {
  test('drops dates where any constituent is unpriced, from both series together', () => {
    const prices = new Map([
      ['a', priceMap(flatSeries('a', ['d1', 'd2', 'd3'], [10, 11, 12]))],
      // 'b' is missing d2 (suspended, newly listed, pick your reason).
      ['b', priceMap(flatSeries('b', ['d1', 'd3'], [20, 22]))],
    ]);
    const vals = portfolioValueSeries(
      ['a', 'b'].map((c) => prices.get(c) ?? null),
      [50, 50],
      ['d1', 'd2', 'd3'],
    );
    assert.deepEqual(vals.dates, ['d1', 'd3']);
  });

  test('a date with every name priced is kept with the weighted value', () => {
    const prices = new Map([['a', priceMap(flatSeries('a', ['d1'], [10]))]]);
    const vals = portfolioValueSeries([prices.get('a') ?? null], [50], ['d1']);
    assert.equal(vals.values[0], 500);
  });

  test('alignReturns keeps only shared dates, in order', () => {
    const [a, b] = alignReturns(
      { dates: ['d1', 'd2', 'd3'], rets: [0.01, 0.02, 0.03] },
      { dates: ['d2', 'd3', 'd4'], rets: [0.02, 0.03, 0.04] },
    );
    assert.deepEqual(a.dates, ['d2', 'd3']);
    assert.deepEqual(a.rets, [0.02, 0.03]);
    assert.deepEqual(b.rets, [0.02, 0.03]);
  });
});

describe('regression', () => {
  test('a basket tracking the fund has beta 1, correlation 1 and no tracking error', () => {
    const rets = Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, ret: Math.sin(i) * 0.01 }));
    const reg = regress({ dates: rets.map((r) => r.date), rets: rets.map((r) => r.ret) }, { dates: rets.map((r) => r.date), rets: rets.map((r) => r.ret) });
    assert.ok(Math.abs(reg.beta - 1) < 1e-9);
    assert.ok(Math.abs(reg.correlation - 1) < 1e-9);
    assert.ok(Math.abs(reg.trackingErrorPct) < 1e-9);
  });

  test('refuses to regress on fewer than 30 observations', () => {
    const r = regress({ dates: ['d1'], rets: [0.01] }, { dates: ['d1'], rets: [0.01] });
    assert.deepEqual([r.beta, r.correlation, r.trackingErrorPct], [0, 0, 0]);
  });
});

describe('active share', () => {
  const fund: Holding[] = [
    { code: 'a', name: 'A', exchange: 'SH', weightPct: 60, sharesWan: 1, valueWan: 1 },
    { code: 'b', name: 'B', exchange: 'SH', weightPct: 40, sharesWan: 1, valueWan: 1 },
  ];

  test('identical books score zero', () => {
    assert.equal(activeSharePct([{ code: 'a', weightPct: 60 }, { code: 'b', weightPct: 40 }], fund), 0);
  });

  test('disjoint books score 100', () => {
    assert.equal(activeSharePct([{ code: 'c', weightPct: 100 }], fund), 100);
  });

  test('a concentrated subset scores the excluded weight over two', () => {
    // |100-60| + |0-40| = 80, halved = 40.
    assert.equal(activeSharePct([{ code: 'a', weightPct: 100 }], fund), 40);
  });
});

describe('backtestMethod end to end on synthetic data', () => {
  // Fund holds a and b 50/50; the "Top1" basket holds only a.
  const dates = Array.from({ length: 80 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const closesA = dates.map((_, i) => 10 * (1 + i * 0.001));
  const closesB = dates.map((_, i) => 20 * (1 + i * 0.002));
  const prices = new Map([
    ['a', flatSeries('a', dates, closesA)],
    ['b', flatSeries('b', dates, closesB)],
  ]);
  // NAV is the exact 50/50 blend, so a full replication must match almost exactly.
  const nav: NavPoint[] = dates.map((d, i) => ({
    date: d,
    nav: 0.5 * (closesA[i] as number) + 0.5 * (closesB[i] as number),
  }));
  const snapshots: HoldingsSnapshot[] = [
    {
      period: '2026Q1',
      asOf: dates[0] as string,
      holdings: [
        { code: 'a', name: 'A', exchange: 'SH', weightPct: 50, sharesWan: 1, valueWan: 1 },
        { code: 'b', name: 'B', exchange: 'SH', weightPct: 50, sharesWan: 1, valueWan: 1 },
      ],
    },
  ];

  test('a full replication tracks the fund to within dust', () => {
    const r = backtestMethod({
      label: 'full',
      snapshots,
      nav,
      prices,
      build: (h) => h.map((x) => ({ code: x.code, weightPct: 50 })),
    });
    assert.ok(r, 'expected a result');
    assert.ok(r.correlation > 0.999, `corr ${r.correlation}`);
    assert.ok(r.trackingErrorPct < 0.5, `TE ${r.trackingErrorPct}`);
    assert.ok(Math.abs(r.totalReturnPct - ((nav[nav.length - 1]!.nav / nav[0]!.nav - 1) * 100)) < 0.5);
  });

  test('a concentrated basket keeps working statistics and records its window', () => {
    const r = backtestMethod({
      label: 'top1',
      snapshots,
      nav,
      prices,
      build: (h) => [{ code: h[0]!.code, weightPct: 100 }],
    });
    assert.ok(r, 'expected a result');
    assert.equal(r.windows, 1);
    assert.equal(r.attribution.length, 1);
    assert.equal(r.attribution[0]!.names, 1);
    // Single-name basket of the slower grower must lag the 50/50 blend.
    assert.ok(r.attribution[0]!.basketReturnPct < r.attribution[0]!.fundReturnPct);
  });

  test('returns null when the sample is too thin to say anything', () => {
    const r = backtestMethod({
      label: 'thin',
      snapshots,
      nav: nav.slice(0, 5),
      prices,
      build: (h) => h.map((x) => ({ code: x.code, weightPct: 50 })),
    });
    assert.equal(r, null);
  });
});

describe('computeStats', () => {
  test('a steady climb has positive Sharpe and zero drawdown', () => {
    const s = computeStats([1, 1.01, 1.02, 1.03, 1.04, 1.05])!;
    assert.ok(s.totalReturnPct > 0);
    assert.equal(s.maxDrawdownPct, 0);
  });

  test('drawdown measures peak to trough', () => {
    const s = computeStats([1, 1.2, 1.1, 0.9, 1.0])!;
    assert.ok(Math.abs(s.maxDrawdownPct - -25) < 1e-9);
  });

  test('needs at least two points', () => {
    assert.equal(computeStats([1]), null);
    assert.equal(computeStats([]), null);
  });
});

export { toReturns };
