/**
 * The engine. `compute(capital, method)` is the entire public surface.
 *
 * This is the file that enforces the project's core constraint: the web page may
 * ask for capital and a replication method, nothing else. Every other figure is
 * either read from the frozen dataset or produced by a labelled model here, so
 * there is deliberately no parameter for the user to supply.
 */
import {
  expectedProfit,
  expectedWinsDetailed,
  MARKET_VALUE_PER_TICKET,
  profitPerWin,
  ticketsFromMarketValue,
} from './domain/ipo.ts';
import { buildPortfolio, exchangeSplit } from './domain/portfolio.ts';
import type { Dataset } from './dataset.ts';
import type { Exchange, IpoRecord, ModelResult, ReplicationMethod } from './types.ts';

export interface Assumptions {
  /** Commission, one-way, as a fraction of notional. */
  commissionRate: number;
  /** Stamp duty on sale only, per 财税[2023]39号 (halved from 0.1%). */
  stampDutySellRate: number;
  /** Transfer fee, both ways. */
  transferFeeRate: number;
  /** Extra slippage/impact for a single-stock retail order, both ways. */
  impactRate: number;
  /** Turnover per year implied by the index's quarterly rebalance. */
  annualTurnover: number;
  /** Risk-free rate for Sharpe. */
  riskFreeRate: number;
  /** The fund's own all-in fee, read from the dataset rather than hardcoded. */
  etfFeeCostPct: number;
  /** AUM used to compare the fund's own 打新 dilution. */
  etfAumYuan: number;
}

/**
 * Model assumptions, stated plainly. These are the only numbers in the project
 * that are not derived from disclosure, and the UI labels every one of them
 * 模型假设 with a one-line rationale.
 */
export const ASSUMPTIONS: Assumptions = {
  // 万2.5 is the standard retail commission.
  commissionRate: 0.00025,
  // 财税[2023]39号 halved the stamp duty to 0.05%; it is charged on sale only.
  stampDutySellRate: 0.0005,
  transferFeeRate: 0.00001,
  // Slippage and impact for a single-stock retail order, both ways.
  impactRate: 0.0005,
  // One full basket turnover per year, matching the index's quarterly rebalance
  // of a Top-N book.
  annualTurnover: 1.0,
  riskFreeRate: 0.015,
  // Overwritten from the dataset's disclosed 0.15% + 0.05%.
  etfFeeCostPct: 0.2,
  etfAumYuan: 15_146_000_000,
};

export interface SensitivityKnobs {
  /** Multiplier on the derived winning rate. */
  winRateMultiplier: number;
  /** Multiplier on first-day premium, i.e. how hard hits are to monetise. */
  premiumMultiplier: number;
  /** Override the ETF's effective dividend tax rate, %. */
  etfTaxRateOverride?: number;
}

/**
 * IPO sample restricted to the observation window.
 *
 * Using the trailing two years rather than all history matters: online winning
 * rates and first-day premiums have both compressed as subscription demand rose,
 * so an all-time average would flatter the strategy.
 */
export function ipoSample(ipos: IpoRecord[], since: string): IpoRecord[] {
  return ipos.filter((i) => i.applyDate >= since && (i.exchange === 'SH' || i.exchange === 'SZ'));
}

function marketValue(capital: number, pct: number): number {
  return capital * (pct / 100);
}

/**
 * Expected annual 打新 outcome for a given basket.
 *
 * Each IPO is evaluated on its own disclosed terms rather than against a blended
 * average, because the binding constraint differs by market: Shenzhen tickets cost
 * half as much market value, but Shanghai offerings are often larger.
 */
