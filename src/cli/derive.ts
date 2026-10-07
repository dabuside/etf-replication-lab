/**
 * Assembles the frozen dataset from the raw scrapes, runs derivation and
 * backtest, and writes data/derived/dataset.json.
 *
 * Reference period is the 2025 fiscal year, because that is the only window with
 * both a full-year filing and a full 142-name holdings disclosure. The 2026 H1
 * figures are carried alongside as a consistency check.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { backtestMethod, computeStats, type MethodBacktest } from '../backtest.ts';
import { ALL_METHODS, METHOD_LABELS, buildPortfolio, namesToReachWeight } from '../domain/portfolio.ts';
import { basketYield, daysBetween, deriveDividends, deriveFees, deriveIpoContribution, median, pickRichestSnapshot } from '../derive.ts';
import { ipoSample } from '../model.ts';
import type { DividendRecord } from '../scrape/stocks.ts';
import type { HoldingsSnapshot, IpoRecord, NavPoint, PriceSeries } from '../types.ts';

const RAW = new URL('../../data/raw/', import.meta.url).pathname;
const DERIVED = new URL('../../data/derived/', import.meta.url).pathname;

const readJson = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(join(RAW, `${name}.json`), 'utf8')) as T;

const pct = (x: number, d = 2) => `${x.toFixed(d)}%`;
const yi = (x: number) => `${(x / 1e8).toFixed(2)} 亿`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

async function main(): Promise<void> {
  await mkdir(DERIVED, { recursive: true });

  const snapshots = await readJson<HoldingsSnapshot[]>('holdings');
  const nav = await readJson<NavPoint[]>('nav');
  const pricesArr = await readJson<PriceSeries[]>('prices');
  const ipos = await readJson<IpoRecord[]>('ipos');
  const dividends = await readJson<Record<string, DividendRecord[]>>('dividends');
  const fin = await readJson<{
    asOf: string; dividendIncomeYuan: number; managementFeeYuan: number; custodyFeeYuan: number;
    impliedAvgNavYuan: number; navGrowthPct: number; benchmarkGrowthPct: number;
  }>('reportFinancials');
  const uw = await readJson<{ totalAmountYuan: number; entries: Array<{ code: string; name: string }> }>('underwriting');
  const ann = await readJson<{
    dividendIncomeYuan: number; managementFeeYuan: number; impliedAvgNavYuan: number;
  }>('annualFinancials');

  const prices = new Map(pricesArr.map((p) => [p.code, p]));
  const snapshot = pickRichestSnapshot(snapshots);

  console.log('== holdings disclosure ==');
  for (const s of snapshots) {
    console.log(`  ${s.period} (${s.asOf}): ${String(s.holdings.length).padStart(3)} 名, 覆盖 80% 权重需 ${namesToReachWeight(s.holdings, 80)} 只`);
  }
  console.log(`  -> working snapshot ${snapshot.period}: ${snapshot.holdings.length} names`);
  console.log(`     top5: ${snapshot.holdings.slice(0, 5).map((h) => `${h.name} ${h.weightPct}%`).join(', ')}`);

  console.log('\n== dividend tax back-solve ==');
  const div = deriveDividends({
    holdings: snapshot.holdings,
    dividends,
    netDividendYuan: ann.dividendIncomeYuan,
    averageNavYuan: ann.impliedAvgNavYuan,
    startDate: '2025-01-01',
    endDate: '2025-12-31',
  });
  console.log(`  gross book yield (2025 ex-dates, ${div.matchedNames}/${div.totalNames} names): ${pct(div.bookYieldPct)}`);
  console.log(`  reported net 2025FY: ${yi(div.netDividendYuan)} on avg NAV ${yi(ann.impliedAvgNavYuan)} = ${pct(div.reportedNetYieldPct)}`);
  console.log(`  -> implied effective rate: ${div.effectiveRatePct === null ? 'UNOBSERVABLE' : pct(div.effectiveRatePct)}`);
  for (const n of div.notes) console.log(`     note: ${n}`);

  const taxRate = clamp(div.effectiveRatePct ?? 10, 0, 20);
  console.log(`  using ${pct(taxRate)} in the model (statutory band midpoint when unobservable)`);

  console.log('\n== fees ==');
  const fees = deriveFees({
    managementFeeYuan: ann.managementFeeYuan,
    managementRatePct: 0.15,
    daysInPeriod: 365,
  });
  console.log(`  ${fees.managementFeePct}% + ${fees.custodyFeePct}% = ${pct(fees.totalPct)}/yr`);
  console.log(`  implied 2025 avg NAV from fee accrual: ${yi(fees.impliedAvgNavYuan)}`);

  console.log('\n== fund IPO activity (H1 2026 disclosed) ==');
  const h1Days = daysBetween('2026-01-01', fin.asOf);
  const annualCost = (uw.totalAmountYuan / h1Days) * 365;
  const priced = ipos.filter((i) => i.applyDate >= '2025-01-01' && i.firstDayOpenPremiumPct !== null);
  const medPremium = median(priced.map((i) => i.firstDayOpenPremiumPct as number));
  const ipoContrib = deriveIpoContribution({
    costYuan: annualCost,
    avgNavYuan: fin.impliedAvgNavYuan,
    deals: uw.entries.length,
    avgFirstDayPremiumPct: medPremium,
  });
  console.log(`  ${uw.entries.length} 网下 deals, ${yi(uw.totalAmountYuan)} 获配本金 in H1 2026`);
  console.log(`  annualised 获配本金: ${yi(annualCost)}`);
  console.log(`  sample median first-day premium: ${pct(medPremium, 1)}`);
  console.log(`  -> NAV contribution: ${pct(ipoContrib.estimatedReturnPct, 4)}/yr`);
  console.log(`  -> if every hit doubled: ${pct(ipoContrib.returnAt100PctGainPct, 4)}/yr`);

  console.log('\n== fund performance since inception ==');
  const navStats = computeStats(nav.map((n) => n.nav))!;
  console.log(`  total ${pct(navStats.totalReturnPct)}, annualised ${pct(navStats.annualisedReturnPct)}`);
  console.log(`  max drawdown ${pct(navStats.maxDrawdownPct)}, sharpe ${navStats.sharpe.toFixed(2)}`);
  console.log(`  H1 2026: NAV ${pct(fin.navGrowthPct)} vs benchmark ${pct(fin.benchmarkGrowthPct)}`);

  console.log('\n== replication backtests (OOS on disclosed weights) ==');
  const backtests: Record<string, MethodBacktest> = {};
  for (const m of ALL_METHODS) {
    if (m === 'buy_etf') continue;
    const r = backtestMethod({
      label: METHOD_LABELS[m], snapshots, nav, prices,
      build: (h) => { try { return buildPortfolio(h, m).weights; } catch { return null; } },
    });
    if (!r) { console.log(`  ${METHOD_LABELS[m].padEnd(24)} insufficient data`); continue; }
    backtests[m] = r;
    console.log(
      `  ${METHOD_LABELS[m].padEnd(24)} ret ${pct(r.totalReturnPct).padStart(8)}  TE ${pct(r.trackingErrorPct).padStart(6)}` +
      `  beta ${r.beta.toFixed(2).padStart(5)}  corr ${r.correlation.toFixed(3)}  AS ${pct(r.activeSharePct, 1).padStart(6)}  n=${r.observations}`,
    );
  }

  console.log('\n== per-method dividend yields (2025 ex-dates on 2025Q4 book) ==');
  const yieldsByMethod: Record<string, number> = {};
  for (const m of ALL_METHODS) {
    if (m === 'buy_etf') continue;
    const weights = buildPortfolio(snapshot.holdings, m).weights;
    const y = basketYield({
      weights,
      dividends,
      prices,
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      priceDate: '2025-12-31',
    });
    yieldsByMethod[m] = y.yieldPct;
    console.log(`  ${METHOD_LABELS[m].padEnd(24)} ${pct(y.yieldPct)}  (${y.payingNames}/${y.totalNames} names pay)`);
  }

  const teTop10 = backtests.top10_weighted?.trackingErrorPct ?? 5;
  const betaGapProxy = clamp((100 - (backtests.top10_weighted?.activeSharePct ?? 25)) / 200, 0.05, 0.5);

  const dataset = {
    snapshot,
    snapshots,
    nav,
    prices: Object.fromEntries(pricesArr.map((p) => [p.code, p])),
    ipoSample: ipoSample(ipos, isoYearsAgo(2)),
    tax: {
      personalLongHoldRate: 0,
      etfEffectiveRate: taxRate,
      etfEffectiveRatePct: taxRate,
      etfEffectiveRateLow: 0,
      etfEffectiveRateHigh: 20,
      provenance: div.effectiveRatePct === null ? 'assumption' : 'statistical',
      notes: div.effectiveRatePct === null
        ? '无法精确观察：分红税由中登源端代扣，不单独列示。取法定区间 0%~20% 的中值 10%'
        : `由 2025 年报回推，有效税率 ${pct(taxRate)}；法定区间 0%~20%`,
      bookYieldPct: div.bookYieldPct,
      reportedNetYieldPct: div.reportedNetYieldPct,
      derivationNotes: div.notes,
    },
    dividend: {
      grossDividendYuan: 0,
      netDividendYuan: div.netDividendYuan,
      portfolioDividendYieldPct: div.bookYieldPct,
      notes: div.notes,
    },
    yieldsByMethod,
    fees: { managementFeePct: fees.managementFeePct, custodyFeePct: fees.custodyFeePct, totalPct: fees.totalPct, impliedAvgNavYuan2025: fees.impliedAvgNavYuan },
    etfIpoContributionPct: ipoContrib.estimatedReturnPct,
    etfIpo: {
      deals: uw.entries.length,
      costYuanH1: uw.totalAmountYuan,
      annualisedCostYuan: annualCost,
      medianPremiumPct: medPremium,
      avgNavYuan: fin.impliedAvgNavYuan,
    },
    fundTotalReturnPct: navStats.totalReturnPct,
    fundAnnualisedReturnPct: navStats.annualisedReturnPct,
    fundMaxDrawdownPct: navStats.maxDrawdownPct,
    fundSharpe: navStats.sharpe,
    trackingErrorPct: teTop10,
    betaGapProxy,
    backtests,
    meta: {
      generatedAt: new Date().toISOString(),
      asOf: fin.asOf,
      sources: [
        '华夏基金 2025年年度报告 / 2026年中期报告 (2025-12-31, 2026-06-30)',
        '天天基金 F10 基金档案与持仓明细 (jjcc)',
        '东方财富 push2his 行情，前复权日线',
        '腾讯财经 web.ifzq.gtimg.cn 前复权日线（备用源）',
        '同花顺 d.10jqka.com.cn 国证自由现金流指数 980092',
        '东方财富数据中心 RPTA_APP_IPOAPPLY 新股发行与中签明细',
        '财税[2012]85号、财税[2015]101号 上市公司股息红利差别化个人所得税',
        '深交所《首次公开发行股票网上按市值申购实施办法》',
      ],
    },
  };

  await writeFile(join(DERIVED, 'dataset.json'), JSON.stringify(dataset), 'utf8');
  console.log(`\nwrote data/derived/dataset.json (${(JSON.stringify(dataset).length / 1024).toFixed(0)} KB)`);
}

function isoYearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

await main();
