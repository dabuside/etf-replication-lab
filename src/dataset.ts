/**
 * The frozen dataset. Everything the model needs, assembled once at build time
 * and embedded in the HTML so the page has no runtime dependencies.
 *
 * Fields are grouped by provenance. `disclosed` numbers came out of a filing or
 * an exchange feed; `derived` numbers are arithmetic on those; `assumption`
 * numbers are judgement calls and are labelled as such all the way to the UI.
 */
import type { Provenance } from './types.ts';
import type { HoldingsSnapshot, IpoRecord, NavPoint, PriceSeries, TaxModel } from './types.ts';

export interface SourcedFigure {
  value: number;
  provenance: Provenance;
  source: string;
  asOf: string;
}

export interface Dataset {
  /** Most complete holdings disclosure used to build baskets. */
  snapshot: HoldingsSnapshot;
  /** Every disclosure period, oldest first, for the rolling comparison. */
  snapshots: HoldingsSnapshot[];
  nav: NavPoint[];
  prices: Record<string, PriceSeries>;
  /** IPOs in the trailing observation window, SH + SZ only. */
  ipoSample: IpoRecord[];
  tax: TaxModel;

  dividend: {
    grossDividendYuan: number;
    netDividendYuan: number;
    portfolioDividendYieldPct: number;
    notes: string[];
  };

  fees: {
    managementFeePct: number;
    custodyFeePct: number;
    totalPct: number;
  };

  /** The fund's own disclosed IPO activity, annualised, as % of NAV. */
  etfIpoContributionPct: number;

  /** Fund performance since inception, used as the stock-return anchor. */
  fundTotalReturnPct: number;
  fundAnnualisedReturnPct: number;

  /** Proxy for how far a concentrated basket deviates, in % terms. */
  trackingErrorPct: number;
  betaGapProxy: number;

  meta: {
    generatedAt: string;
    asOf: string;
    sources: string[];
  };
}

export type { IpoRecord, NavPoint, PriceSeries, HoldingsSnapshot };