export function computeIpo(args: {
  capital: number;
  shPct: number;
  szPct: number;
  sample: IpoRecord[];
  knobs: SensitivityKnobs;
}): {
  shMarketValue: number;
  szMarketValue: number;
  shTickets: number;
  szTickets: number;
  expectedWinsPerYear: number;
  expectedProfitPerYear: number;
  capBinds: boolean;
  notes: string[];
} {
  const { capital, shPct, szPct, sample, knobs } = args;
  const notes: string[] = [];

  const shMV = marketValue(capital, shPct);
  const szMV = marketValue(capital, szPct);
  const shTickets = ticketsFromMarketValue(shMV, 'SH');
  const szTickets = ticketsFromMarketValue(szMV, 'SZ');

  let totalWins = 0;
  let totalProfit = 0;
  let capBinds = false;
  let pricedIpos = 0;

  for (const ipo of sample) {
    const exchange: 'SH' | 'SZ' = ipo.exchange === 'SH' ? 'SH' : 'SZ';
    const tickets = exchange === 'SH' ? shTickets : szTickets;

    const scaled = knobs.winRateMultiplier === 1
      ? ipo
      : { ...ipo, onlineMultiple: ipo.onlineMultiple ? ipo.onlineMultiple / knobs.winRateMultiplier : null };
    const r = expectedWinsDetailed(tickets, scaled, exchange);
    if (r.capBinds) capBinds = true;
    if (r.wins <= 0) continue;

    const perWin = profitPerWin(
      knobs.premiumMultiplier === 1 ? ipo : { ...ipo, firstDayOpenPremiumPct: (ipo.firstDayOpenPremiumPct ?? 0) * knobs.premiumMultiplier },
    );
    if (perWin > 0) pricedIpos++;
    totalWins += r.wins;
    totalProfit += r.wins * perWin;
  }

  const spanYears = sample.length > 0 ? spanInYears(sample) : 1;
  const expectedWinsPerYear = totalWins / spanYears;
  const expectedProfitPerYear = totalProfit / spanYears;

  if (capBinds) notes.push('部分新股的网上申购上限已封顶，增加市值不再提高中签概率');
  if (pricedIpos === 0 && sample.length > 0) notes.push('样本内缺少上市首日数据，打新收益按 0 计');
  notes.push(
    `样本：${sample.length} 只沪深新股，跨 ${spanYears.toFixed(1)} 年，按逐只中签率×单签首日收益求期望`,
  );

  return { shMarketValue: shMV, szMarketValue: szMV, shTickets, szTickets, expectedWinsPerYear, expectedProfitPerYear, capBinds, notes };
}

function spanInYears(sample: IpoRecord[]): number {
  const dates = sample.map((i) => i.applyDate).filter(Boolean).sort();
  if (dates.length < 2) return 1;
  const a = Date.parse(`${dates[0]!}T00:00:00Z`);
  const b = Date.parse(`${dates[dates.length - 1]!}T00:00:00Z`);
  const years = (b - a) / (86_400_000 * 365.25);
  return Math.max(0.25, years);
}

/**
 * Round-trip trading cost for one full basket turnover, in %.
 *
 * The ETF pays 0.20%/yr and nothing per trade beyond that; an individual pays
 * commission twice, stamp duty on the way out, transfer fees and some impact.
 */
export function tradingCostPct(assumptions: Assumptions = ASSUMPTIONS): number {
  const oneWay = assumptions.commissionRate + assumptions.transferFeeRate + assumptions.impactRate;
  const roundTrip = oneWay * 2 + assumptions.stampDutySellRate;
  return roundTrip * assumptions.annualTurnover * 100;
}

