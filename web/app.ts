/**
 * 159201 replication lab frontend. No imports, no fetch, no framework:
 * the build inlines the model bundle (EtfLab), the frozen dataset (LAB_DATA)
 * and this file into one HTML page that opens from disk.
 *
 * The page honours the two-inputs-only contract: capital + method are the only
 * controls. Everything else is computed live by EtfLab.compute.
 */

declare const LAB_DATA: LabData;
declare const EtfLab: {
  compute(
    dataset: unknown,
    capital: number,
    method: string,
    knobs?: { winRateMultiplier?: number; premiumMultiplier?: number; etfTaxRateOverride?: number },
  ): ModelResult;
  METHOD_LABELS: Record<string, string>;
  ALL_METHODS: string[];
};

/* ---------------- data shapes (structural, mirroring src/types.ts) ---------------- */

interface LabHolding {
  code: string;
  name: string;
  exchange: string;
  weightPct: number;
  sharesWan: number;
  valueWan: number;
}

interface LabSnapshot {
  period: string;
  asOf: string;
  holdings: LabHolding[];
}

interface LabCurvePoint {
  date: string;
  value: number;
}

interface LabBacktest {
  label: string;
  totalReturnPct: number;
  annualisedReturnPct: number;
  volatilityPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  trackingErrorPct: number;
  beta: number;
  alphaPct: number;
  correlation: number;
  activeSharePct: number;
  observations: number;
  windows: number;
  fullWindows: number;
  attribution: Array<{
    period: string;
    names: number;
    start: string;
    end: string;
    basketReturnPct: number;
    fundReturnPct: number;
    tradingDays: number;
  }>;
  curve: LabCurvePoint[];
  fundCurve: LabCurvePoint[];
  notes: string[];
}

interface LabData {
  snapshot: LabSnapshot;
  backtests: Record<string, LabBacktest>;
  tax: {
    personalLongHoldRate: number;
    etfEffectiveRate: number;
    etfEffectiveRateLow: number;
    etfEffectiveRateHigh: number;
    provenance: string;
    notes: string;
    bookYieldPct: number;
    reportedNetYieldPct: number;
    derivationNotes: string[];
  };
  dividend: {
    grossDividendYuan: number;
    netDividendYuan: number;
    portfolioDividendYieldPct: number;
    notes: string[];
  };
  fees: { managementFeePct: number; custodyFeePct: number; totalPct: number; impliedAvgNavYuan2025: number };
  etfIpo: {
    deals: number;
    costYuanH1: number;
    annualisedCostYuan: number;
    medianPremiumPct: number;
    avgNavYuan: number;
  };
  etfIpoContributionPct: number;
  fundTotalReturnPct: number;
  fundAnnualisedReturnPct: number;
  fundMaxDrawdownPct: number;
  fundSharpe: number;
  trackingErrorPct: number;
  betaGapProxy: number;
  meta: { generatedAt: string; asOf: string; sources: string[] };
  ipoSample: unknown[];
}

interface ResultWeight {
  code: string;
  name: string;
  exchange: string;
  weightPct: number;
}

interface ModelResult {
  capital: number;
  method: string;
  isBaseline: boolean;
  portfolio: {
    method: string;
    label: string;
    weights: ResultWeight[];
    totalWeightPct: number;
    cumulativeEtfWeightPct: number;
  };
  ipo: {
    shMarketValue: number;
    szMarketValue: number;
    shTickets: number;
    szTickets: number;
    expectedWinsPerYear: number;
    expectedProfitPerYear: number;
    expectedReturnPct: number;
    capBinds: boolean;
    notes: string;
  };
  tax: { etfEffectiveRate: number; personalLongHoldRate: number };
  etfFeePct: number;
  tradingCostPct: number;
  basketDividendYieldPct: number;
  breakdown: {
    stockBetaContributionPct: number;
    dividendYieldPct: number;
    personalDividendTaxPct: number;
    etfDividendTaxPct: number;
    ipoEdgePct: number;
    feeSavingPct: number;
    tradingCostPct: number;
    trackingErrorPct: number;
    totalEdgePct: number;
  };
}

/* ---------------- formatting ---------------- */

function fmtPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

