import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compute, tradingCostPct, ASSUMPTIONS } from '../src/model.ts';
import type { Dataset } from '../src/dataset.ts';
import type { Holding, IpoRecord, ReplicationMethod } from '../src/types.ts';

const holdings: Holding[] = [
  { code: '601728', name: '中国电信', exchange: 'SH', weightPct: 8.25, sharesWan: 20603.52, valueWan: 106932.25 },
  { code: '600938', name: '中国海油', exchange: 'SH', weightPct: 8.24, sharesWan: 3930.39, valueWan: 106710.09 },
  { code: '000651', name: '格力电器', exchange: 'SZ', weightPct: 6.46, sharesWan: 5120, valueWan: 210000 },
  { code: '601633', name: '长城汽车', exchange: 'SH', weightPct: 5.94, sharesWan: 3000, valueWan: 90000 },
  { code: '600104', name: '上汽集团', exchange: 'SH', weightPct: 5.44, sharesWan: 2500, valueWan: 80000 },
];

function ipo(over: Partial<IpoRecord> = {}): IpoRecord {
  return {
    code: '688001', name: 'SAMPLE', exchange: 'SH', board: 'star',
    applyDate: '2026-03-01', listingDate: '2026-03-12',
    issuePrice: 30, onlineIssueShares: 20_000_000, onlineApplyUpper: 8_000,
    sharesPerTicket: 500, onlineMultiple: 2_500,
    firstDayOpenPremiumPct: 120, firstDayCloseChangePct: 100,
    ...over,
  };
}

function dataset(): Dataset {
  return {
    snapshot: { period: '2026Q2', asOf: '2026-06-30', holdings },
    snapshots: [],
    nav: [],
    prices: {},
    ipoSample: [
      ipo({ code: '688001', exchange: 'SH', sharesPerTicket: 500 }),
      ipo({ code: '300001', name: 'SAMPLE-SZ', exchange: 'SZ', board: 'gem', onlineIssueShares: 10_000_000, onlineMultiple: 3_000, issuePrice: 20, firstDayOpenPremiumPct: 150 }),
      ipo({ code: '688002', name: 'NO-PREMIUM', listingDate: null, firstDayOpenPremiumPct: null }),
    ],
    tax: {
      personalLongHoldRate: 0, etfEffectiveRate: 7.65,
      etfEffectiveRateLow: 0, etfEffectiveRateHigh: 20,
      provenance: 'statistical', notes: 'fixture',
    },
    dividend: { grossDividendYuan: 0, netDividendYuan: 0, portfolioDividendYieldPct: 3.34, notes: [] },
    fees: { managementFeePct: 0.15, custodyFeePct: 0.05, totalPct: 0.2 },
    etfIpoContributionPct: 0.035,
    fundTotalReturnPct: 16.09,
    fundAnnualisedReturnPct: 9.71,
    trackingErrorPct: 9.76,
    betaGapProxy: 0.38,
    meta: { generatedAt: '2026-10-08', asOf: '2026-06-30', sources: [] },
  } as unknown as Dataset;
}

const CAPITALS = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
const METHODS: ReplicationMethod[] = [
  'top5_weighted', 'top10_weighted', 'top20_weighted', 'top30_weighted',
  'top10_equal', 'full',
];

