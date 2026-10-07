import { fetchJson, fetchText } from '../http.ts';
import type { Exchange, HoldingsSnapshot, NavPoint, UnderwritingParticipation } from '../types.ts';

const FUND = '159201';
const EM_F10 = 'http://fundf10.eastmoney.com/';

/** Eastmoney quotes classify by numeric market prefix. */
export function exchangeOf(code: string): Exchange {
  if (/^(60|68|900|11|5)/.test(code)) return 'SH';
  if (/^(00|30|20|12|15|16)/.test(code)) return 'SZ';
  if (/^(43|83|87|88|92)/.test(code)) return 'BJ';
  return 'SH';
}

/**
 * Fetches every quarter disclosed for a given year.
 *
 * The endpoint ignores the `month` parameter as a filter: a single response for
 * `year=2026` contains one block per quarter (newest first), each with its own
 * heading and "截止至" date. Passing `year=2026&month=6` still returns Q1 *and*
 * Q2, so we split the payload on the quarter headings rather than trusting the
 * request parameters. Quarter reports disclose only the top 10; interim and
 * annual reports disclose everything, which is why counts differ by period.
 */
export async function fetchHoldings(year: number): Promise<HoldingsSnapshot[]> {
  const url =
    `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${FUND}` +
    `&topline=300&year=${year}&month=12`;
  const raw = await fetchText(url, { referer: EM_F10 });
  return parseHoldingsAll(raw);
}

export function parseHoldingsAll(raw: string): HoldingsSnapshot[] {
  // Blocks begin at each "<h4 class='t'>" heading and end at the next one.
  const headings = [...raw.matchAll(/<h4 class='t'>[\s\S]*?<\/h4>/g)];
  const out: HoldingsSnapshot[] = [];

  headings.forEach((h, i) => {
    const heading = h[0];
    const start = h.index!;
    const end = i + 1 < headings.length ? headings[i + 1]!.index! : raw.length;
    const block = raw.slice(start, end);

    const label = heading.match(/(\d{4})年(\d)季度股票投资明细/);
    if (!label) return;
    const period = `${label[1]}Q${label[2]}`;
    const asOf = block.match(/截止至：<font class='px12'>([\d-]+)<\/font>/)?.[1] ?? '';

    const holdings = parseHoldingRows(block);
    if (holdings.length > 0) out.push({ period, asOf, holdings });
  });

  // Newest first, so downstream `latest` selection is just [0].
  return out.sort((a, b) => b.asOf.localeCompare(a.asOf));
}

/** Row shape: code link, name link, price spans, links cell, then weight/shares/value. */
export function parseHoldingRows(block: string): HoldingsSnapshot['holdings'] {
  const holdings: HoldingsSnapshot['holdings'] = [];
  const rowRe =
    /unify\/r\/[01]\.(\d{6})'>(\d{6})<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>([\d.]+)%<\/td><td class='tor'>([\d,]+(?:\.\d+)?)<\/td><td class='tor'>([\d,]+(?:\.\d+)?)<\/td>/g;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    const [, code, , name, weightPct, sharesWan, valueWan] = m;
    if (!code || !name || !weightPct || !sharesWan || !valueWan) continue;
    holdings.push({
      code,
      name,
      exchange: exchangeOf(code),
      weightPct: Number(weightPct),
      sharesWan: Number(sharesWan.replace(/,/g, '')),
      valueWan: Number(valueWan.replace(/,/g, '')),
    });
  }
  return holdings;
}