export function compute(
  dataset: Dataset,
  capital: number,
  method: ReplicationMethod,
  knobs?: Partial<SensitivityKnobs>,
): ModelResult {
  const k: SensitivityKnobs = {
    winRateMultiplier: knobs?.winRateMultiplier ?? 1,
    premiumMultiplier: knobs?.premiumMultiplier ?? 1,
    ...(knobs?.etfTaxRateOverride !== undefined ? { etfTaxRateOverride: knobs.etfTaxRateOverride } : {}),
  };
  const assumptions: Assumptions = {
    ...ASSUMPTIONS,
    etfFeeCostPct: dataset.fees.totalPct,
  };

  // Baseline: holding the ETF itself. There is no replicated basket, no online
  // subscription quota (fund units do not count toward 打新 market value), no
  // fee saving and no personal tax edge. The holder's 打新 return is exactly
  // the fund's own offline-allotment contribution, which is already inside NAV,
  // so every edge-vs-baseline term nets to zero by construction.
  const holdings = dataset.snapshot.holdings;
  if (method === 'buy_etf') {
    const portfolio = buildPortfolio(holdings, method);
    const fundIpoPct = dataset.etfIpoContributionPct;
    const basketYield = dataset.dividend.portfolioDividendYieldPct;
    const breakdown = {
      stockBetaContributionPct: dataset.fundAnnualisedReturnPct,
      dividendYieldPct: basketYield,
      personalDividendTaxPct: 0,
      etfDividendTaxPct: 0,
      ipoEdgePct: fundIpoPct,
      feeSavingPct: 0,
      tradingCostPct: 0,
      trackingErrorPct: 0,
      totalEdgePct: 0,
    };
    return {
      capital,
      method,
      isBaseline: true,
      portfolio,
      ipo: {
        shMarketValue: 0,
        szMarketValue: 0,
        shTickets: 0,
        szTickets: 0,
        expectedWinsPerYear: 0,
        expectedProfitPerYear: capital > 0 ? (capital * fundIpoPct) / 100 : 0,
        expectedReturnPct: fundIpoPct,
        capBinds: false,
        notes:
          '直接持有 ETF 份额：基金份额不计入网上打新市值，无网上配号；打新收益仅为基金网下获配，已含在净值里',
      },
      tax: dataset.tax,
      etfFeePct: assumptions.etfFeeCostPct,
      tradingCostPct: 0,
      basketDividendYieldPct: basketYield,
      breakdown,
    };
  }

  const portfolio = buildPortfolio(holdings, method);
  const split = exchangeSplit(portfolio.weights);

  const ipo = computeIpo({
    capital,
    shPct: split.shPct,
    szPct: split.szPct,
    sample: dataset.ipoSample,
    knobs: k,
  });

  const etfTaxRate = k.etfTaxRateOverride ?? dataset.tax.etfEffectiveRate;
  // Each method carries its own trailing yield (Top5 ~4.9% vs full book ~3.5%).
  // Older datasets without the map fall back to the book average.
  const basketYield =
    (dataset.yieldsByMethod ?? {})[method] ?? dataset.dividend.portfolioDividendYieldPct;

  // Stock returns are assumed equal on both sides (中性假设): a Top-N basket
  // neither systematically beats nor lags the fund's gross stock return. The
  // backtest panel shows what actually happened; the forward model does not
  // pretend to predict active stock-picking alpha. Tracking error is therefore
  // reported as RISK, never subtracted from expected return.
  const stockBetaContributionPct = dataset.fundAnnualisedReturnPct;

  const personalDividendTaxPct = 0; // >1年 holding: zero, by statute
  // The `|| 0` normalises -0 to 0 when the override rate is zero.
  const etfDividendTaxPct = -(basketYield * (etfTaxRate / 100)) || 0;
  const ipoEdgePct = capital > 0 ? (ipo.expectedProfitPerYear / capital) * 100 : 0;
  const feeSavingPct = assumptions.etfFeeCostPct;
  const tc = tradingCostPct(assumptions);

  const breakdown = {
    stockBetaContributionPct,
    dividendYieldPct: basketYield,
    personalDividendTaxPct,
    etfDividendTaxPct,
    ipoEdgePct,
    feeSavingPct,
    tradingCostPct: -tc,
    // Positive figure, risk only, excluded from the total by construction.
    trackingErrorPct: dataset.trackingErrorPct,
    totalEdgePct: 0,
  };
  breakdown.totalEdgePct =
    (breakdown.personalDividendTaxPct - breakdown.etfDividendTaxPct) +
    (breakdown.ipoEdgePct - dataset.etfIpoContributionPct) +
    (breakdown.feeSavingPct + breakdown.tradingCostPct);

  return {
    capital,
    method,
    isBaseline: false,
    portfolio,
    ipo: {
      shMarketValue: ipo.shMarketValue,
      szMarketValue: ipo.szMarketValue,
      shTickets: ipo.shTickets,
      szTickets: ipo.szTickets,
      expectedWinsPerYear: ipo.expectedWinsPerYear,
      expectedProfitPerYear: ipo.expectedProfitPerYear,
      expectedReturnPct: capital > 0 ? (ipo.expectedProfitPerYear / capital) * 100 : 0,
      capBinds: ipo.capBinds,
      notes: ipo.notes.join('；'),
    },
    tax: dataset.tax,
    etfFeePct: assumptions.etfFeeCostPct,
    tradingCostPct: tc,
    basketDividendYieldPct: basketYield,
    breakdown,
  };
}

export { MARKET_VALUE_PER_TICKET, expectedProfit };
export type { Exchange };
