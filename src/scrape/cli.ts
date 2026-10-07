import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchHoldings,
  fetchNavHistory,
  fetchReportIds,
  parseReportFinancials,
  parseUnderwriting,
} from './etf.ts';
import { fetchDividendHistory, fetchIndexSeries, fetchPrices } from './stocks.ts';
import { fetchIpos } from './ipo.ts';
import { reportText } from './pdf.ts';
import { fetchText } from '../http.ts';
import { RAW_DIR, resilient } from '../http.ts';

const OUT = new URL('../../data/raw/', import.meta.url).pathname;

/** Calendar years the fund has reported in. Inception was 2025-02-19. */
const YEARS = [2025, 2026];

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
  console.log(`  wrote ${name}.json`);
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  console.log('[1/6] holdings by report period');
  const holdings = [];
  for (const year of YEARS) {
    try {
      const snaps = await resilient(`holdings ${year}`, () => fetchHoldings(year));
      holdings.push(...snaps);
      for (const s of snaps) {
        console.log(`  ${s.period} (${s.asOf}): ${s.holdings.length} disclosed, top=${s.holdings[0]?.name ?? '-'}`);
      }
    } catch (err) {
      console.warn(`  ${year} unavailable: ${String(err).slice(0, 100)}`);
    }
  }
  if (holdings.length === 0) throw new Error('no holdings scraped');
  // Deduplicate on period: year-based fetches can overlap at the boundary.
  const byPeriod = new Map(holdings.map((h) => [h.period, h]));
  await save('holdings', [...byPeriod.values()].sort((a, b) => a.asOf.localeCompare(b.asOf)));

  console.log('[2/6] ETF NAV history');
  const nav = await resilient('nav', fetchNavHistory);
  console.log(`  ${nav.length} points, ${nav[0]?.date} → ${nav[nav.length - 1]?.date}`);
  await save('nav', nav);

  console.log('[3/6] index 980092');
  try {
    const index = await resilient('index', () => fetchIndexSeries('980092'));
    console.log(`  ${index.dates.length} points, ${index.dates[0]} → ${index.dates[index.dates.length - 1]}`);
    await save('index980092', index);
  } catch (err) {
    console.warn(`  index unavailable: ${String(err).slice(0, 100)}`);
  }

  console.log('[4/6] constituent prices + dividends');
  const allCodes = [...new Set(holdings.flatMap((h) => h.holdings.map((x) => x.code)))];
  console.log(`  ${allCodes.length} unique codes`);
  const prices = (await resilient('prices', () => fetchPrices(allCodes), 6)).filter((p) => p.dates.length > 0);
  console.log(`  prices: ${prices.length}/${allCodes.length} series`);

  const divs = await resilient('dividends', () => fetchDividendHistory(allCodes), 6);
  const divCount = Object.values(divs).reduce((s, d) => s + d.length, 0);
  console.log(`  dividends: ${divCount} records across ${Object.keys(divs).length} codes`);
  await save('prices', prices);
  await save('dividends', divs);

  console.log('[5/6] IPO master table');
  const ipos = await resilient('ipos', () => fetchIpos({ since: '2023-01-01' }), 6);
  console.log(`  ${ipos.length} IPOs since 2023`);
  await save('ipos', ipos);

  console.log('[6/6] fund filings (tax + underwriting evidence)');
  const reports = await resilient('reports', fetchReportIds);
  await save('reports', reports);
  const interim = reports.find((r) => /2026年中期报告/.test(r.title));
  if (!interim) throw new Error('interim report not found in announcement list');

  const text = await resilient('pdf', () => reportText(interim.id), 4);
  const asOf = '2026-06-30';
  const financials = parseReportFinancials(text, '2026H1', asOf);
  const participation = parseUnderwriting(text, '2026H1', asOf);
  console.log(`  net dividend income: ${financials.dividendIncomeYuan.toLocaleString('en-US')} 元`);
  console.log(`  fees imply avg NAV:  ${(financials.impliedAvgNavYuan / 1e8).toFixed(2)} 亿`);
  console.log(`  NAV ${financials.navGrowthPct}% vs benchmark ${financials.benchmarkGrowthPct}%`);
  console.log(`  IPO participation:  ${participation.entries.length} deals, ${participation.totalAmountYuan.toLocaleString('en-US')} 元`);
  await save('reportFinancials', financials);
  await save('underwriting', participation);

  console.log('\nscrape complete');
}

await main();
