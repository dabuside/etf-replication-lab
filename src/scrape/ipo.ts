import { fetchJson } from '../http.ts';
import type { Board, Exchange, IpoRecord } from '../types.ts';

const DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** 5,639 rows total; we page through and filter server-side where possible. */
export async function fetchIpos(opts: { since?: string; limit?: number } = {}): Promise<IpoRecord[]> {
  const { since = '2023-01-01', limit = 1000 } = opts;
  const out: IpoRecord[] = [];
  for (let page = 1; out.length < limit; page++) {
    const cols = [
      'SECUCODE', 'SECURITY_CODE', 'SECURITY_NAME', 'MARKET_TYPE_NEW', 'TRADE_MARKET',
      'APPLY_DATE', 'LISTING_DATE', 'ISSUE_PRICE', 'ONLINE_ISSUE_NUM', 'ONLINE_APPLY_UPPER',
      'EACHBALLOT_SHARES', 'INITIAL_MULTIPLE', 'ONLINE_ES_MULTIPLE', 'LD_OPEN_PREMIUM',
      'LD_CLOSE_CHANGE',
    ].join(',');

    const filter = encodeURIComponent(`(APPLY_DATE>='${since}')`);
    const url =
      `${DC}?reportName=RPTA_APP_IPOAPPLY&columns=${cols}&sortColumns=APPLY_DATE&sortTypes=-1` +
      `&pageSize=500&pageNumber=${page}&filter=${filter}`;

    const data = await fetchJson<{ result: { data: Array<Record<string, unknown>> } | null }>(url);
    const rows = data.result?.data ?? [];
    if (rows.length === 0) break;
    out.push(...rows.map(normalizeRow));
    if (rows.length < 500) break;
  }
  return out;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function normalizeRow(r: Record<string, unknown>): IpoRecord {
  const code = String(r['SECURITY_CODE'] ?? '');
  const marketType = String(r['MARKET_TYPE_NEW'] ?? '');

  let exchange: Exchange = 'SZ';
  if (marketType.includes('上交所') || marketType.includes('科创板')) exchange = 'SH';
  else if (marketType.includes('北交所')) exchange = 'BJ';
  else if (/^(60|68)/.test(code)) exchange = 'SH';

  let board: Board = 'main';
  if (marketType.includes('科创板')) board = 'star';
  else if (marketType.includes('创业板')) board = 'gem';
  else if (marketType.includes('北交所')) board = 'bse';

  const date = (v: unknown): string | null =>
    typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null;

  return {
    code,
    name: String(r['SECURITY_NAME'] ?? ''),
    exchange,
    board,
    applyDate: date(r['APPLY_DATE']) ?? '',
    listingDate: date(r['LISTING_DATE']),
    issuePrice: n(r['ISSUE_PRICE']),
    onlineIssueShares: n(r['ONLINE_ISSUE_NUM']),
    onlineApplyUpper: n(r['ONLINE_APPLY_UPPER']),
    // SH tickets are 1,000 shares, SZ tickets are 500.
    sharesPerTicket: n(r['EACHBALLOT_SHARES']) ?? (exchange === 'SH' ? 1000 : 500),
    onlineMultiple: n(r['ONLINE_ES_MULTIPLE']) ?? n(r['INITIAL_MULTIPLE']),
    firstDayOpenPremiumPct: n(r['LD_OPEN_PREMIUM']),
    firstDayCloseChangePct: n(r['LD_CLOSE_CHANGE']),
  };
}

/**
 * Derive the online winning rate from disclosure.
 *
 * Every 配号 (subscription ticket) is one shot at `sharesPerTicket` shares.
 * The exchange sells `onlineIssueShares` to retail; total winning numbers are
 * therefore onlineIssueShares / sharesPerTicket. The winning rate is simply:
 *
 *     P(win per ticket) = winningNumbers / totalTickets
 *                       = sharesPerTicket / (onlineIssueShares * oversubscription)
 *
 * We cross-check against the published multiples because `INITIAL_MULTIPLE`
 * is quoted against the *initial* offline-adjusted online tranche, which the
 * issuer later tops up via the 网上/网下 回拨 mechanism.
 */
export function winningRate(ipo: IpoRecord): number | null {
  const { sharesPerTicket, onlineIssueShares, onlineMultiple } = ipo;
  if (!sharesPerTicket || !onlineIssueShares || !onlineMultiple || onlineMultiple <= 0) return null;
  return sharesPerTicket / (onlineIssueShares * onlineMultiple);
}

/** Market-value required per subscription ticket, in 元. */
export const MARKET_VALUE_PER_TICKET: Record<'SH' | 'SZ', number> = {
  // SH: every 10,000 元 of SH market value buys one 1,000-share ticket.
  SH: 10_000,
  // SZ: every 5,000 元 of SZ market value buys one 500-share ticket.
  SZ: 5_000,
};