/** Daily NAV since inception, from the pingzhongdata payload. */
export async function fetchNavHistory(): Promise<NavPoint[]> {
  const raw = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${FUND}.js`);
  return parseNavHistory(raw);
}

export function parseNavHistory(raw: string): NavPoint[] {
  // Terminator varies (`];` vs `],`) depending on whether the array is the
  // last assignment in the payload, so anchor on the closing bracket alone.
  const m = raw.match(/Data_netWorthTrend[\s:=]{0,4}?(\[.*?\])[;,]/);
  if (!m?.[1]) throw new Error('Data_netWorthTrend not found in pingzhongdata payload');
  const rows = JSON.parse(m[1]) as Array<{ x: number; y: number }>;
  return rows.map((r) => ({ date: beijingDate(r.x), nav: r.y }));
}

/**
 * Epoch millis -> calendar date in Beijing time.
 *
 * The upstream stamps each point at local midnight, which is 16:00 UTC on the
 * previous day. Calling toISOString() directly shifts every NAV date back one
 * day; since NAV is then compared against stock prices on their true trading
 * dates, that misalignment silently destroys every correlation in the backtest.
 * This is the most load-bearing date conversion in the project.
 */
export function beijingDate(epochMs: number): string {
  return new Date(epochMs + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** Report IDs, used to pull the PDFs that back the tax and 打新 analysis. */
export async function fetchReportIds(): Promise<Array<{ id: string; title: string; date: string }>> {
  const data = await fetchJson<{ Data: Array<{ ID: string; TITLE: string; PUBLISHDATEDesc: string }> }>(
    'https://api.fund.eastmoney.com/f10/JJGG?fundcode=159201&pageIndex=1&pageSize=40&type=3',
    { referer: EM_F10 },
  );
  return (data.Data ?? [])
    .filter((d) => /中期报告|年度报告|季度报告/.test(d.TITLE))
    .map((d) => ({ id: d.ID, title: d.TITLE, date: d.PUBLISHDATEDesc }));
}

/**
 * Interim-report IPO participation table (§6.4.10.7), which is disclosed fact.
 *
 * The table prints the current period first and then a "上年度可比期间"
 * comparable block. Only the current period counts, so the block is truncated
 * at that heading — otherwise the prior year's deals get double-counted.
 */
export function parseUnderwriting(text: string, period: string, asOf: string): UnderwritingParticipation {
  const start = text.indexOf('本基金在承销期内参与关联方承销证券的情况');
  const rawEnd = text.indexOf('6.4.10.8', start);
  let block = start >= 0 ? text.slice(start, rawEnd > start ? rawEnd : undefined) : '';
  const priorStart = block.indexOf('上年度可比期间');
  if (priorStart >= 0) block = block.slice(0, priorStart);

  const entries: UnderwritingParticipation['entries'] = [];
  const rowRe =
    /([一-龥]{2,}证券)\s+(\d{6})\s+([一-龥A-Za-z0-9]+)\s+新股发行\s+([\d,]+)\s+([\d,]+\.\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(block)) !== null) {
    const [, , code, name, shares, amount] = m;
    if (!code || !name || !shares || !amount) continue;
    entries.push({
      code,
      name,
      shares: Number(shares.replace(/,/g, '')),
      amountYuan: cents(Number(amount.replace(/,/g, ''))),
    });
  }

  return {
    period,
    asOf,
    lane: 'offline',
    entries,
    totalShares: entries.reduce((s: number, e) => s + e.shares, 0),
    totalAmountYuan: cents(entries.reduce((s: number, e) => s + e.amountYuan, 0)),
  };
}

export interface ReportFinancials {
  period: string;
  asOf: string;
  /** Net dividend income in 元, already net of withheld tax. */
  dividendIncomeYuan: number;
  managementFeeYuan: number;
  custodyFeeYuan: number;
  /** Avg NAV implied by fees, useful for sanity-checking AUM. */
  impliedAvgNavYuan: number;
  navGrowthPct: number;
  benchmarkGrowthPct: number;
  /** Gross (pre-tax) dividend income, back-solved from component DPS. */
  grossDividendIncomeYuan: number | null;
}

/** Snaps a float to whole 分, so reported totals reconcile exactly. */
const cents = (x: number): number => Math.round(x * 100) / 100;

/** Pulls the specific line items we need out of the interim report text. */
export function parseReportFinancials(text: string, period: string, asOf: string): ReportFinancials {
  const num = (re: RegExp): number => {
    const m = text.match(re);
    if (!m?.[1]) return 0;
    return Number(m[1].replace(/,/g, ''));
  };

  // The 利润表 lists these as `本期` then the comparative period, so anchor on the
  // first occurrence — that is the reporting period, not last year's figure.
  // Round to 分: summing and re-deriving from these should not drift.
  const dividendIncomeYuan = cents(num(/股票投资产生的股利收益\s*([\d,]+\.\d{2})/));
  const managementFeeYuan = cents(num(/1\.管理人报酬\s*([\d,]+\.\d{2})/));
  const custodyFeeYuan = cents(num(/2\.托管费\s*([\d,]+\.\d{2})/));

  // Fees accrue at 0.15%/0.05% of daily NAV, so they back out the period's
  // average net assets over the number of days elapsed in the half-year.
  const start = Date.parse(`${asOf.slice(0, 4)}-01-01T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const impliedAvgNavYuan =
    managementFeeYuan > 0 ? managementFeeYuan / (0.0015 * (days / 365)) : 0;

  // PDF text extraction wraps mid-sentence, so "同期业绩比较基准增长率" can be
  // split across a line break. Match with tolerant whitespace.
  const navGrowthPct = num(/本报告期份额净值增长率为\s*(-?[\d.]+)%/);
  const benchmarkGrowthPct = num(/同\s*期业绩比较基准增长率\s*(-?[\d.]+)%/);

  return {
    period,
    asOf,
    dividendIncomeYuan,
    managementFeeYuan,
    custodyFeeYuan,
    impliedAvgNavYuan,
    navGrowthPct,
    benchmarkGrowthPct,
    grossDividendIncomeYuan: null,
  };
}
