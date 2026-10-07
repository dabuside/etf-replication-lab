import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedProfit,
  expectedWins,
  expectedWinsDetailed,
  MARKET_VALUE_PER_TICKET,
  profitPerWin,
  ticketsFromMarketValue,
} from '../src/domain/ipo.ts';
import { winningRate } from '../src/scrape/ipo.ts';
import type { IpoRecord } from '../src/types.ts';

function ipo(over: Partial<IpoRecord> = {}): IpoRecord {
  return {
    code: '000001',
    name: 'TEST',
    exchange: 'SZ',
    board: 'main',
    applyDate: '2026-01-01',
    listingDate: '2026-01-10',
    issuePrice: 20,
    onlineIssueShares: 10_000_000,
    onlineApplyUpper: 5_000,
    sharesPerTicket: 500,
    onlineMultiple: 3_000,
    firstDayOpenPremiumPct: 150,
    firstDayCloseChangePct: 120,
    ...over,
  };
}

describe('market value to 配号 conversion', () => {
  test('Shenzhen gives a ticket per 5,000 元', () => {
    assert.equal(MARKET_VALUE_PER_TICKET.SZ, 5_000);
    assert.equal(ticketsFromMarketValue(50_000, 'SZ'), 10);
  });

  test('Shanghai gives a ticket per 10,000 元 — twice as expensive', () => {
    assert.equal(MARKET_VALUE_PER_TICKET.SH, 10_000);
    assert.equal(ticketsFromMarketValue(50_000, 'SH'), 5);
  });

  test('the same capital buys twice the tickets in Shenzhen', () => {
    const cap = 100_000;
    assert.equal(ticketsFromMarketValue(cap, 'SZ') / ticketsFromMarketValue(cap, 'SH'), 2);
  });

  test('sub-threshold market value yields no ticket rather than a fractional one', () => {
    assert.equal(ticketsFromMarketValue(9_999, 'SH'), 0);
    assert.equal(ticketsFromMarketValue(10_000, 'SH'), 1);
    assert.equal(ticketsFromMarketValue(4_999, 'SZ'), 0);
    assert.equal(ticketsFromMarketValue(5_000, 'SZ'), 1);
  });

  test('leftover value below the threshold is discarded, per the rules', () => {
    // 12,500 元 SH -> one ticket; the 2,500 remainder does not count.
    assert.equal(ticketsFromMarketValue(12_500, 'SH'), 1);
    assert.equal(ticketsFromMarketValue(25_000, 'SH'), 2);
  });

  test('negative market value is rejected', () => {
    assert.throws(() => ticketsFromMarketValue(-1, 'SH'), /market value/i);
  });
});

describe('winning rate derivation', () => {
  test('is ticket size over total valid demand', () => {
    // 500 shares per ticket, 10m shares offered at 3,000x oversubscription.
    const p = winningRate(ipo());
    assert.ok(p !== null);
    // 500 / (10,000,000 * 3,000) = 1.6667e-8
    assert.ok(Math.abs(p - 1.6667e-8) < 1e-12);
  });

  test('returns null when the disclosure is incomplete', () => {
    assert.equal(winningRate(ipo({ onlineMultiple: null })), null);
    assert.equal(winningRate(ipo({ onlineIssueShares: null })), null);
    assert.equal(winningRate(ipo({ sharesPerTicket: null })), null);
  });

  test('rejects a non-positive oversubscription multiple', () => {
    assert.equal(winningRate(ipo({ onlineMultiple: 0 })), null);
    assert.equal(winningRate(ipo({ onlineMultiple: -5 })), null);
  });
});

describe('expected wins respect the per-investor subscription cap', () => {
  const offering = ipo({ onlineApplyUpper: 5_000, onlineMultiple: 3_000 });

  test('market value is the binding constraint when it is small', () => {
    // 50,000 元 SZ buys 10 tickets = 5,000 shares, exactly the cap: not binding.
    const tickets = ticketsFromMarketValue(50_000, 'SZ');
    assert.equal(tickets, 10);
    const r = expectedWinsDetailed(tickets, offering, 'SZ');
    assert.equal(r.cappedTickets, 10);
    assert.equal(r.capBinds, false);
  });

  test('the online cap binds when market value is very large', () => {
    // 10m 元 SZ implies 2,000 tickets = 1m shares, but the cap is 5,000 shares.
    const tickets = ticketsFromMarketValue(10_000_000, 'SZ');
    assert.equal(tickets, 2_000);
    const r = expectedWinsDetailed(tickets, offering, 'SZ');
    assert.equal(r.capBinds, true);
    assert.equal(r.cappedTickets, offering.onlineApplyUpper! / 500);
    // Winning more capital cannot push expected wins past the capped ceiling.
    assert.ok(r.wins <= expectedWins(Number.POSITIVE_INFINITY, offering, 'SZ'));
  });

  test('a Beijing listing is excluded from retail online economics', () => {
    const bse = ipo({ exchange: 'BJ', board: 'bse' });
    assert.equal(expectedWins(100, bse, 'BJ'), 0);
  });

  test('an unlisted or missing-premium IPO contributes zero rather than NaN', () => {
    const pending = ipo({ listingDate: null, firstDayOpenPremiumPct: null });
    assert.equal(expectedWins(100, pending, 'SZ'), 0);
  });

  test('larger capital cannot reduce expected wins', () => {
    const prev: number[] = [];
    for (const cap of [10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000]) {
      const t = ticketsFromMarketValue(cap, 'SZ');
      prev.push(expectedWins(t, offering, 'SZ'));
    }
    for (let i = 1; i < prev.length; i++) {
      assert.ok(prev[i]! >= prev[i - 1]!, `expected wins fell from ${prev[i - 1]} to ${prev[i]}`);
    }
  });
});

describe('expected profit', () => {
  test('per-win profit is first-day open gain, which is what a hit is worth', () => {
    // 500 shares x 20 元 x 150% premium = 15,000 元
    const one = ipo({ issuePrice: 20, sharesPerTicket: 500, firstDayOpenPremiumPct: 150 });
    const res = expectedProfit([{ ipo: one, wins: 1, exchange: 'SZ' as const }]);
    assert.equal(res, 15_000);
  });

  test('an empty sample yields zero', () => {
    assert.equal(expectedProfit([]), 0);
  });

  test('never returns negative profit from a negative premium', () => {
    const broke = ipo({ issuePrice: 20, sharesPerTicket: 500, firstDayOpenPremiumPct: -30 });
    assert.equal(expectedProfit([{ ipo: broke, wins: 1, exchange: 'SZ' }]), 0);
  });

  test('totals are additive across the IPO sample', () => {
    const a = ipo({ issuePrice: 20, sharesPerTicket: 500, firstDayOpenPremiumPct: 100, exchange: 'SZ' });
    const b = ipo({ issuePrice: 40, sharesPerTicket: 1000, firstDayOpenPremiumPct: 50, exchange: 'SH' });
    const total = expectedProfit([
      { ipo: a, wins: 1, exchange: 'SZ' },
      { ipo: b, wins: 1, exchange: 'SH' },
    ]);
    assert.equal(total, 10_000 + 20_000);
  });
});
