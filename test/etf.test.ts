import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { exchangeOf, parseHoldingRows, parseHoldingsAll, parseNavHistory, parseReportFinancials, parseUnderwriting } from '../src/scrape/etf.ts';
import { parseEmKlines, parseThsIndex, parseTxKlines } from '../src/scrape/stocks.ts';

/** Trimmed capture of the live 2026 holdings payload. */
const HOLDINGS_PAYLOAD = `
<div class='boxitem w790'><h4 class='t'><label class='left'><a title='自由现金流ETF华夏' href='http://fund.eastmoney.com/159201.html'>自由现金流ETF华夏</a>&nbsp;2026年2季度股票投资明细</label><label class='right lab2 xq505'>&nbsp;来源：天天基金&nbsp;截止至：<font class='px12'>2026-06-30</font></label></h4>
<table><thead><tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>最新价</th><th>涨跌幅</th><th>相关资讯</th><th>占净值<br />比例</th><th>持股数<br />（万股）</th><th>持仓市值<br />（万元）</th></tr></thead><tbody>
<tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/1.601728'>601728</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/1.601728'>中国电信</a></td><td class='tor'><span data-id='dq601728'></span></td><td class='tor'><span data-id='zd601728'></span></td><td class='xglj'><a href='ccbdxq_159201_601728.html'>变动详情</a><a href='//guba.eastmoney.com/x'>股吧</a><a href='//quote.eastmoney.com/x'>行情</a></td><td class='tor'>8.25%</td><td class='tor'>20,603.52</td><td class='tor'>106,932.25</td></tr>
<tr><td>2</td><td><a href='//quote.eastmoney.com/unify/r/1.600938'>600938</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/1.600938'>中国海油</a></td><td class='tor'><span data-id='dq600938'></span></td><td class='tor'><span data-id='zd600938'></span></td><td class='xglj'><a href='ccbdxq_159201_600938.html'>变动详情</a><a href='//guba.eastmoney.com/x'>股吧</a><a href='//quote.eastmoney.com/x'>行情</a></td><td class='tor'>8.24%</td><td class='tor'>3,930.39</td><td class='tor'>106,710.09</td></tr>
<tr><td>3</td><td><a href='//quote.eastmoney.com/unify/r/0.000651'>000651</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/0.000651'>格力电器</a></td><td class='tor'><span data-id='dq000651'></span></td><td class='tor'><span data-id='zd000651'></span></td><td class='xglj'><a href='ccbdxq_159201_000651.html'>变动详情</a><a href='//guba.eastmoney.com/x'>股吧</a><a href='//quote.eastmoney.com/x'>行情</a></td><td class='tor'>6.46%</td><td class='tor'>5,120.00</td><td class='tor'>210,000.00</td></tr>
</tbody></table></div>
`;

describe('exchange classification', () => {
  test('routes SH, SZ and BJ prefixes correctly', () => {
    assert.equal(exchangeOf('601728'), 'SH'); // 中国电信, 上交所主板
    assert.equal(exchangeOf('600938'), 'SH'); // 中国海油
    assert.equal(exchangeOf('688797'), 'SH'); // 科创板
    assert.equal(exchangeOf('000651'), 'SZ'); // 格力电器, 深交所主板
    assert.equal(exchangeOf('300750'), 'SZ'); // 创业板
    assert.equal(exchangeOf('001393'), 'SZ');
    assert.equal(exchangeOf('920193'), 'BJ'); // 北交所
  });
});

describe('holdings parsing', () => {
  const rows = parseHoldingRows(HOLDINGS_PAYLOAD);

  test('captures code, name, weight, shares and value', () => {
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      code: '601728',
      name: '中国电信',
      exchange: 'SH',
      weightPct: 8.25,
      sharesWan: 20603.52,
      valueWan: 106932.25,
    });
  });

  test('matches the published 2026Q2 top weights', () => {
    // These two figures are the anchor for the whole replication analysis.
    assert.equal(rows[0]!.weightPct, 8.25);
    assert.equal(rows[1]!.weightPct, 8.24);
    assert.equal(rows[2]!.weightPct, 6.46);
  });

  test('strips thousands separators from share counts', () => {
    assert.equal(rows[0]!.sharesWan, 20603.52);
    assert.ok(Number.isFinite(rows[0]!.sharesWan));
  });

  test('assigns each row its exchange', () => {
    assert.deepEqual(rows.map((r) => r.exchange), ['SH', 'SH', 'SZ']);
  });
});

