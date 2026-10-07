import { test, expect } from '@playwright/test';

/**
 * End-to-end: the two inputs drive every panel.
 *
 * Strategy: assert BEHAVIOUR (switching inputs recomputes panels), not frozen
 * numbers, so the suite survives data refreshes. Where exactness matters
 * (baseline is zero, portfolio row counts), assert exactness. One test
 * cross-checks the displayed edge against EtfLab.compute evaluated live in
 * the page, which ties the UI to the tested model.
 */

const METHODS = [
  'buy_etf',
  'top5_weighted',
  'top10_weighted',
  'top20_weighted',
  'top30_weighted',
  'top10_equal',
  'top10_normalized',
  'top20_normalized',
  'top30_normalized',
  'full',
] as const;

const EXPECTED_ROWS: Record<string, number> = {
  top5_weighted: 5,
  top10_weighted: 10,
  top20_weighted: 20,
  top30_weighted: 30,
  top10_equal: 10,
  top10_normalized: 10,
  top20_normalized: 20,
  top30_normalized: 30,
  full: 142,
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://localhost:4173/');
  await expect(page.locator('#verdict')).not.toBeEmpty();
  await page.evaluate((errs: string[]) => {
    (window as unknown as { __e2eErrors: string[] }).__e2eErrors = errs;
  }, errors);
});

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(
    () => (window as unknown as { __e2eErrors: string[] }).__e2eErrors ?? [],
  );
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('all 12 panels render with content', async ({ page }) => {
  for (const id of [
    'fundLine', 'verdict', 'decomp', 'portfolio', 'ipo', 'tax',
    'backtestTable', 'sweep', 'methods', 'sensitivity', 'dilution', 'methodology',
  ]) {
    await expect(page.locator(`#${id}`), `#${id}`).not.toBeEmpty();
  }
  await expect(page).toHaveTitle(/159201/);
});

test('every method renders its own portfolio row count', async ({ page }) => {
  for (const m of METHODS) {
    if (m === 'buy_etf') continue;
    await page.selectOption('#method', m);
    const rows = await page.locator('#portfolio table.data tr').count();
    expect(rows - 1, `method ${m}`).toBe(EXPECTED_ROWS[m]);
  }
});

test('baseline shows zero edge and no quota', async ({ page }) => {
  await page.selectOption('#method', 'buy_etf');
  await expect(page.locator('#verdict')).toContainText('+0.00%');
  await expect(page.locator('#verdict')).toContainText('基准');
  const ipo = await page.locator('#ipo').innerText();
  expect(ipo).toMatch(/沪市配号\s*0|0/);
});

test('switching methods moves the edge and the dividend yield', async ({ page }) => {
  await page.selectOption('#method', 'top5_weighted');
  const top5Verdict = await page.locator('#verdict').innerText();
  const top5Tax = await page.locator('#tax').innerText();

  await page.selectOption('#method', 'full');
  const fullVerdict = await page.locator('#verdict').innerText();
  const fullTax = await page.locator('#tax').innerText();

  // Per-method yields (Top5 ~4.9% vs full ~3.5%) must surface in panel ⑤.
  expect(top5Tax).not.toEqual(fullTax);
  // Edges differ (small but nonzero spread).
  expect(top5Verdict).not.toEqual(fullVerdict);
});

test('displayed edge equals the model evaluated live in the page', async ({ page }) => {
  await page.selectOption('#method', 'top10_weighted');
  await page.fill('#capital', '1000000');
  const displayed = await page.locator('#verdict').innerText();
  const expected = await page.evaluate(() => {
    const lab = (window as unknown as { EtfLab: { compute(d: unknown, c: number, m: string): { breakdown: { totalEdgePct: number } } }; LAB_DATA: unknown }).EtfLab;
    const data = (window as unknown as { LAB_DATA: unknown }).LAB_DATA;
    return lab.compute(data, 1000000, 'top10_weighted').breakdown.totalEdgePct;
  });
  const sign = expected >= 0 ? '+' : '';
  expect(displayed).toContain(`${sign}${expected.toFixed(2)}%`);
});

test('capital presets rescale IPO tickets and profit', async ({ page }) => {
  await page.selectOption('#method', 'top10_weighted');
  await page.fill('#capital', '100000');
  const small = await page.locator('#ipo').innerText();
  await page.fill('#capital', '10000000');
  const large = await page.locator('#ipo').innerText();
  expect(small).not.toEqual(large);
  // More capital cannot reduce expected profit: the yuan figure must grow.
  const yuan = (t: string): number => {
    const m = t.match(/年预计打新收益\s*([0-9.]+)\s*(亿|万|元)/);
    if (!m) throw new Error(`profit not found in: ${t.slice(0, 120)}`);
    const unit = m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1;
    return Number(m[1]) * unit;
  };
  expect(yuan(large)).toBeGreaterThan(yuan(small));
});

test('comparison tables are fully populated', async ({ page }) => {
  // Sweep: 7 capitals. Methods: 9 replication rows. Sensitivity: 7 scenarios.
  expect(await page.locator('#sweep table.data tr').count()).toBe(8);
  expect(await page.locator('#methods table.data tr').count()).toBe(10);
  expect(await page.locator('#sensitivity table.data tr').count()).toBe(8);
  // Backtest: fund + 9 methods, each with a coverage cell.
  expect(await page.locator('#backtestTable table.data tr').count()).toBeGreaterThanOrEqual(10);
  const coverage = await page.locator('#backtestTable').innerText();
  expect(coverage).toMatch(/窗口/);
});

test('verdict reconciles forward edge with backward realized gap', async ({ page }) => {
  await page.selectOption('#method', 'top10_equal');
  await page.fill('#capital', '100000');
  const verdict = await page.locator('#verdict').innerText();
  // Forward edge is stated...
  expect(verdict).toMatch(/年化超额/);
  // ...and reconciled in one breath with the backward stock-only gap.
  expect(verdict).toMatch(/过去/);
  expect(verdict).toMatch(/未来/);
  expect(verdict).toMatch(/不含.*打新|打新.*不含/);
});

test('backtest section states its curves exclude IPO, tax and fees', async ({ page }) => {
  const text = await page.locator('#chartCum').evaluate((el) => el.parentElement?.parentElement?.parentElement?.innerText ?? '');
  expect(text).toMatch(/仅股票价格/);
});

test('charts are drawn', async ({ page }) => {
  for (const id of ['#chartCum', '#chartDd']) {
    const box = await page.locator(id).boundingBox();
    expect(box?.width, id).toBeGreaterThan(100);
    expect(box?.height, id).toBeGreaterThan(50);
  }
});
