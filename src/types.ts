/**
 * Shared domain types for the 159201 replication lab.
 *
 * Every number that reaches the UI must carry a `provenance` tag so the report
 * can never present a model assumption as a disclosed fact.
 */

/** How a figure was obtained. Surfaced verbatim in the web UI. */
export type Provenance =
  | 'disclosed' // 真实披露数据: published filings / exchange data
  | 'statistical' // 历史统计估计: fitted from a historical sample
  | 'assumption'; // 模型假设: judgement call, no direct observation

export interface Sourced<T> {
  value: T;
  provenance: Provenance;
  /** Where this came from, for auditability. */
  source: string;
  /** ISO date the observation refers to, not the date we fetched it. */
  asOf: string;
}

/** Exchange classification drives the entire 网上打新 calculation. */
export type Exchange = 'SH' | 'SZ' | 'BJ';

/** Board matters because each board has its own online subscription mechanics. */
export type Board = 'main' | 'gem' | 'star' | 'bse';

export interface Holding {
  code: string;
  name: string;
  exchange: Exchange;
  /** Weight as % of fund NAV, as disclosed in the report. */
  weightPct: number;
  /** Shares held, 万股. */
  sharesWan: number;
  /** Market value, 万元. */
  valueWan: number;
}

export interface HoldingsSnapshot {
  /** e.g. "2026Q2" */
  period: string;
  /** Period end date, ISO. */
  asOf: string;
  holdings: Holding[];
}

export interface NavPoint {
  date: string;
  nav: number;
}

export interface PriceSeries {
  code: string;
  /** Closing prices, forward-adjusted (前复权), ascending by date. */
  dates: string[];
  closes: number[];
}

export interface IpoRecord {
  code: string;
  name: string;
  exchange: Exchange;
  board: Board;
  applyDate: string;
  listingDate: string | null;
  issuePrice: number | null;
  /** Shares sold online (网上发行量). */
  onlineIssueShares: number | null;
  /** Online subscription cap in shares, per investor. */
  onlineApplyUpper: number | null;
  /** Shares per winning 配号 (申购单位). SH=1000, SZ=500. */
  sharesPerTicket: number | null;
  /** Online oversubscription multiple, used to derive the winning rate. */
  onlineMultiple: number | null;
  /** First-day open premium over issue price, %. */
  firstDayOpenPremiumPct: number | null;
  /** First-day close change over issue price, %. */
  firstDayCloseChangePct: number | null;
}

/** The fund's real, disclosed 打新 activity from the interim report. */
export interface UnderwritingParticipation {
  period: string;
  asOf: string;
  /** Which lane the fund used: 网下 (institutional quota) or 网上. */
  lane: 'offline' | 'online' | 'mixed';
  entries: Array<{
    code: string;
    name: string;
    shares: number;
    /** Cost basis in 元. */
    amountYuan: number;
  }>;
  totalShares: number;
  totalAmountYuan: number;
}

export interface FeeSchedule {
  managementFeePct: number;
  custodyFeePct: number;
  /** Total, derived. */
  totalPct: number;
  provenance: Provenance;
  source: string;
}

/** How the individual builds their basket from the ETF's constituents. */
export type ReplicationMethod =
  | 'buy_etf'
  | 'top5_weighted'
  | 'top10_weighted'
  | 'top20_weighted'
  | 'top30_weighted'
  | 'top10_equal'
  | 'top10_normalized'
  | 'top20_normalized'
  | 'top30_normalized'
  | 'full';

export interface ReplicationWeights {
  method: ReplicationMethod;
  label: string;
  weights: Array<{ code: string; name: string; exchange: Exchange; weightPct: number }>;
  /** Sum of weights; 100 for every method by construction. */
  totalWeightPct: number;
  /** Cumulative ETF weight actually represented. */
  cumulativeEtfWeightPct: number;
}

export interface TaxModel {
  /** Personal long-term (>1y) effective dividend tax rate. */
  personalLongHoldRate: number;
  /** ETF effective dividend tax rate, back-solved from the interim report. */
  etfEffectiveRate: number;
  etfEffectiveRateLow: number;
  etfEffectiveRateHigh: number;
  provenance: Provenance;
  notes: string;
}

export interface IpoExpectation {
  /** Market-value split derived from the basket's exchange composition. */
  shMarketValue: number;
  szMarketValue: number;
  /** 配号 obtainable in each market. */
  shTickets: number;
  szTickets: number;
  /** Expected wins per year, summed per-IPO over the historical sample. */
  expectedWinsPerYear: number;
  expectedProfitPerYear: number;
  /** As % of capital. */
  expectedReturnPct: number;
  /** True when the online subscription cap binds before market value does. */
  capBinds: boolean;
  notes: string;
}

export interface ModelResult {
  capital: number;
  method: ReplicationMethod;
  /** True for buy_etf: the baseline itself, whose edge is identically zero. */
  isBaseline: boolean;
  portfolio: ReplicationWeights;
  ipo: IpoExpectation;
  tax: TaxModel;
  etfFeePct: number;
  /** Annual trading cost estimate for the replicated basket, %. */
  tradingCostPct: number;
  /** Dividend yield of the basket, %. */
  basketDividendYieldPct: number;
  /** Decomposition, all in % per year. */
  breakdown: {
    stockBetaContributionPct: number;
    dividendYieldPct: number;
    personalDividendTaxPct: number;
    etfDividendTaxPct: number;
    ipoEdgePct: number;
    feeSavingPct: number;
    tradingCostPct: number;
    trackingErrorPct: number;
    totalEdgePct: number;
  };
}