describe('compute: the two-inputs-only contract', () => {
  const ds = dataset();

  test('buy_etf is the baseline: edge identically zero, no online quota', () => {
    const r = compute(ds, 1_000_000, 'buy_etf');
    assert.equal(r.isBaseline, true);
    assert.equal(r.breakdown.totalEdgePct, 0);
    assert.equal(r.ipo.shTickets, 0);
    assert.equal(r.ipo.szTickets, 0);
    // The holder's 打新 return is the fund's own offline contribution inside NAV.
    assert.equal(r.breakdown.ipoEdgePct, ds.etfIpoContributionPct);
    assert.equal(r.ipo.expectedReturnPct, ds.etfIpoContributionPct);
    // Decomposition identity still holds: (0-0) + (x-x) + (0+0) = 0.
    const b = r.breakdown;
    assert.equal(
      (b.personalDividendTaxPct - b.etfDividendTaxPct) +
      (b.ipoEdgePct - ds.etfIpoContributionPct) +
      (b.feeSavingPct + b.tradingCostPct),
      0,
    );
  });

  test('replication methods are not the baseline', () => {
    assert.equal(compute(ds, 1_000_000, 'top10_weighted').isBaseline, false);
  });

  test('the UI calls compute with capital and method only; knobs default to neutral', () => {
    // The fourth parameter exists for the sensitivity panel but is optional:
    // omitting it must be identical to passing neutral knobs.
    const implicit = compute(ds, 1_000_000, 'top10_weighted');
    const explicit = compute(ds, 1_000_000, 'top10_weighted', { winRateMultiplier: 1, premiumMultiplier: 1 });
    assert.deepEqual(implicit.breakdown, explicit.breakdown);
    assert.equal(implicit.capital, 1_000_000);
    assert.equal(implicit.method, 'top10_weighted');
  });

  test('every figure is finite across the full capital x method grid', () => {
    for (const capital of CAPITALS) {
      for (const method of METHODS) {
        const r = compute(ds, capital, method);
        const nums = [
          r.ipo.shMarketValue, r.ipo.szMarketValue, r.ipo.expectedWinsPerYear,
          r.ipo.expectedProfitPerYear, r.ipo.expectedReturnPct,
          ...Object.values(r.breakdown),
        ];
        for (const n of nums) {
          assert.ok(Number.isFinite(n), `${method} @ ${capital}: got ${n}`);
        }
        assert.ok(Number.isInteger(r.ipo.shTickets) && r.ipo.shTickets >= 0);
        assert.ok(Number.isInteger(r.ipo.szTickets) && r.ipo.szTickets >= 0);
      }
    }
  });

  test('the total edge equals its declared components', () => {
    const r = compute(ds, 1_000_000, 'top10_weighted');
    const b = r.breakdown;
    const expected =
      (b.personalDividendTaxPct - b.etfDividendTaxPct) +
      (b.ipoEdgePct - ds.etfIpoContributionPct) +
      (b.feeSavingPct + b.tradingCostPct);
    assert.ok(Math.abs(b.totalEdgePct - expected) < 1e-9);
  });

  test('tracking error is reported as risk, never charged against expected return', () => {
    const r = compute(ds, 1_000_000, 'top10_weighted');
    assert.ok(r.breakdown.trackingErrorPct > 0);
    // If TE were subtracted, the total would fall by the full TE. It must not.
    const withoutTe =
      (r.breakdown.personalDividendTaxPct - r.breakdown.etfDividendTaxPct) +
      (r.breakdown.ipoEdgePct - ds.etfIpoContributionPct) +
      (r.breakdown.feeSavingPct + r.breakdown.tradingCostPct);
    assert.ok(Math.abs(r.breakdown.totalEdgePct - withoutTe) < 1e-9);
  });

  test('more capital cannot reduce expected 打新 profit', () => {
    let prev = -1;
    for (const capital of CAPITALS) {
      const cur = compute(ds, capital, 'top10_weighted').ipo.expectedProfitPerYear;
      assert.ok(cur >= prev - 1e-9, `profit fell from ${prev} to ${cur}`);
      prev = cur;
    }
  });

  test('the online subscription cap binds at very large capital', () => {
    const small = compute(ds, 100_000, 'top10_weighted');
    const huge = compute(ds, 100_000_000, 'top10_weighted');
    assert.equal(small.ipo.capBinds, false);
    assert.equal(huge.ipo.capBinds, true);
  });

  test('fee saving equals the disclosed 0.20% minus the modelled trading cost', () => {
    const r = compute(ds, 1_000_000, 'top10_weighted');
    assert.equal(r.etfFeePct, 0.2);
    assert.equal(r.breakdown.feeSavingPct, 0.2);
    assert.ok(r.breakdown.tradingCostPct < 0);
    assert.equal(r.tradingCostPct, -r.breakdown.tradingCostPct);
  });

  test('sensitivity knobs move the answer in the right direction', () => {
    const base = compute(ds, 1_000_000, 'top10_weighted');
    const halfPremium = compute(ds, 1_000_000, 'top10_weighted', { premiumMultiplier: 0.5 });
    assert.ok(Math.abs(halfPremium.ipo.expectedProfitPerYear - base.ipo.expectedProfitPerYear / 2) < 1e-6);

    const doubleWin = compute(ds, 500_000, 'top10_weighted', { winRateMultiplier: 2 });
    const singleWin = compute(ds, 500_000, 'top10_weighted');
    assert.ok(Math.abs(doubleWin.ipo.expectedWinsPerYear - singleWin.ipo.expectedWinsPerYear * 2) < 1e-9);

    const noTax = compute(ds, 1_000_000, 'top10_weighted', { etfTaxRateOverride: 0 });
    assert.equal(noTax.breakdown.etfDividendTaxPct, 0);
    assert.ok(base.breakdown.etfDividendTaxPct < 0);
  });

  test('zero premium means zero profit, not NaN', () => {
    const ds2 = dataset();
    ds2.ipoSample = [ipo({ firstDayOpenPremiumPct: 0 })];
    const r = compute(ds2, 1_000_000, 'top5_weighted');
    assert.equal(r.ipo.expectedProfitPerYear, 0);
    assert.equal(r.ipo.expectedReturnPct, 0);
  });
});

describe('tradingCostPct', () => {
  test('round trip is commission x2 + stamp on sale + transfer x2 + impact x2', () => {
    const oneWay = ASSUMPTIONS.commissionRate + ASSUMPTIONS.transferFeeRate + ASSUMPTIONS.impactRate;
    const expected = (oneWay * 2 + ASSUMPTIONS.stampDutySellRate) * ASSUMPTIONS.annualTurnover * 100;
    assert.ok(Math.abs(tradingCostPct() - expected) < 1e-12);
    // 万2.5 commission, halved 0.05% stamp: this should be a small number.
    assert.ok(tradingCostPct() > 0 && tradingCostPct() < 0.5);
  });
});
