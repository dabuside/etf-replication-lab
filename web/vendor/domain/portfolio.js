export const METHOD_LABELS = {
    buy_etf: '直接买 159201',
    top5_weighted: 'Top5 按 ETF 权重归一',
    top10_weighted: 'Top10 按 ETF 权重归一',
    top20_weighted: 'Top20 按 ETF 权重归一',
    top30_weighted: 'Top30 按 ETF 权重归一',
    top10_equal: 'Top10 等权',
    top10_normalized: 'Top10 归一化',
    top20_normalized: 'Top20 归一化',
    top30_normalized: 'Top30 归一化',
    full: '完整成分股拟合',
};
/** How many constituents each method takes, and whether it re-weights. */
const METHOD_SPEC = {
    buy_etf: null,
    top5_weighted: { count: 5, mode: 'weighted' },
    top10_weighted: { count: 10, mode: 'weighted' },
    top20_weighted: { count: 20, mode: 'weighted' },
    top30_weighted: { count: 30, mode: 'weighted' },
    top10_equal: { count: 10, mode: 'equal' },
    top10_normalized: { count: 10, mode: 'weighted' },
    top20_normalized: { count: 20, mode: 'weighted' },
    top30_normalized: { count: 30, mode: 'weighted' },
    full: { count: Number.POSITIVE_INFINITY, mode: 'weighted' },
};
export const ALL_METHODS = Object.keys(METHOD_SPEC);
/**
 * Build a replicated basket from a disclosed holdings snapshot.
 *
 * `weighted` renormalizes the ETF's own weights over the selected names, so a
 * Top10 basket keeps the relative weights intact, scaled to 100%. `equal` gives
 * every name the same weight. Either way the result sums to exactly 100%.
 *
 * `buy_etf` returns the complete basket, because in that case the individual
 * holds the fund itself and the ETF's holdings *are* the position.
 */
export function buildPortfolio(holdings, method) {
    if (holdings.length === 0)
        throw new Error('cannot build a portfolio from zero holdings');
    const spec = METHOD_SPEC[method];
    if (!spec) {
        const full = normalize(holdings, 'weighted');
        return { ...full, method, label: METHOD_LABELS[method] };
    }
    const sorted = [...holdings].sort((a, b) => b.weightPct - a.weightPct);
    const selected = sorted.slice(0, Number.isFinite(spec.count) ? spec.count : sorted.length);
    const normalized = normalize(selected, spec.mode);
    return { ...normalized, method, label: METHOD_LABELS[method] };
}
function normalize(selected, mode) {
    const raw = mode === 'equal' ? selected.map(() => 1) : selected.map((h) => h.weightPct);
    const sum = raw.reduce((s, w) => s + w, 0);
    if (sum <= 0)
        throw new Error('cannot normalize a portfolio with zero total weight');
    return {
        weights: selected.map((h, i) => ({
            code: h.code,
            name: h.name,
            exchange: h.exchange,
            weightPct: (raw[i] / sum) * 100,
        })),
        totalWeightPct: 100,
        cumulativeEtfWeightPct: selected.reduce((s, h) => s + h.weightPct, 0),
    };
}
/**
 * Smallest prefix of holdings whose cumulative ETF weight reaches a threshold —
 * i.e. how few names are needed to capture X% of the index.
 */
export function namesToReachWeight(holdings, thresholdPct) {
    const sorted = [...holdings].sort((a, b) => b.weightPct - a.weightPct);
    let cum = 0;
    for (let i = 0; i < sorted.length; i++) {
        cum += sorted[i].weightPct;
        if (cum >= thresholdPct)
            return i + 1;
    }
    return sorted.length;
}
/** Market-value split by exchange, which drives 网上打新 capacity. */
export function exchangeSplit(weights) {
    const byEx = { SH: 0, SZ: 0, BJ: 0 };
    for (const w of weights)
        byEx[w.exchange] += w.weightPct;
    const total = byEx.SH + byEx.SZ + byEx.BJ;
    if (total <= 0)
        return { shPct: 0, szPct: 0, bjPct: 0 };
    return {
        shPct: (byEx.SH / total) * 100,
        szPct: (byEx.SZ / total) * 100,
        bjPct: (byEx.BJ / total) * 100,
    };
}
