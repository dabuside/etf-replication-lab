import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { delocalize } from '../src/cli/transpile.ts';
import { priceOnOrBefore } from '../src/derive.ts';
import { methodRequiredCount } from '../src/domain/portfolio.ts';
import { computeDrawdownSeries } from '../web/charts.ts';
import { escapeHtml } from '../web/format.ts';

describe('escapeHtml', () => {
  test('escapes all five HTML metacharacters', () => {
    assert.equal(
      escapeHtml(`<script>alert("x" & 'y')</script>`),
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
    );
  });

  test('leaves plain Chinese and numeric labels untouched', () => {
    assert.equal(escapeHtml('华夏国证自由现金流 ETF (159201)'), '华夏国证自由现金流 ETF (159201)');
  });
});

describe('computeDrawdownSeries', () => {
  test('computes running peak-to-trough drawdowns in O(N)', () => {
    const pts = [
      { date: '2025-03-01', value: 1.0 },
      { date: '2025-03-02', value: 1.2 },
      { date: '2025-03-03', value: 0.9 },
      { date: '2025-03-04', value: 1.2 },
      { date: '2025-03-05', value: 1.08 },
    ];
    const dd = computeDrawdownSeries(pts);
    assert.equal(dd.length, 5);
    assert.equal(dd[0]?.v, 0);
    assert.equal(dd[1]?.v, 0);
    assert.ok(Math.abs((dd[2]?.v ?? 0) - -25) < 1e-9);
    assert.equal(dd[3]?.v, 0);
    assert.ok(Math.abs((dd[4]?.v ?? 0) - -10) < 1e-9);
  });

  test('handles empty input without throwing', () => {
    assert.deepEqual(computeDrawdownSeries([]), []);
  });
});

describe('methodRequiredCount', () => {
  test('returns exact constituent thresholds for each replication method', () => {
    assert.equal(methodRequiredCount('buy_etf'), 0);
    assert.equal(methodRequiredCount('top5_weighted'), 5);
    assert.equal(methodRequiredCount('top10_weighted'), 10);
    assert.equal(methodRequiredCount('top10_equal'), 10);
    assert.equal(methodRequiredCount('top20_weighted'), 20);
    assert.equal(methodRequiredCount('top30_normalized'), 30);
    assert.equal(methodRequiredCount('full'), Number.POSITIVE_INFINITY);
  });
});

describe('priceOnOrBefore binary search edges', () => {
  const series = {
    code: '600000',
    dates: ['2025-01-02', '2025-01-05', '2025-01-10'],
    closes: [10, 12, 15],
  };

  test('matches first, middle, exact, gap, and after-last dates', () => {
    assert.equal(priceOnOrBefore(series, '2025-01-01'), null);
    assert.equal(priceOnOrBefore(series, '2025-01-02'), 10);
    assert.equal(priceOnOrBefore(series, '2025-01-04'), 10);
    assert.equal(priceOnOrBefore(series, '2025-01-05'), 12);
    assert.equal(priceOnOrBefore(series, '2025-01-08'), 12);
    assert.equal(priceOnOrBefore(series, '2025-12-31'), 15);
  });
});

describe('delocalize bundler helper', () => {
  test('strips multi-line imports and export blocks while preserving declarations', () => {
    const sample = [
      'import {',
      '  foo,',
      '  bar,',
      "} from './other.ts';",
      'export type Foo = number;',
      'export function add(a, b) { return a + b; }',
      'export {',
      '  add,',
      '};',
    ].join('\n');
    const out = delocalize(sample);
    assert.ok(!out.includes('import '));
    assert.ok(!out.includes('export '));
    assert.ok(out.includes('function add(a, b)'));
  });
});
