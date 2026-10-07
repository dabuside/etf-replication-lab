import { fetchJson, fetchText } from '../http.ts';
import type { PriceSeries } from '../types.ts';

const EM_PUSH2 = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const TX_FQKLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

/**
 * Price sources, in preference order.
 *
 * Eastmoney's push2his endpoint is the primary source but rate-limits hard and
 * starts dropping TLS connections once you pull a few hundred series, so
 * Tencent's fqkline endpoint backs it up. Both serve forward-adjusted
 * (前复权) closes, which is what a buy-and-hold investor actually earns.
 *
 * Eastmoney market prefix: 1 = Shanghai, 0 = Shenzhen/Beijing.
 */
function emSecid(code: string): string {
  return `${code.startsWith('6') || code.startsWith('9') || code.startsWith('5') ? 1 : 0}.${code}`;
}

/** Tencent prefix: sh/sz/bj. */
function txSymbol(code: string): string {
  if (/^(6|9|5)/.test(code)) return `sh${code}`;
  if (/^(4|8|92)/.test(code)) return `bj${code}`;
  return `sz${code}`;
}

interface EmKlineResp {
  data: { klines: string[] } | null;
}

interface TxResp {
  data: Record<string, Record<string, unknown>> | null;
}

/** Concurrency-limited map, so 100 constituents don't trip upstream rate limits. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface PriceSourceOptions {
  begin: string;
  end: string;
  /** Force a specific provider instead of trying both. */
  prefer?: 'eastmoney' | 'tencent';
}

function emUrl(secid: string, o: PriceSourceOptions): string {
  return (
    `${EM_PUSH2}?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1` +
    `&beg=${o.begin.replace(/-/g, '')}&end=${o.end.replace(/-/g, '')}&lmt=2000`
  );
}

function txUrl(symbol: string, o: PriceSourceOptions): string {
  return `${TX_FQKLINE}?param=${symbol},day,${o.begin},${o.end},2000,qfq`;
}

/** Daily forward-adjusted closes for one security, with provider fallback. */
export async function fetchOne(code: string, o: PriceSourceOptions): Promise<PriceSeries> {
  const order: Array<'eastmoney' | 'tencent'> =
    o.prefer === 'eastmoney' ? ['eastmoney', 'tencent']
    : o.prefer === 'tencent' ? ['tencent', 'eastmoney']
    : ['eastmoney', 'tencent'];

  const errors: string[] = [];
  for (const provider of order) {
    try {
      if (provider === 'eastmoney') {
        const json = await fetchJson<EmKlineResp>(emUrl(emSecid(code), o), {
          referer: 'https://quote.eastmoney.com/',
        });
        const series = parseEmKlines(code, json);
        if (series.dates.length > 0) return series;
        errors.push('eastmoney: empty');
      } else {
        const json = await fetchJson<TxResp>(txUrl(txSymbol(code), o), {
          referer: 'https://gu.qq.com/',
        });
        const series = parseTxKlines(code, json, txSymbol(code));
        if (series.dates.length > 0) return series;
        errors.push('tencent: empty');
      }
    } catch (err) {
      errors.push(`${provider}: ${String(err).slice(0, 90)}`);
    }
  }
  throw new Error(`no price series for ${code} (${errors.join(' | ')})`);
}

export function fetchPrices(codes: string[], o: Partial<PriceSourceOptions> = {}): Promise<PriceSeries[]> {
  const opts: PriceSourceOptions = { begin: '2024-01-01', end: '2026-10-10', ...o };
  return mapLimit(codes, 6, (code) => fetchOne(code, opts));
}

/**
 * Index 980092 (国证自由现金流), for long-horizon comparison.
 *
 * Eastmoney's index endpoint is blocked at the network layer here, so 10jqka is
 * the working source: it serves the full daily history in one JSONP call.
 * Field order is date, open, high, low, close, volume, amount.
 */
const THS_LINE = 'https://d.10jqka.com.cn/v6/line/zs_';

export async function fetchIndexSeries(code: string, o: Partial<PriceSourceOptions> = {}): Promise<PriceSeries> {
  const _opts: PriceSourceOptions = { begin: '2024-08-01', end: '2026-10-10', ...o };
  void _opts;
  const url = `${THS_LINE}${code}/01/all.js`;
  const raw = await fetchText(url, { referer: 'https://stockpage.10jqka.com.cn/' });
  const series = parseThsIndex(code, raw);
  if (series.dates.length === 0) throw new Error(`index ${code} returned no data`);
  return series;
}