function fmtSignedPct(v: number, digits = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtYuan(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(2)} 万`;
  return `${v.toFixed(0)} 元`;
}

function fmtNum(v: number, digits = 2): string {
  return v.toFixed(digits);
}

function cls(v: number): string {
  return v > 0 ? 'num-pos' : v < 0 ? 'num-neg' : '';
}

function tag(kind: 'disclosed' | 'statistical' | 'assumption'): string {
  const label = kind === 'disclosed' ? '真实披露数据' : kind === 'statistical' ? '历史统计估计' : '模型假设';
  return `<span class="tag t-${kind}">${label}</span>`;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
}

const PRESET_CAPITALS = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];
const SWEEP_CAPITALS = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];

function capitalLabel(v: number): string {
  return `${v / 10_000} 万`;
}

/* ---------------- state ---------------- */

let state = { capital: 1_000_000, method: 'top10_weighted' };

function result(knobs?: { winRateMultiplier?: number; premiumMultiplier?: number; etfTaxRateOverride?: number }): ModelResult {
  return EtfLab.compute(LAB_DATA, state.capital, state.method, knobs);
}

/* ---------------- ① verdict ---------------- */

function renderVerdict(): void {
  const r = result();
  if (r.isBaseline) {
    $('verdict').innerHTML = `
      <div class="kv">
        <div class="cell"><div class="k">直接买 159201（基准本身） ${tag('disclosed')}</div><div class="v">${fmtPct(LAB_DATA.fundAnnualisedReturnPct)}</div></div>
        <div class="cell"><div class="k">年化超额</div><div class="verdict-big">+0.00%</div></div></div>
      <p class="verdict-sub">你选择的是基准对照组：持有 ETF 份额，无个股持仓、无网上配号、不省管理费。超额按定义恒为 0。切到 Top10 / Top20 / Top30 才会计算复制策略的超额。</p>`;
    return;
  }
  const edge = r.breakdown.totalEdgePct;
  const yuan = (edge / 100) * state.capital;
  const fundAnn = LAB_DATA.fundAnnualisedReturnPct;
  const personal = fundAnn + edge;

  $('verdict').innerHTML = `
    <div class="kv">
      <div class="cell"><div class="k">直接买 159201（历史年化） ${tag('statistical')}</div><div class="v">${fmtPct(fundAnn)}</div></div>
      <div class="cell"><div class="k">个人复制（中性假设下 ≈ 历史年化 + 超额）</div><div class="v">${fmtPct(personal)}</div></div>
      <div class="cell"><div class="k">年化超额</div><div class="verdict-big ${cls(edge)}">${fmtSignedPct(edge)}</div></div>
      <div class="cell"><div class="k">按当前本金折算</div><div class="v ${cls(yuan)}">${yuan >= 0 ? '+' : ''}${fmtYuan(yuan)}/年</div></div>
    </div>
    <div class="warnbox">“中性假设”指复制组合的股票收益与 ETF 持平，超额只来自税、打新、费用三项可观测差异。拟合误差不贡献收益，只贡献风险（跟踪误差 ${fmtPct(r.breakdown.trackingErrorPct)} ${tag('statistical')}），见 ⑥。</div>
    ${reconcileBox(r)}
    <p class="verdict-sub">其中：税务优势 ${fmtSignedPct(r.breakdown.personalDividendTaxPct - r.breakdown.etfDividendTaxPct)} / 打新净优势 ${fmtSignedPct(r.breakdown.ipoEdgePct - LAB_DATA.etfIpoContributionPct)} / 费用净节省 ${fmtSignedPct(r.breakdown.feeSavingPct + r.breakdown.tradingCostPct)}。股票本身贡献 ${fmtSignedPct(0)}（中性假设）。</p>`;
}

/**
 * The single most misunderstood pairing on this page: ① is a FORWARD structural
 * edge (tax + IPO + fees, stocks assumed tied) while ⑥ is the BACKWARD realized
 * stock-only path (no IPO, no tax, no fees in the curves). Both are true at
 * once, so the page states their reconciliation in one breath, computed live
 * from the current selection.
 */
function reconcileBox(r: ModelResult): string {
  if (r.isBaseline) return '';
  const bt = LAB_DATA.backtests[state.method];
  if (!bt) return '';
  const realizedGap = bt.totalReturnPct - LAB_DATA.fundTotalReturnPct;
  return `<div class="warnbox">为什么⑥的曲线可能压在基线之下？⑥是<b>过去</b>股票价格的实际路径（${bt.label}过去 ${fmtSignedPct(realizedGap)}，且曲线里<u>不含</u>打新、税差、费用）；①的 ${fmtSignedPct(r.breakdown.totalEdgePct)} 是<b>未来</b>税 + 打新 + 费用的结构超额（假设股票打平，而⑥证明过去并没有打平）。两个数字一个管过去、一个管未来，只看一个会得出相反结论。</div>`;
}

/* ---------------- ② decomposition ---------------- */

function renderDecomp(): void {
  const r = result();
  const b = r.breakdown;
  const row = (name: string, v: number, src: string): string =>
    `<tr><td>${name}</td><td class="${cls(v)}">${fmtSignedPct(v)}</td><td>${src}</td></tr>`;
  $('decomp').innerHTML = `
    <table class="data">
      <tr><th>项目</th><th>年化</th><th>说明</th></tr>
      ${row('个人股息税（持有超 1 年）', b.personalDividendTaxPct, '法定 0% ' + tag('disclosed'))}
      ${row('ETF 底层股息税（差额即个人优势）', -b.etfDividendTaxPct, `回推 ${fmtPct(r.tax.etfEffectiveRate)} ` + tag('statistical'))}
      ${row('个人网上打新期望收益', b.ipoEdgePct, `年约中签 ${fmtNum(r.ipo.expectedWinsPerYear)} 次 ` + tag('statistical'))}
      ${row('减：ETF 自身网下打新贡献', -LAB_DATA.etfIpoContributionPct, '披露获配年化 ' + tag('disclosed'))}
      ${row('ETF 费用节省（0.15% + 0.05%）', b.feeSavingPct, '合同费率 ' + tag('disclosed'))}
      ${row('减：个人交易成本（佣金/印花/冲击）', b.tradingCostPct, '万2.5 + 减半印花 ' + tag('assumption'))}
      <tr class="total"><td>合计超额</td><td class="${cls(b.totalEdgePct)}">${fmtSignedPct(b.totalEdgePct)}</td><td></td></tr>
    </table>
    <p class="note">跟踪误差 ${fmtPct(b.trackingErrorPct)} 是风险不是收益，未计入合计。个股收益按中性假设计入 0。${r.isBaseline ? '基准对照组：各项差异恒为 0。' : ''}</p>`;
}

/* ---------------- ③ portfolio ---------------- */

function renderPortfolio(): void {
  const r = result();
  const amountCell = (w: ResultWeight): string =>
    r.isBaseline ? '—' : fmtYuan((state.capital * w.weightPct) / 100);
  const rows = r.portfolio.weights
    .map((w, i) => `<tr><td>${i + 1}</td><td>${w.code}</td><td>${w.name}</td><td>${w.exchange}</td><td>${fmtPct(w.weightPct)}</td><td>${amountCell(w)}</td></tr>`)
    .join('');
  const intro = r.isBaseline
    ? `ETF 完整持仓（${LAB_DATA.snapshot.period}，${LAB_DATA.snapshot.asOf}）。注意：你持有的是 ETF 份额，不是这些股票，因此没有对应的个股金额，也没有打新市值。</p>`
    : `${r.portfolio.label} · 基于 ${LAB_DATA.snapshot.period}（${LAB_DATA.snapshot.asOf}）披露持仓。沪深市值直接决定 ④ 的配号数。</p>`;
  $('portfolio').innerHTML = `
    <div class="kv">
      <div class="cell"><div class="k">持仓只数</div><div class="v">${r.portfolio.weights.length}</div></div>
      <div class="cell"><div class="k">覆盖 ETF 权重</div><div class="v">${fmtPct(r.portfolio.cumulativeEtfWeightPct)}</div></div>
      <div class="cell"><div class="k">沪市市值</div><div class="v">${fmtYuan(r.ipo.shMarketValue)}</div></div>
      <div class="cell"><div class="k">深市市值</div><div class="v">${fmtYuan(r.ipo.szMarketValue)}</div></div>
    </div>
    <p class="note">${intro}
    <div class="holdings"><table class="data">
      <tr><th>#</th><th>代码</th><th>名称</th><th>市场</th><th>组合权重</th><th>对应金额</th></tr>
      ${rows}
    </table></div>`;
}

/* ---------------- ④ IPO ---------------- */

function renderIpo(): void {
  const r = result();
  const sampleN = LAB_DATA.ipoSample.length;
  $('ipo').innerHTML = `
    <div class="kv">
      <div class="cell"><div class="k">沪市配号</div><div class="v">${r.ipo.shTickets}</div></div>
      <div class="cell"><div class="k">深市配号</div><div class="v">${r.ipo.szTickets}</div></div>
      <div class="cell"><div class="k">年预计中签</div><div class="v">${fmtNum(r.ipo.expectedWinsPerYear)} 次</div></div>
      <div class="cell"><div class="k">年预计打新收益</div><div class="v">${fmtYuan(r.ipo.expectedProfitPerYear)}</div></div>
      <div class="cell"><div class="k">打新年化贡献</div><div class="v">${fmtPct(r.ipo.expectedReturnPct)}</div></div>
    </div>
    <p class="note">${r.ipo.capBinds ? '部分新股网上申购上限已封顶，加钱不再提高中签概率。' : ''}${r.ipo.notes}</p>
    <p class="note">规则：沪市每 1 万元市值 1 个配号（1000 股），深市每 5000 元市值 1 个配号（500 股），沪深独立计算，ETF 份额不计市值。样本为近两年 ${sampleN} 只沪深新股逐只求期望 ${tag('statistical')}。</p>`;
}

/* ---------------- ⑤ tax ---------------- */

function renderTax(): void {
  const r = result();
  const y = r.basketDividendYieldPct;
  const etfRate = r.tax.etfEffectiveRate;
  // Baseline holder pays the fund's internal tax exactly like the fund does:
  // the difference-vs-self is zero, even though the level is not.
  const etfTaxYuan = r.isBaseline ? 0 : state.capital * (y / 100) * (etfRate / 100);
  $('tax').innerHTML = `
    <div class="chain">
      <div class="link"><b>上市公司 → 基金</b><br>按基金自身持股期限差别征税（财税[2012]85 号第五条）：≤1 月 20%，1 月–1 年 10%，超 1 年 0%。季度调仓的 ETF 多数仓位落在 10% 档。回推 159201 有效税率 <b>${fmtPct(etfRate)}</b> ${tag('statistical')}</div>
      <div class="arrow">→</div>
      <div class="link"><b>基金 → 净值</b><br>源端代扣、不可抵扣，永久侵蚀 NAV。ETF 持有人无法“等满一年免税”。</div>
      <div class="arrow">→</div>
      <div class="link"><b>基金 → 你</b><br>财税[2002]128 号：基金分配暂不征个人所得税。但 159201 成立以来 <b>0 分红</b> ${tag('disclosed')}，这条暂未触发。</div>
    </div>
    <div class="kv">
      <div class="cell"><div class="k">组合股息率</div><div class="v">${fmtPct(y)}</div></div>
      <div class="cell"><div class="k">个人税率（持有超 1 年）</div><div class="v">0%</div></div>
      <div class="cell"><div class="k">ETF 有效税率</div><div class="v">${fmtPct(etfRate)}</div></div>
      <div class="cell"><div class="k">一年税务差额（当前本金）</div><div class="v">+${fmtYuan(etfTaxYuan)}</div></div>
    </div>
    <p class="note">股息率按披露持仓与 2025 年除权分红回推（${fmtPct(y)}）；若你季度调仓，个人税优即消失——税优只属于长期不动的持仓。</p>`;
}

/* ---------------- ⑥ backtest + charts ---------------- */

function drawLineChart(canvasId: string, series: Array<{ label: string; color: string; points: LabCurvePoint[] }>, opts: { drawdown?: boolean } = {}): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const padL = 56;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  ctx.clearRect(0, 0, W, H);

  const toVal = (p: LabCurvePoint, all: LabCurvePoint[]): number => {
    if (!opts.drawdown) return p.value;
    let peak = 0;
    for (const q of all) {
      if (q.date > p.date) break;
      peak = Math.max(peak, q.value);
    }
    return peak > 0 ? (p.value / peak - 1) * 100 : 0;
  };

  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const mapped = series.map((s) => s.points.map((p) => ({ date: p.date, v: toVal(p, s.points) })));
  for (const m of mapped) for (const q of m) { lo = Math.min(lo, q.v); hi = Math.max(hi, q.v); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  if (hi - lo < 1e-9) { hi = lo + 1; }
  if (!opts.drawdown && lo > 0.9) lo = 0.9;

  const X = (i: number, n: number): number => padL + ((W - padL - padR) * i) / Math.max(1, n - 1);
  const Y = (v: number): number => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  ctx.strokeStyle = '#e3e8ef';
  ctx.fillStyle = '#5b6b82';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4;
    const y = Y(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(opts.drawdown ? `${v.toFixed(0)}%` : v.toFixed(2), 6, y + 4);
  }

  mapped.forEach((m, si) => {
    const s = series[si];
    if (!s) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = si === 0 ? 2.2 : 1.4;
    ctx.beginPath();
    m.forEach((q, i) => {
      const x = X(i, m.length);
      const y = Y(q.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // x labels: first, middle, last
    ctx.fillStyle = '#5b6b82';
    if (m.length > 0) {
      const first = m[0];
      const last = m[m.length - 1];
      if (first && last) {
        ctx.fillText(first.date.slice(0, 7), padL, H - 8);
        ctx.fillText(last.date.slice(0, 7), W - padR - 52, H - 8);
      }
    }
  });

  // legend
  ctx.font = '12px sans-serif';
  let lx = padL;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 6, 14, 8);
    ctx.fillStyle = '#1a2332';
    ctx.fillText(s.label, lx + 18, 14);
    lx += 18 + ctx.measureText(s.label).width + 22;
  }
}

/** Names a method needs for its label to be literally true. */
function namesNeeded(method: string): number {
  if (method === 'top5_weighted') return 5;
  if (method === 'top20_weighted' || method === 'top20_normalized') return 20;
  if (method === 'top30_weighted' || method === 'top30_normalized') return 30;
  if (method === 'full') return Number.POSITIVE_INFINITY;
  return 10;
}

function renderBacktest(): void {
  const methods = Object.keys(LAB_DATA.backtests);
  const sel = LAB_DATA.backtests[state.method] ?? LAB_DATA.backtests['top10_weighted'];
  const rows = methods
    .map((k) => {
      const b = LAB_DATA.backtests[k];
      if (!b) return '';
      const mark = k === state.method ? ' ★' : '';
      const need = namesNeeded(k);
      const satisfied = b.attribution.filter((w) => w.names >= need).length;
      const coverage = need === Number.POSITIVE_INFINITY
        ? `${b.fullWindows}/${b.windows} 窗口全披露`
        : `${satisfied}/${b.windows} 窗口满足所需只数`;
      return `<tr><td>${b.label}${mark}</td><td class="${cls(b.totalReturnPct)}">${fmtSignedPct(b.totalReturnPct)}</td><td>${fmtPct(b.trackingErrorPct)}</td><td>${fmtNum(b.beta)}</td><td>${fmtNum(b.correlation, 3)}</td><td>${fmtPct(b.activeSharePct, 1)}</td><td class="${cls(b.maxDrawdownPct)}">${fmtPct(b.maxDrawdownPct)}</td><td>${coverage}</td><td>${b.observations}</td></tr>`;
    })
    .join('');

  const full = LAB_DATA.backtests['full'];
  const gap = (p: string): string => {
    const w = full?.attribution.find((x) => x.period === p);
    return w ? fmtSignedPct(w.basketReturnPct - w.fundReturnPct) : '—';
  };
  const pair = (p: string): string => {
    const w = full?.attribution.find((x) => x.period === p);
    return w ? `篮子 ${fmtPct(w.basketReturnPct)} vs 基金 ${fmtPct(w.fundReturnPct)}` : '';
  };

  $('backtestTable').innerHTML = `
    <div class="warnbox">“完整成分股拟合”只在 1 个窗口里是真的完整（2025Q4 年报披露 142 只）。其余 5 个窗口季报只披露前 10 名，那里的“Top20 / Top30 / 完整拟合”实际都只能按 10 只构建——缺口主要不在方法，而在披露。<br>
    验证：唯一全披露窗口（2025Q4 持仓持有至 2026Q1）全复制只差 ${gap('2025Q4')}（${pair('2025Q4')}），差值正是费率 + 股息税 + 跟踪误差的量级，方法本身是对的。<br>
    总缺口几乎全部来自 2025Q2（差 ${gap('2025Q2')}）与 Q3（差 ${gap('2025Q3')}）：当时基金 +12.17% / +7.54%，而 2025H2 是有色（铝）牛市——云铝 +112%、中国铝业 +82%、神火 +68%、盐湖 +65%，涨幅前列全在第 11~100 名，前十篮子天然踏空。 ${tag('statistical')}</div>
    <table class="data">
      <tr><th>方法</th><th>区间回报</th><th>跟踪误差</th><th>Beta</th><th>相关系数</th><th>Active Share*</th><th>最大回撤</th><th>披露覆盖</th><th>交易日</th></tr>
      <tr><td>159201（基金净值）</td><td class="${cls(LAB_DATA.fundTotalReturnPct)}">${fmtSignedPct(LAB_DATA.fundTotalReturnPct)}</td><td>—</td><td>1.00</td><td>1.000</td><td>—</td><td class="${cls(LAB_DATA.fundMaxDrawdownPct)}">${fmtPct(LAB_DATA.fundMaxDrawdownPct)}</td><td>—</td><td>—</td></tr>
      ${rows}
    </table>
    <p class="note">★ 为当前选择的拟合方式。*Active Share 以最完整的 2025Q4（142 只）披露为基准，而非最新一期不完全披露。</p>
    ${sel && sel.notes.length > 0 ? `<p class="note">回测备注：${sel.notes.join('；')}</p>` : ''}
    ${sel ? `<h3>${sel.label}：逐窗口归因（篮子 vs 基金）</h3>
    <table class="data">
      <tr><th>窗口</th><th>实际用几只</th><th>篮子</th><th>基金</th><th>差</th><th>交易日</th></tr>
      ${sel.attribution.map((w) => `<tr><td>${w.period}（${w.start.slice(0, 7)}→${w.end.slice(0, 7)}）</td><td>${w.names}</td><td class="${cls(w.basketReturnPct)}">${fmtSignedPct(w.basketReturnPct)}</td><td>${fmtSignedPct(w.fundReturnPct)}</td><td class="${cls(w.basketReturnPct - w.fundReturnPct)}">${fmtSignedPct(w.basketReturnPct - w.fundReturnPct)}</td><td>${w.tradingDays}</td></tr>`).join('')}
    </table>` : ''}`;

  if (sel) {
    if (state.method === 'buy_etf') {
      // Baseline has no basket: draw the fund against itself.
      drawLineChart('chartCum', [{ label: '159201', color: '#1b5bd7', points: sel.fundCurve }]);
      drawLineChart('chartDd', [{ label: '159201 回撤', color: '#1b5bd7', points: sel.fundCurve }], { drawdown: true });
    } else {
      drawLineChart('chartCum', [
        { label: '159201', color: '#1b5bd7', points: sel.fundCurve },
        { label: sel.label, color: '#c0392b', points: sel.curve },
      ]);
      drawLineChart(
        'chartDd',
        [
          { label: '159201 回撤', color: '#1b5bd7', points: sel.fundCurve },
          { label: `${sel.label} 回撤`, color: '#c0392b', points: sel.curve },
        ],
        { drawdown: true },
      );
    }
  }
}

/* ---------------- ⑦ sweep ---------------- */

function renderSweep(): void {
  const rows = SWEEP_CAPITALS.map((cap) => {
    const r = EtfLab.compute(LAB_DATA, cap, state.method);
    const taxAdv = r.breakdown.personalDividendTaxPct - r.breakdown.etfDividendTaxPct;
    const ipoNet = r.breakdown.ipoEdgePct - LAB_DATA.etfIpoContributionPct;
    return `<tr><td>${capitalLabel(cap)}</td><td class="${cls(r.breakdown.totalEdgePct)}">${fmtSignedPct(r.breakdown.totalEdgePct)}</td><td>${fmtPct(ipoNet)}</td><td>${fmtPct(taxAdv)}</td><td>${fmtPct(r.breakdown.feeSavingPct + r.breakdown.tradingCostPct)}</td><td>${fmtNum(r.ipo.expectedWinsPerYear)} 次 / ${fmtYuan(r.ipo.expectedProfitPerYear)}</td></tr>`;
  }).join('');
  $('sweep').innerHTML = `
    <table class="data">
      <tr><th>本金</th><th>年化超额</th><th>其中打新净贡献</th><th>其中税务优势</th><th>其中费用净节省</th><th>打新期望</th></tr>
      ${rows}
    </table>
    <p class="note">读法：本金越小，打新期望收益占本金比例越高——这是个人策略最主要的规模效应。税务优势与本金无关（按比例计）。</p>`;
}

/* ---------------- ⑧ methods ---------------- */

function renderMethods(): void {
  const rows = EtfLab.ALL_METHODS.filter((m) => m !== 'buy_etf')
    .map((m) => {
      const r = EtfLab.compute(LAB_DATA, state.capital, m);
      const mark = m === state.method ? ' ★' : '';
      return `<tr><td>${EtfLab.METHOD_LABELS[m] ?? m}${mark}</td><td class="${cls(r.breakdown.totalEdgePct)}">${fmtSignedPct(r.breakdown.totalEdgePct)}</td><td>${fmtPct(r.ipo.expectedReturnPct)}</td><td>${r.ipo.shTickets} / ${r.ipo.szTickets}</td><td>${fmtPct(r.portfolio.cumulativeEtfWeightPct, 1)}</td></tr>`;
    })
    .join('');
  $('methods').innerHTML = `
    <table class="data">
      <tr><th>拟合方式</th><th>年化超额</th><th>打新年化</th><th>沪/深配号</th><th>覆盖 ETF 权重</th></tr>
      ${rows}
    </table>
    <p class="note">当前本金 ${fmtYuan(state.capital)}。只数越多覆盖越全，但沪深市值结构变化不大，所以打新能力在 Top10 之后基本不再增长。</p>`;
}

/* ---------------- ⑨ sensitivity ---------------- */

function renderSensitivity(): void {
  const base = result();
  const scenarios: Array<{ name: string; knobs?: { winRateMultiplier?: number; premiumMultiplier?: number; etfTaxRateOverride?: number } }> = [
    { name: '基准' },
    { name: '中签率减半（需求继续上升）', knobs: { winRateMultiplier: 0.5 } },
    { name: '首日溢价减半（破发常态化）', knobs: { premiumMultiplier: 0.5 } },
    { name: '中签率×0.5 且溢价×0.5', knobs: { winRateMultiplier: 0.5, premiumMultiplier: 0.5 } },
    { name: 'ETF 有效税率 0%（全部长期仓位）', knobs: { etfTaxRateOverride: 0 } },
    { name: 'ETF 有效税率 20%（全部短期仓位）', knobs: { etfTaxRateOverride: 20 } },
    { name: '悲观组合：中签×0.5、溢价×0.5、ETF 税 0%', knobs: { winRateMultiplier: 0.5, premiumMultiplier: 0.5, etfTaxRateOverride: 0 } },
  ];
  const rows = scenarios
    .map((s) => {
      const r = result(s.knobs);
      return `<tr><td>${s.name}</td><td>${fmtPct(r.ipo.expectedReturnPct)}</td><td>${fmtPct(r.breakdown.personalDividendTaxPct - r.breakdown.etfDividendTaxPct)}</td><td class="${cls(r.breakdown.totalEdgePct)}">${fmtSignedPct(r.breakdown.totalEdgePct)}</td></tr>`;
    })
    .join('');
  void base;
  $('sensitivity').innerHTML = `
    <table class="data">
      <tr><th>情景</th><th>打新年化</th><th>税务优势</th><th>总超额</th></tr>
      ${rows}
    </table>
    <p class="note">结论翻转条件一目了然：如果打新期望减半且 ETF 税优消失，超额主要只剩费用节省。打新是结论里最脆弱的一项——它是期望值，不是到手收益。</p>`;
}

/* ---------------- ⑩ dilution ---------------- */

function renderDilution(): void {
  const aums = [1e8, 1e9, 5e9, 10e9, 15e9];
  const alloc = 700_000;
  const rows = aums
    .map((aum) => {
      const c = ((alloc * 2) / aum) * 100;
      return `<tr><td>${fmtYuan(aum)}</td><td>${fmtYuan(alloc)}</td><td>${fmtPct(c, 4)}</td></tr>`;
    })
    .join('');
  const e = LAB_DATA.etfIpo;
  $('dilution').innerHTML = `
    <p class="note">假设一次网下获配 70 万元、上市翻倍（+100%），对 NAV 的贡献：</p>
    <table class="data">
      <tr><th>基金规模</th><th>获配金额</th><th>NAV 贡献</th></tr>
      ${rows}
    </table>
    <p class="note">159201 实际（2026H1 披露 ${tag('disclosed')}）：10 笔网下获配合计 ${fmtYuan(e.costYuanH1)}，年化约 ${fmtYuan(e.annualisedCostYuan)}；按样本首日溢价中位数 ${fmtPct(e.medianPremiumPct, 1)} 计，年化贡献约 ${fmtPct(LAB_DATA.etfIpoContributionPct, 4)}。绝对金额不随规模线性增长，但分母（NAV≈${fmtYuan(e.avgNavYuan)}）越来越大——这就是稀释。</p>`;
}

/* ---------------- ⑪ methodology ---------------- */

function renderMethodology(): void {
  const t = LAB_DATA.tax;
  $('methodology').innerHTML = `
    <h3>模型假设（全部列出，共 ${ASSUME.length} 项） ${tag('assumption')}</h3>
    <ul class="assume">${ASSUME.map((a) => `<li>${a}</li>`).join('')}</ul>
    <h3>回推有效税率的推导 ${tag('statistical')}</h3>
    <ul class="assume">${t.derivationNotes.map((n) => `<li>${n}</li>`).join('')}</ul>
    <h3>数据来源</h3>
    <ol class="src">${LAB_DATA.meta.sources.map((s) => `<li>${s}</li>`).join('')}</ol>
    <p class="note">数据截至 ${LAB_DATA.meta.asOf}；报告生成于 ${LAB_DATA.meta.generatedAt.slice(0, 10)}。</p>`;
}

const ASSUME = [
  '直接买 159201 为基准对照组：超额恒为 0，其打新收益即基金网下获配（已含在净值里），不产生网上配号、不省管理费。',
  '各拟合方式的股息率按其自身成分与权重单独计算（Top5 4.87% vs 全复制 3.47%），而非共用全书平均；切换拟合方式时股息与税会联动变化。',
  '个人持有超 1 年，股息税为 0（财税[2015]101 号；政策延续有效，页面按现行规则计）。',
  'ETF 底层有效税率取回推值；回推不可观察时取法定区间 0%~20% 的中值（季度调仓→多数仓位落在 1 个月至 1 年档）。',
  '股票收益中性假设：复制组合与 ETF 的股票部分收益相同，超额只来自税、打新、费用。拟合误差体现为跟踪误差（风险），不计入收益。',
  '网上打新期望 = Σ 配号 × 中签率 × 单签首日开盘收益，逐只新股计算，样本为近两年沪深 IPO；中签率由网上发行量与超额倍数推导。',
  '交易成本：佣金万 2.5 双边、卖出印花 0.05%（减半后）、过户费双边、冲击成本双边，年换手 100%（对应指数季度调仓）。',
  '个人按组合沪深市值分别计算配号；申购上限封顶时不再增加中签概率；北交所新股不计入。',
];

/* ---------------- header ---------------- */

function renderHeader(): void {
  $('fundLine').textContent =
    `规模约 151 亿 · 管理费 0.15% + 托管费 0.05% · 成立 2025-02-19 · 成立以来 0 分红 · 区间回报 ${LAB_DATA.fundTotalReturnPct.toFixed(2)}%（截至 ${LAB_DATA.meta.asOf}）`;
}

/* ---------------- boot ---------------- */

function renderAll(): void {
  renderVerdict();
  renderDecomp();
  renderPortfolio();
  renderIpo();
  renderTax();
  renderBacktest();
  renderSweep();
  renderMethods();
  renderSensitivity();
  renderDilution();
  renderMethodology();
}

function boot(): void {
  const methodSel = $('method') as HTMLSelectElement;
  for (const m of EtfLab.ALL_METHODS) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = EtfLab.METHOD_LABELS[m] ?? m;
    methodSel.appendChild(opt);
  }
  methodSel.value = state.method;
  $('methodHint').textContent = EtfLab.METHOD_LABELS[state.method] ?? '';
  methodSel.addEventListener('change', () => {
    state.method = methodSel.value;
    $('methodHint').textContent = EtfLab.METHOD_LABELS[state.method] ?? '';
    renderAll();
  });

  const capInput = $('capital') as HTMLInputElement;
  capInput.addEventListener('input', () => {
    const v = Number(capInput.value);
    if (Number.isFinite(v) && v > 0) {
      state.capital = Math.floor(v);
      renderAll();
    }
  });

  const quick = $('capitalQuick');
  for (const c of PRESET_CAPITALS) {
    const btn = document.createElement('button');
    btn.textContent = capitalLabel(c);
    btn.addEventListener('click', () => {
      state.capital = c;
      capInput.value = String(c);
      renderAll();
    });
    quick.appendChild(btn);
  }

  renderHeader();
  renderAll();
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  boot();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