describe('multi-quarter payload splitting', () => {
  const payload = HOLDINGS_PAYLOAD.replace(
    '</div>',
    `</div><div class='boxitem w790'><h4 class='t'><label class='left'>自由现金流ETF华夏 2026年1季度股票投资明细</label><label class='right'>截止至：<font class='px12'>2026-03-31</font></label></h4>
    <table><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/0.000625'>000625</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/0.000625'>上汽集团</a></td><td class='tor'><span></span></td><td class='tor'><span></span></td><td class='xglj'><a href='x'>v</a><a href='y'>g</a><a href='z'>q</a></td><td class='tor'>9.11%</td><td class='tor'>1,000.00</td><td class='tor'>15,000.00</td></tr></tbody></table></div>`,
  );
  const snaps = parseHoldingsAll(payload);

  test('splits one response into per-quarter snapshots', () => {
    assert.equal(snaps.length, 2);
  });

  test('does not leak rows across the quarter boundary', () => {
    const q2 = snaps.find((s) => s.period === '2026Q2');
    assert.equal(q2?.holdings.length, 3);
    const q1 = snaps.find((s) => s.period === '2026Q1');
    assert.equal(q1?.holdings.length, 1);
    assert.equal(q1?.holdings[0]?.name, '上汽集团');
  });

  test('returns snapshots newest first', () => {
    assert.equal(snaps[0]?.period, '2026Q2');
  });

  test('records the period-end date from the disclosure', () => {
    assert.equal(snaps[0]?.asOf, '2026-06-30');
    assert.equal(snaps[1]?.asOf, '2026-03-31');
  });
});