/** Extracts the JSONP payload from 10jqka's `quotebridge_v6_line_*` wrapper. */
export function parseThsIndex(code: string, raw: string): PriceSeries {
  const start = raw.indexOf('(');
  const end = raw.lastIndexOf(')');
  if (start < 0 || end <= start) return { code, dates: [], closes: [] };

  let payload: { data?: string };
  try {
    payload = JSON.parse(raw.slice(start + 1, end)) as { data?: string };
  } catch {
    return { code, dates: [], closes: [] };
  }

  const dates: string[] = [];
  const closes: number[] = [];
  for (const row of (payload.data ?? '').split(';')) {
    if (!row) continue;
    const f = row.split(',');
    const ymd = f[0];
    const close = f[4];
    if (!ymd || !close) continue;
    dates.push(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`);
    // priceFactor is 100, so the raw value is already 2dp-scaled.
    closes.push(Number(close));
  }
  return { code, dates, closes };
}

export function parseEmKlines(code: string, json: EmKlineResp): PriceSeries {
  const dates: string[] = [];
  const closes: number[] = [];
  for (const line of json.data?.klines ?? []) {
    // date,open,close,high,low,volume,amount,amplitude,pct,change,turnover
    const [date, , close] = line.split(',');
    if (!date || !close) continue;
    dates.push(date);
    closes.push(Number(close));
  }
  return { code, dates, closes };
}

export function parseTxKlines(code: string, json: TxResp, symbol: string): PriceSeries {
  const node = json.data?.[symbol];
  if (!node) return { code, dates: [], closes: [] };
  const rows = (node['qfqday'] ?? node['day']) as Array<string[]> | undefined;
  const dates: string[] = [];
  const closes: number[] = [];
  for (const r of rows ?? []) {
    // date, open, close, high, low, volume
    const [date, , close] = r;
    if (!date || !close) continue;
    dates.push(date);
    closes.push(Number(close));
  }
  return { code, dates, closes };
}

/**
 * Per-stock cash dividend history, tax-inclusive (含税) per share.
 *
 * This is what lets us back-solve the ETF's gross dividend income instead of
 * assuming an effective tax rate: gross = shares_held x DPS for every ex-date
 * inside the reporting window.
 */
export interface DividendRecord {
  code: string;
  /** Ex-dividend date, ISO. */
  exDate: string;
  /**
   * Cash dividend per share, 元, pre-tax (含税, 每10股派息 / 10).
   *
   * The upstream PRETAX_BONUS_RMB field is expressed per 10 shares. Verified
   * against known payouts: 中国海油 6.6612 -> 0.6661 元/股,
   * 中国电信 1.812 -> 0.1812 元/股, 格力电器 20 -> 2.00 元/股.
   */
  dpsPreTax: number;
}

export async function fetchDividends(code: string): Promise<DividendRecord[]> {
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    `?reportName=RPT_SHAREBONUS_DET&columns=SECURITY_CODE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB` +
    `&filter=${encodeURIComponent(`(SECURITY_CODE="${code}")`)}&pageSize=200&pageNumber=1` +
    `&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1`;
  const json = await fetchJson<{ result: { data: Array<Record<string, unknown>> } | null }>(url);
  return (json.result?.data ?? [])
    .map((r) => ({
      code,
      exDate: String(r['EX_DIVIDEND_DATE'] ?? '').slice(0, 10),
      // Upstream reports 每10股派息; normalise to per-share.
      dpsPreTax: Number(r['PRETAX_BONUS_RMB'] ?? 0) / 10,
    }))
    .filter((d) => d.exDate.length === 10 && d.dpsPreTax > 0);
}

export async function fetchDividendHistory(codes: string[]): Promise<Record<string, DividendRecord[]>> {
  const out: Record<string, DividendRecord[]> = {};
  const results = await mapLimit(codes, 6, async (code) => {
    try {
      return [code, await fetchDividends(code)] as const;
    } catch (err) {
      console.warn(`  dividends ${code}: ${String(err).slice(0, 80)}`);
      return [code, [] as DividendRecord[]] as const;
    }
  });
  for (const [code, recs] of results) out[code] = recs;
  return out;
}

/** Text fetch re-export so callers don't need to know about http internals. */
export { fetchText };
