import type { Exchange, IpoRecord } from '../types.ts';

/**
 * Derive the online winning rate from disclosure.
 *
 * Each 配号 (subscription ticket) is one entry in the lottery; the exchange
 * draws winning numbers until the online tranche is allocated. The winning
 * rate per ticket is therefore the reciprocal of the oversubscription multiple:
 *
 *     P(win) = 1 / onlineMultiple
 *
 * Validated against a published announcement: 沈鼓集团 (601091) discloses a
 * final 网上中签率 of 0.04703721%, and the data feed's ONLINE_ES_MULTIPLE of
 * 2125.98 gives 1/2125.98 = 0.04704%. Exact match, so the feed's multiple is
 * the post-回拨 final figure, which is the correct one to use.
 */
export function winningRate(ipo: IpoRecord): number | null {
  const { onlineMultiple } = ipo;
  if (!onlineMultiple || onlineMultiple <= 0) return null;
  return 1 / onlineMultiple;
}

/**
 * 网上发行 subscription mechanics.
 *
 *   上交所: every 10,000 元 of SH market value buys one 1,000-share ticket.
 *   深交所: every  5,000 元 of SZ market value buys one   500-share ticket.
 *
 * Both markets require >=10,000 元 of average market value over the 20 trading
 * days ending T-2, and the two are computed independently: SH market value
 * cannot buy SZ tickets. ETF/LOF units do not count toward market value at all,
 * which is why holding the ETF gives an individual nothing here.
 */
export const MARKET_VALUE_PER_TICKET: Record<'SH' | 'SZ', number> = {
  SH: 10_000,
  SZ: 5_000,
};

export function ticketsFromMarketValue(marketValue: number, exchange: 'SH' | 'SZ'): number {
  if (!Number.isFinite(marketValue) || marketValue < 0) {
    throw new Error(`invalid market value: ${marketValue}`);
  }
  const unit = MARKET_VALUE_PER_TICKET[exchange];
  // The rules explicitly discard the remainder below the threshold.
  return Math.floor(marketValue / unit);
}

/** Per-investor ticket count after applying the IPO's online subscription cap. */
export function expectedWins(
  tickets: number,
  ipo: IpoRecord,
  exchange: 'SH' | 'SZ' | 'BJ',
): number {
  // Beijing Stock Exchange has a separate regime and is excluded from this model.
  if (exchange === 'BJ') return 0;
  if (!ipo.listingDate) return 0;

  const perTicket = ipo.sharesPerTicket ?? (exchange === 'SH' ? 1000 : 500);
  const cap = ipo.onlineApplyUpper;
  const cappedTickets = cap ? Math.min(tickets, Math.floor(cap / perTicket)) : tickets;

  const p = winningRate(ipo);
  if (p === null) return 0;
  return cappedTickets * p;
}

/** Detailed variant used by the model, which needs to know when the cap binds. */
export function expectedWinsDetailed(
  tickets: number,
  ipo: IpoRecord,
  exchange: 'SH' | 'SZ' | 'BJ',
): { wins: number; cappedTickets: number; capBinds: boolean } {
  if (exchange === 'BJ' || !ipo.listingDate) {
    return { wins: 0, cappedTickets: 0, capBinds: false };
  }
  const perTicket = ipo.sharesPerTicket ?? (exchange === 'SH' ? 1000 : 500);
  const cap = ipo.onlineApplyUpper;
  const capTickets = cap ? Math.floor(cap / perTicket) : Number.POSITIVE_INFINITY;
  const cappedTickets = Math.min(tickets, capTickets);
  const p = winningRate(ipo);
  return {
    wins: p === null ? 0 : cappedTickets * p,
    cappedTickets,
    capBinds: cappedTickets < tickets,
  };
}

/** What one winning ticket is worth, using the first-day open premium. */
export function profitPerWin(ipo: IpoRecord): number {
  const perTicket = ipo.sharesPerTicket ?? 500;
  const premium = ipo.firstDayOpenPremiumPct;
  if (ipo.issuePrice === null || premium === null) return 0;
  // A hit that opens below issue price is not a profit; floor at zero.
  return Math.max(0, perTicket * ipo.issuePrice * (premium / 100));
}

export interface WinOutcome {
  ipo: IpoRecord;
  wins: number;
  exchange: Exchange;
}

export function expectedProfit(outcomes: WinOutcome[]): number {
  return outcomes.reduce((sum, o) => sum + o.wins * profitPerWin(o.ipo), 0);
}