describe('NAV history parsing', () => {
  const payload = `var apidata={Data_netWorthTrend:[{"x":1739894400000,"y":1.0,"equityReturn":0},{"x":1740067200000,"y":1.0019,"equityReturn":0}],Data_ACWorthTrend:[]};`;
  const nav = parseNavHistory(payload);

  test('reads unit NAV in order', () => {
    assert.equal(nav.length, 2);
    assert.equal(nav[0]!.nav, 1.0);
    assert.equal(nav[1]!.nav, 1.0019);
  });

  test('converts epoch millis to ISO dates', () => {
    assert.match(nav[0]!.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('throws rather than returning empty on a shape change', () => {
    assert.throws(() => parseNavHistory('var x=1;'), /Data_netWorthTrend/);
  });
});

describe('interim report extraction', () => {
  // Facts as published in the 2026 中期报告.
  const REPORT = `
6.4.6 税项
...(8)对基金在境内取得的股票的股息、红利收入，由上市公司在向基金派发股息、红利收入时代扣代缴 20%的个人所得税，暂不征收企业所得税。基金在境内从上市公司分配取得的股息红利所得，持股期限在 1 个月以内（含 1 个月）的，全额计入应纳税所得额，持股期限在 1 个月以上至 1 年（含 1 年）的，减按 50%计入应纳税所得额，持股期限超过 1 年的，暂免征收个人所得税。
7.税金及附加 0.68 -
8.其他费用 1 72,020.84 65,147.32
3.公允价值变动收益（损失以“-”号填列） -2,658,561,441.32
股利收益 6.4.7.16 157,614,890.25 49,313,720.65
减：二、营业总支出 15,885,402.53 2,457,858.67
1.管理人报酬 11,860,035.77 1,837,637.79
2.托管费 3,953,345.24 555,073.56
6.4.7.16 股利收益
股票投资产生的股利收益 157,614,890.25
6.4.10.7 本基金在承销期内参与关联方承销证券的情况
本期
2026 年 1 月 1 日至 2026 年 6 月 30 日
关联方名称 证券代码 证券名称 发行方式 数量（单位：股/张） 总金额
中信证券 688820 盛合晶微 新股发行 23,902 470,391.36
中信证券 688808 联讯仪器 新股发行 1,624 132,973.12
中信证券 688785 恒运昌 新股发行 1,155 106,467.90
中信证券 688797 臻宝科技 新股发行 2,070 92,239.20
中信证券 301683 慧谷新材 新股发行 952 74,617.76
中信证券 688811 有研复材 新股发行 8,337 53,440.17
中泰证券 001393 维通利 新股发行 1,287 39,099.06
中信证券 301669 高特电子 新股发行 5,455 38,621.40
中信证券 001312 福恩股份 新股发行 1,333 24,500.54
中信证券 001248 华润新能源 新股发行 500 5,055.00
上年度可比期间
2025 年 2 月 19 日（基金合同生效日）至 2025 年 6 月 30 日
中信证券 688775 影石创新 新股发行 5,725 270,620.75
中信证券 688755 汉邦科技 新股发行 2,023 46,063.71
6.4.10.8 其他关联交易事项的说明
无。
截至 2026 年 6 月 30 日，本基金份额净值为 1.0620 元，本报告期份额净值增长率为-12.51%，同
期业绩比较基准增长率-13.39%。本基金本报告期跟踪偏离度为+0.88%，
`;

  const uw = parseUnderwriting(REPORT, '2026H1', '2026-06-30');
  const fin = parseReportFinancials(REPORT, '2026H1', '2026-06-30');

  test('reads all ten H1 2026 IPO participations', () => {
    assert.equal(uw.entries.length, 10);
  });

  test('excludes the prior-year comparable block', () => {
    assert.equal(uw.entries.find((e) => e.name === '影石创新'), undefined);
    assert.equal(uw.entries.find((e) => e.name === '汉邦科技'), undefined);
  });

  test('totals the disclosed amounts', () => {
    // Golden value: summing the ten published rows must reproduce the disclosure.
    assert.equal(uw.totalShares, 46615);
    assert.equal(uw.totalAmountYuan, 1037405.51);
  });

  test('the biggest single deal is 盛合晶微 at 470,391.36 元', () => {
    const top = uw.entries[0];
    assert.equal(top?.name, '盛合晶微');
    assert.equal(top?.amountYuan, 470391.36);
  });

  test('labels the lane as offline (网下)', () => {
    assert.equal(uw.lane, 'offline');
  });

  test('reads net dividend income as disclosed', () => {
    assert.equal(fin.dividendIncomeYuan, 157614890.25);
  });

  test('reads management and custody fees as disclosed', () => {
    assert.equal(fin.managementFeeYuan, 11860035.77);
    assert.equal(fin.custodyFeeYuan, 3953345.24);
  });

  test('back-solves an average NAV consistent with a ~160亿 fund', () => {
    // 11.86m over half a year at 0.15% p.a. implies a large average book.
    assert.ok(fin.impliedAvgNavYuan > 100e8, `got ${fin.impliedAvgNavYuan}`);
    assert.ok(fin.impliedAvgNavYuan < 220e8, `got ${fin.impliedAvgNavYuan}`);
  });

  test('reads NAV and benchmark growth despite the line wrap', () => {
    assert.equal(fin.navGrowthPct, -12.51);
    assert.equal(fin.benchmarkGrowthPct, -13.39);
  });

  test('gross dividend is left for the derive stage to back-solve', () => {
    assert.equal(fin.grossDividendIncomeYuan, null);
  });
});

describe('price series parsing', () => {
  test('reads Eastmoney klines', () => {
    const s = parseEmKlines('601728', { data: { klines: ['2025-01-02,6.69,6.58,6.75,6.50,1,1,1,1,1,1'] } });
    assert.deepEqual(s.dates, ['2025-01-02']);
    assert.deepEqual(s.closes, [6.58]);
  });

  test('reads Tencent qfq klines', () => {
    const s = parseTxKlines('601728', { data: { sh601728: { qfqday: [['2026-09-02', '6.359', '6.309', '6.369', '6.239', '1']] } } }, 'sh601728');
    assert.deepEqual(s.dates, ['2026-09-02']);
    assert.deepEqual(s.closes, [6.309]);
  });

  test('unwraps the 10jqka JSONP envelope and maps YYYYMMDD to ISO', () => {
    const raw = 'quotebridge_v6_line_zs_980092_01_all({"data":"20260311,6131.57,6209.26,6111.67,6202.43,4766757200,78469431000.00,,,,0;20260312,6219.54,6256.1,6220.0,6240.0,1,1,,,,0","name":"CNIFCF"})';
    const s = parseThsIndex('980092', raw);
    assert.equal(s.dates.length, 2);
    assert.equal(s.dates[0], '2026-03-11');
    // Column 4 is the close, not the open.
    assert.equal(s.closes[0], 6202.43);
  });

  test('returns an empty series rather than throwing on malformed input', () => {
    assert.deepEqual(parseThsIndex('980092', 'not jsonp').dates, []);
  });
});
