import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { effectiveDividendTaxRate, impliedTaxRate, personalLongTermRate, TAX_BANDS } from '../src/domain/tax.ts';

/**
 * 财税[2012]85号 第五条: 证券投资基金 is taxed under the SAME 差别化 regime as
 * individual shareholders, keyed to the FUND'S OWN holding period.
 *   持股 <= 1 month  -> 全额计入应纳税所得额 -> 20%
 *   1 month < t <= 1y -> 减按 50% 计入      -> 10%
 *   t > 1 year       -> 暂免               -> 0%
 */
describe('differentiated dividend tax (财税[2012]85号)', () => {
  test('exposes the three statutory bands', () => {
    assert.deepEqual(TAX_BANDS.map((b) => b.ratePct), [20, 10, 0]);
  });

  test('a personal holder past one year pays nothing', () => {
    assert.equal(personalLongTermRate(), 0);
  });

  test('band boundaries resolve by holding period', () => {
    // Exactly one month is inside the top band per the statute's "含".
    assert.equal(effectiveDividendTaxRate(0), 20);
    assert.equal(effectiveDividendTaxRate(30), 20);
    assert.equal(effectiveDividendTaxRate(31), 10);
    assert.equal(effectiveDividendTaxRate(365), 10);
    assert.equal(effectiveDividendTaxRate(366), 0);
    assert.equal(effectiveDividendTaxRate(1000), 0);
  });

  test('rejects non-finite or negative holding periods rather than guessing', () => {
    assert.throws(() => effectiveDividendTaxRate(Number.NaN), /holding period/i);
    assert.throws(() => effectiveDividendTaxRate(-1), /holding period/i);
  });
});

describe('implied ETF effective rate', () => {
  const cases: Array<{ name: string; gross: number; net: number; expected: number }> = [
    { name: 'all lots held over a year', gross: 1000, net: 1000, expected: 0 },
    { name: 'all lots in the 1m-1y band', gross: 1000, net: 900, expected: 10 },
    { name: 'all lots under a month', gross: 1000, net: 800, expected: 20 },
    { name: 'mixed book lands in between', gross: 1000, net: 870, expected: 13 },
  ];

  for (const c of cases) {
    test(c.name, () => {
      assert.equal(impliedTaxRate(c.gross, c.net), c.expected);
    });
  }

  test('a materially negative tax is rejected rather than clamped', () => {
    assert.throws(() => impliedTaxRate(1000, 1100), /net dividend/i);
  });

  test('zero gross income yields null instead of a division by zero', () => {
    assert.equal(impliedTaxRate(0, 0), null);
  });

  test('sub-cent rounding noise reads as zero tax, not a negative rate', () => {
    // Both figures are reported to the cent, so gross/net can disagree by a 分.
    assert.equal(impliedTaxRate(1_000_000, 1_000_000.5), 0);
  });

  test('a real negative rate beyond rounding still throws', () => {
    assert.throws(() => impliedTaxRate(1_000_000, 1_000_100), /net dividend/i);
  });
});
