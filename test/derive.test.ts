import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { basketYield, priceOnOrBefore } from '../src/derive.ts';
import type { DividendRecord } from '../src/scrape/stocks.ts';
import type { PriceSeries } from '../src/types.ts';

function series(code: string, dates: string[], closes: number[]): PriceSeries {
  return { code, dates, closes };
}

function div(code: string, exDate: string, dps: number): DividendRecord {
  return { code, exDate, dpsPreTax: dps };
}

describe('priceOnOrBefore', () => {
  const s = series('a', ['2025-12-29', '2025-12-30', '2025-12-31'], [10, 11, 12]);

  test('takes the last close on or before the date', () => {
    assert.equal(priceOnOrBefore(s, '2025-12-31'), 12);
    assert.equal(priceOnOrBefore(s, '2026-01-05'), 12);
  });

  test('skips holidays by falling back to the previous close', () => {
    // 2025-12-28 is a Sunday; the Friday close applies.
    assert.equal(priceOnOrBefore(series('a', ['2025-12-26', '2025-12-29'], [9, 10]), '2025-12-28'), 9);
  });

  test('returns null before the series starts or without a series', () => {
    assert.equal(priceOnOrBefore(s, '2020-01-01'), null);
    assert.equal(priceOnOrBefore(undefined, '2025-12-31'), null);
  });
});

describe('basketYield', () => {
  const dividends: Record<string, DividendRecord[]> = {
    hi: [div('hi', '2025-06-10', 0.5)],
    lo: [div('lo', '2025-06-10', 0.1)],
    nopay: [],
  };
  const prices = new Map<string, PriceSeries>([
    ['hi', series('hi', ['2025-12-31'], [10])], // 5.0%
    ['lo', series('lo', ['2025-12-31'], [10])], // 1.0%
    ['nopay', series('nopay', ['2025-12-31'], [10])],
  ]);
  const base = { dividends, prices, startDate: '2025-01-01', endDate: '2025-12-31', priceDate: '2025-12-31' };

  test('weights the per-stock trailing yields', () => {
    const y = basketYield({
      ...base,
      weights: [
        { code: 'hi', weightPct: 50 },
        { code: 'lo', weightPct: 50 },
      ],
    });
    assert.ok(Math.abs(y.yieldPct - 3.0) < 1e-9);
    assert.equal(y.payingNames, 2);
    assert.equal(y.totalNames, 2);
  });

  test('a concentrated high-dividend basket yields more than a broad one', () => {
    const top = basketYield({ ...base, weights: [{ code: 'hi', weightPct: 100 }] });
    const broad = basketYield({
      ...base,
      weights: [
        { code: 'hi', weightPct: 50 },
        { code: 'lo', weightPct: 25 },
        { code: 'nopay', weightPct: 25 },
      ],
    });
    assert.ok(top.yieldPct > broad.yieldPct);
    assert.ok(Math.abs(top.yieldPct - 5.0) < 1e-9);
    assert.ok(Math.abs(broad.yieldPct - 2.75) < 1e-9);
    assert.equal(broad.payingNames, 2);
  });

  test('only ex-dates inside the window count', () => {
    const y = basketYield({
      ...base,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      weights: [{ code: 'hi', weightPct: 100 }],
    });
    assert.equal(y.yieldPct, 0);
    assert.equal(y.payingNames, 0);
  });

  test('a missing price contributes zero instead of NaN', () => {
    const y = basketYield({
      ...base,
      weights: [
        { code: 'hi', weightPct: 50 },
        { code: 'ghost', weightPct: 50 },
      ],
    });
    assert.ok(Number.isFinite(y.yieldPct));
    assert.ok(Math.abs(y.yieldPct - 2.5) < 1e-9);
  });
});
