/**
 * The engine. `compute(capital, method)` is the entire public surface.
 *
 * This is the file that enforces the project's core constraint: the web page may
 * ask for capital and a replication method, nothing else. Every other figure is
 * either read from the frozen dataset or produced by a labelled model here, so
 * there is deliberately no parameter for the user to supply.
 */
import { expectedProfit, expectedWinsDetailed, MARKET_VALUE_PER_TICKET, profitPerWin, ticketsFromMarketValue, } from './domain/ipo.ts';
import { buildPortfolio, exchangeSplit } from './domain/portfolio.ts';
/**
 * Model assumptions, stated plainly. These are the only numbers in the project
 * that are not derived from disclosure, and the UI labels every one of them
 * 模型假设 with a one-line rationale.
 */
export const ASSUMPTIONS = {
    // 万2.5 is the standard retail commission; the fund's own fee is 0.20%/yr.
    commissionRate: 0.00025,
    stampDutySellRate: 0.0005,
    transferFeeRate: 0.00001,
    impactRate: 0.0005,
    annualTurnover: 1.0,
    riskFreeRate: 0.015,
    etfAumYuan: 15_146_000_000,
};
/**
 * IPO sample restricted to the observation window.
 *
 * Using the trailing two years rather than all history matters: online winning
 * rates and first-day premiums have both compressed as subscription demand rose,
 * so an all-time average would flatter the strategy.
 */
export function ipoSample(ipos, since) {
    return ipos.filter((i) => i.applyDate >= since && (i.exchange === 'SH' || i.exchange === 'SZ'));
}
function marketValue(capital, pct) {
    return capital * (pct / 100);
}
/**
 * Expected annual 打新 outcome for a given basket.
 *
 * Each IPO is evaluated on its own disclosed terms rather than against a blended
 * average, because the binding constraint differs by market: Shenzhen tickets cost
 * half as much market value, but Shanghai offerings are often larger.
 */
export function computeIpo(args) {
    const { capital, shPct, szPct, sample, knobs } = args;
    const notes = [];
    const shMV = marketValue(capital, shPct);
    const szMV = marketValue(capital, szPct);
    const shTickets = ticketsFromMarketValue(shMV, 'SH');
    const szTickets = ticketsFromMarketValue(szMV, 'SZ');
    let totalWins = 0;
    let totalProfit = 0;
    let capBinds = false;
    let pricedIpos = 0;
    for (const ipo of sample) {
        const exchange = ipo.exchange === 'SH' ? 'SH' : 'SZ';
        const tickets = exchange === 'SH' ? shTickets : szTickets;
        const scaled = knobs.winRateMultiplier === 1
            ? ipo
            : { ...ipo, onlineMultiple: ipo.onlineMultiple ? ipo.onlineMultiple / knobs.winRateMultiplier : null };
        const r = expectedWinsDetailed(tickets, scaled, exchange);
        if (r.capBinds)
            capBinds = true;
        if (r.wins <= 0)
            continue;
        const perWin = profitPerWin(knobs.premiumMultiplier === 1 ? ipo : { ...ipo, firstDayOpenPremiumPct: (ipo.firstDayOpenPremiumPct ?? 0) * knobs.premiumMultiplier });
        if (perWin > 0)
            pricedIpos++;
        totalWins += r.wins;
        totalProfit += r.wins * perWin;
    }
    const spanYears = sample.length > 0 ? spanInYears(sample) : 1;
    const expectedWinsPerYear = totalWins / spanYears;
    const expectedProfitPerYear = totalProfit / spanYears;
    if (capBinds)
        notes.push('部分新股的网上申购上限已封顶，增加市值不再提高中签概率');
    if (pricedIpos === 0 && sample.length > 0)
        notes.push('样本内缺少上市首日数据，打新收益按 0 计');
    notes.push(`样本：${sample.length} 只沪深新股，跨 ${spanYears.toFixed(1)} 年，按逐只中签率×单签首日收益求期望`);
    return { shMarketValue: shMV, szMarketValue: szMV, shTickets, szTickets, expectedWinsPerYear, expectedProfitPerYear, capBinds, notes };
}
function spanInYears(sample) {
    const dates = sample.map((i) => i.applyDate).filter(Boolean).sort();
    if (dates.length < 2)
        return 1;
    const a = Date.parse(`${dates[0]}T00:00:00Z`);
    const b = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
    const years = (b - a) / (86_400_000 * 365.25);
    return Math.max(0.25, years);
}
/**
 * Round-trip trading cost for one full basket turnover, in %.
 *
 * The ETF pays 0.20%/yr and nothing per trade beyond that; an individual pays
 * commission twice, stamp duty on the way out, transfer fees and some impact.
 */
export function tradingCostPct(assumptions = ASSUMPTIONS) {
    const oneWay = assumptions.commissionRate + assumptions.transferFeeRate + assumptions.impactRate;
    const roundTrip = oneWay * 2 + assumptions.stampDutySellRate;
    return roundTrip * assumptions.annualTurnover * 100;
}
export function compute(dataset, capital, method, knobs) {
    const k = {
        winRateMultiplier: knobs?.winRateMultiplier ?? 1,
        premiumMultiplier: knobs?.premiumMultiplier ?? 1,
        ...(knobs?.etfTaxRateOverride !== undefined ? { etfTaxRateOverride: knobs.etfTaxRateOverride } : {}),
    };
    const assumptions = ASSUMPTIONS;
    const holdings = dataset.snapshot.holdings;
    const portfolio = buildPortfolio(holdings, method);
    const split = exchangeSplit(portfolio.weights);
    const ipo = computeIpo({
        capital,
        shPct: split.shPct,
        szPct: split.szPct,
        sample: dataset.ipoSample,
        knobs: k,
    });
    const etfTaxRate = k.etfTaxRateOverride ?? dataset.tax.etfEffectiveRatePct;
    const basketYield = dataset.dividend.portfolioDividendYieldPct;
    // Stock beta contribution: the replicated basket's own price drift is unknown
    // ex ante, so we anchor on the fund's tracking record and let the fitted
    // tracking error stand in for the residual gap. The UI must label this as such.
    const stockBetaContributionPct = dataset.fundAnnualisedReturnPct - dataset.fundAnnualisedReturnPct * (1 - Math.min(0.9, dataset.betaGapProxy));
    const personalDividendTaxPct = -(basketYield * 0); // >1年 holding: zero
    const etfDividendTaxPct = -(basketYield * (etfTaxRate / 100));
    const ipoEdgePct = (ipo.expectedProfitPerYear / capital) * 100;
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
        trackingErrorPct: -dataset.trackingErrorPct,
        totalEdgePct: 0,
    };
    breakdown.totalEdgePct =
        breakdown.personalDividendTaxPct -
            breakdown.etfDividendTaxPct +
            breakdown.ipoEdgePct -
            dataset.etfIpoContributionPct +
            breakdown.feeSavingPct +
            breakdown.tradingCostPct +
            breakdown.trackingErrorPct;
    return {
        capital,
        method,
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
