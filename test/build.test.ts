import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { trimDataset } from '../src/cli/build.ts';

/**
 * The page can only compute with what survives trimming. A field that exists
 * in data/derived/dataset.json but is dropped by the whitelist silently
 * degrades to a fallback in the browser (this exact bug once froze every
 * method's dividend yield at the book average). This test pins the contract:
 * everything compute() reads must be present in the trimmed payload.
 */
describe('trimmed dataset contract', () => {
  const full = {
    snapshot: { period: '2025Q4', asOf: '2025-12-31', holdings: [] },
    snapshots: [],
    nav: [],
    prices: {},
    ipoSample: [{ code: 'x' }],
    tax: { etfEffectiveRate: 7.65 },
    dividend: { portfolioDividendYieldPct: 3.34 },
    yieldsByMethod: { top5_weighted: 4.87 },
    fees: { totalPct: 0.2 },
    etfIpo: {},
    etfIpoContributionPct: 0.035,
    fundTotalReturnPct: 16.09,
    fundAnnualisedReturnPct: 9.71,
    fundMaxDrawdownPct: -24.45,
    fundSharpe: 0.5,
    trackingErrorPct: 9.76,
    betaGapProxy: 0.38,
    meta: {},
    backtests: {
      top5_weighted: {
        label: 'Top5',
        curve: [{ date: '2026-01-01', value: 1 }],
        fundCurve: [{ date: '2026-01-01', value: 1 }],
      },
    },
  };

  const t = trimDataset(full as unknown as Record<string, unknown>);

  test('model inputs survive trimming', () => {
    const d = t as Record<string, unknown>;
    assert.ok(d['snapshot'], 'snapshot');
    assert.ok(d['ipoSample'], 'ipoSample');
    assert.ok(d['yieldsByMethod'], 'yieldsByMethod');
    assert.equal((d['tax'] as Record<string, unknown>)['etfEffectiveRate'], 7.65);
    assert.equal((d['dividend'] as Record<string, unknown>)['portfolioDividendYieldPct'], 3.34);
    assert.equal((d['fees'] as Record<string, unknown>)['totalPct'], 0.2);
    for (const k of ['etfIpoContributionPct', 'fundAnnualisedReturnPct', 'trackingErrorPct', 'betaGapProxy']) {
      assert.ok(d[k] !== undefined, k);
    }
    assert.equal((d['yieldsByMethod'] as Record<string, unknown>)['top5_weighted'], 4.87);
  });

  test('backtest curves survive with their stats', () => {
    const d = t as unknown as { backtests: Record<string, Record<string, unknown>> };
    const b = d.backtests['top5_weighted'];
    assert.ok(b, 'backtest entry kept');
    assert.equal(b?.['label'], 'Top5');
    assert.ok(Array.isArray(b?.['curve']) && (b?.['curve'] as unknown[]).length === 1);
  });

  test('heavy raw-only fields are dropped', () => {
    const d = t as Record<string, unknown>;
    assert.ok(!('prices' in d), 'prices must not ship to the page');
    assert.ok(!('snapshots' in d), 'full snapshot list must not ship to the page');
    assert.ok(!('nav' in d), 'raw NAV must not ship to the page');
  });
});
