/**
 * Chinese dividend tax rules as they apply to a domestic equity fund and to an
 * individual holding A-shares.
 *
 * The chain has three links and it matters which one we are taxing:
 *
 *   1. listed company -> ETF   上市公司派息时代扣代缴, under 财税[2012]85号 第五条,
 *                              which subjects 证券投资基金 to the same
 *                              差别化 regime as individuals, keyed to the FUND'S
 *                              OWN holding period.
 *   2. ETF -> index             The tax is withheld at source and is NOT
 *                              recoverable; it permanently reduces NAV.
 *   3. fund -> investor         财税[2002]128号: distributions from an open-end
 *                              fund to investors are 暂不征收个人所得税
 *                              (still in force per 财政部 税务总局公告2018年第177号).
 *
 * So the personal investor's tax advantage is not "ETF gets a tax break that I
 * don't." It is the opposite: the ETF pays ~10% because it rebalances quarterly
 * and most of its lots sit in the 1-month-to-1-year band, while an individual
 * who holds past a year pays 0%.
 */

/** 持股期限 bands from 财税[2012]85号, plus 财税[2015]101号. */
export const TAX_BANDS = [
  { maxDays: 30, ratePct: 20, label: '持股 1 个月以内（含 1 个月）' },
  { maxDays: 365, ratePct: 10, label: '持股 1 个月以上至 1 年（含 1 年）' },
  { maxDays: Number.POSITIVE_INFINITY, ratePct: 0, label: '持股超过 1 年' },
] as const;

/** Effective dividend tax rate for a given holding period, in days. */
export function effectiveDividendTaxRate(holdingDays: number): number {
  if (!Number.isFinite(holdingDays) || holdingDays < 0) {
    throw new Error(`invalid holding period: ${holdingDays} days`);
  }
  return TAX_BANDS.find((b) => holdingDays <= b.maxDays)?.ratePct ?? 0;
}

/** An individual holding past one year pays nothing. */
export function personalLongTermRate(): number {
  return effectiveDividendTaxRate(366);
}

/**
 * Back-solve the effective tax rate the fund actually paid, given gross
 * (pre-tax) dividend income and the net figure it reported.
 *
 * The fund's reported 股利收益 is already net of tax withheld at source, and the
 * tax never appears as a separate line item, so this is the only way to observe
 * the real rate. Returns null when there is nothing to observe.
 */
export function impliedTaxRate(grossDividend: number, netDividend: number): number | null {
  if (grossDividend <= 0) return null;

  // The fund reports to the cent, so gross/net can each carry a 分 of rounding
  // that makes net appear to exceed gross. Treat that as zero tax rather than
  // throwing, but only within a tolerance scaled to the magnitude involved.
  const tolerance = Math.max(1, grossDividend * 1e-9);
  if (netDividend - grossDividend > tolerance) {
    throw new Error(
      `net dividend (${netDividend}) exceeds gross (${grossDividend}) by more than rounding; tax cannot be negative`,
    );
  }

  const rate = ((grossDividend - netDividend) / grossDividend) * 100;
  // Sub-basis-point noise would otherwise read as a nonsense rate.
  if (Math.abs(rate) < 0.01) return 0;
  return Math.min(100, Math.max(0, rate));
}

/**
 * Plausible bounds for the ETF's effective rate, given a quarterly rebalance.
 *
 * A quarterly rebalance implies an average lot age of roughly one to two months,
 * but freshly-bought lots reset to the 20% band, so the true figure sits between
 * those anchors. These bounds are a modelling judgement, not a disclosure, and
 * the UI labels them as such.
 */
export const ETF_TAX_BOUNDS = { low: 0, mid: 10, high: 20 } as const;
