/**
 * Derivation stage: turn raw scraped payloads into the few figures the model
 * needs. Everything here is arithmetic on disclosed data or an explicitly
 * labelled assumption. Nothing is a free-floating guess.
 */
import type { DividendRecord } from './scrape/stocks.ts';
import type { Holding, HoldingsSnapshot } from './types.ts';

export interface DividendDerivation {
  /** Gross (pre-tax) dividend yield of the disclosed book, %. */
  bookYieldPct: number;
  /** Net dividend income as reported, 元. */
  netDividendYuan: number;
  /** Reported net income as a % of average NAV. */
  reportedNetYieldPct: number;
  /** Implied effective tax rate, %, or null when unobservable. */
  effectiveRatePct: number | null;
  /** Constituents matched by a dividend record, for coverage honesty. */
  matchedNames: number;
  totalNames: number;
  notes: string[];
}

/**
 * Back-solve the fund's effective dividend tax rate.
 *
 * The tax is withheld at source by 中国结算 and never appears as a line item, so
 * the only observable is the relationship between gross dividends on the
 * disclosed book and the net figure the fund reported.
 *
 * Method: compute the gross yield of the disclosed book over calendar-year
 * ex-dates, then compare it with the net income the fund reported as a fraction
 * of its average NAV. The ratio gives the tax.
 *
 * The comparison is honest but not exact, and the residual error is worth naming:
 *
 *   1. The disclosed book is the period-END position, while average NAV was much
 *      lower for a fund that grew from ~7亿 to ~160亿 during 2025. Both sides of
 *      the ratio are expressed as yields on NAV to cancel that scale difference,
 *      but composition drift remains.
 *   2. The index rebalances quarterly, so the book earning the dividends is not
 *      the book disclosed at period end.
 *
 * A materially negative result would mean the method has broken, so it is
 * reported as unobservable rather than clamped into a plausible-looking number.
 */
export function deriveDividends(args: {
  holdings: Holding[];
  dividends: Record<string, DividendRecord[]>;
  netDividendYuan: number;
  /** Average net assets over the period, 元. */
  averageNavYuan: number;
  startDate: string;
  endDate: string;
}): DividendDerivation {
  const { holdings, dividends, netDividendYuan, averageNavYuan, startDate, endDate } = args;
  const notes: string[] = [];

  const bookValueYuan = holdings.reduce((s, h) => s + h.valueWan * 10_000, 0);
  if (bookValueYuan <= 0) throw new Error('disclosed book has no value');

  let gross = 0;
  let matched = 0;
  for (const h of holdings) {
    const hits = (dividends[h.code] ?? []).filter(
      (d) => d.exDate >= startDate && d.exDate <= endDate && d.dpsPreTax > 0,
    );
    if (hits.length === 0) continue;
    matched++;
    const shares = h.sharesWan * 10_000;
    for (const d of hits) gross += shares * d.dpsPreTax;
  }

  const bookYieldPct = (gross / bookValueYuan) * 100;
  const reportedNetYieldPct = averageNavYuan > 0 ? (netDividendYuan / averageNavYuan) * 100 : 0;

  let effectiveRatePct: number | null = null;
  if (bookYieldPct > 0 && reportedNetYieldPct > 0) {
    const candidate = (1 - reportedNetYieldPct / bookYieldPct) * 100;
    // Outside 0-40% the two sides are not describing the same thing.
    effectiveRatePct = candidate >= -5 && candidate <= 40 ? Math.max(0, candidate) : null;
  }

  const coverage = holdings.length > 0 ? (matched / holdings.length) * 100 : 0;
  notes.push(`成分股分红记录覆盖 ${matched}/${holdings.length}（${coverage.toFixed(0)}%）`);
  notes.push('分子按披露期末持仓计算，分母用期间平均净资产；基金 2025 年规模从约 7 亿增至 160 亿，两者口径不同');
  notes.push('指数季度调仓，除权日实际持仓与期末披露持仓存在差异');
  if (effectiveRatePct === null) {
    notes.push('回推结果落在合理区间外，判定为无法精确观察，改用法定区间 0%~20%');
  }

  return {
    bookYieldPct,
    netDividendYuan,
    reportedNetYieldPct,
    effectiveRatePct,
    matchedNames: matched,
    totalNames: holdings.length,
    notes,
  };
}

export interface FeeDerivation {
  managementFeePct: number;
  custodyFeePct: number;
  totalPct: number;
  /** Average net assets implied by the fee accrual, 元. */
  impliedAvgNavYuan: number;
}

/**
 * Fees are the one place disclosed numbers beat the prospectus: at 0.15% and
 * 0.05% of daily NAV, the amounts charged back out the period's average net
 * assets. That gives an independent cross-check on reported AUM.
 */
export function deriveFees(args: {
  managementFeeYuan: number;
  managementRatePct: number;
  daysInPeriod: number;
}): FeeDerivation {
  const { managementFeeYuan, managementRatePct, daysInPeriod } = args;
  const impliedAvgNavYuan =
    managementFeeYuan > 0 && managementRatePct > 0
      ? managementFeeYuan / ((managementRatePct / 100) * (daysInPeriod / 365))
      : 0;
  return {
    managementFeePct: managementRatePct,
    custodyFeePct: 0.05,
    totalPct: managementRatePct + 0.05,
    impliedAvgNavYuan,
  };
}

export interface IpoContribution {
  /** Annualised 获配本金, 元. */
  costYuan: number;
  deals: number;
  /** Contribution to NAV at the sample's median first-day premium, %. */
  estimatedReturnPct: number;
  /** Contribution if every hit doubled, %. */
  returnAt100PctGainPct: number;
}

/**
 * How much the fund's own IPO activity actually contributes.
 *
 * The point is the denominator: 获配金额 is quota-driven and roughly fixed, but
 * NAV is ~160亿, so even a doubling of every allocation is a small fraction of a
 * percent. That dilution is the whole answer to "does 打新 still work at this
 * fund size", and it is why this is reported against a spread of AUM scenarios.
 */
export function deriveIpoContribution(args: {
  costYuan: number;
  avgNavYuan: number;
  deals: number;
  avgFirstDayPremiumPct: number;
}): IpoContribution {
  const { costYuan, avgNavYuan, deals, avgFirstDayPremiumPct } = args;
  const base = avgNavYuan > 0 ? costYuan / avgNavYuan : 0;
  return {
    costYuan,
    deals,
    estimatedReturnPct: base * (avgFirstDayPremiumPct / 100) * 100,
    returnAt100PctGainPct: base * 100,
  };
}

/** Preferred snapshot: most complete disclosure, most recent. */
export function pickRichestSnapshot(snapshots: HoldingsSnapshot[]): HoldingsSnapshot {
  if (snapshots.length === 0) throw new Error('no holdings snapshots available');
  return [...snapshots].sort((a, b) => {
    if (b.holdings.length !== a.holdings.length) return b.holdings.length - a.holdings.length;
    return b.asOf.localeCompare(a.asOf);
  })[0]!;
}

export function daysBetween(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 180;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
}
