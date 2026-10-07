/**
 * Inlines the frozen dataset and the model into one self-contained HTML file.
 * No backend, no CDN, no build-time network access: the output opens from disk.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT_DIR = join(ROOT, 'dist');

const read = (p: string) => readFile(join(ROOT, p), 'utf8');

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const [html, css, app] = await Promise.all([
    read('web/index.html'),
    read('web/style.css'),
    read('web/app.js'),
  ]);

  const dataset = await readFile(join(ROOT, 'data/derived/dataset.json'), 'utf8');
  const model = await read('src/model.js');

  // The dataset is ~1.9MB; ship only what the page renders.
  const parsed = JSON.parse(dataset) as Record<string, unknown>;
  const trimmed = trimDataset(parsed);
  const payload = JSON.stringify(trimmed);

  const out = html
    .replace('/*__CSS__*/', css)
    .replace('/*__MODEL__*/', model)
    .replace('/*__DATA__*/', payload);

  const target = join(OUT_DIR, 'index.html');
  await writeFile(target, out, 'utf8');
  console.log(`wrote dist/index.html (${(out.length / 1024).toFixed(0)} KB, dataset ${(payload.length / 1024).toFixed(0)} KB)`);
}

/**
 * Drop fields the page never reads. Keeping 1.9MB of daily prices and curves in
 * a file meant to be opened locally would make it sluggish for no benefit.
 */
function trimDataset(d: Record<string, unknown>): Record<string, unknown> {
  const keep = <T extends Record<string, unknown>>(o: T, fields: Array<keyof T>): T => {
    const out = {} as T;
    for (const f of fields) if (f in o) out[f] = o[f];
    return out;
  };

  const snapshots = (d['snapshots'] as Array<Record<string, unknown>>).map((s) =>
    keep(s, ['period', 'asOf', 'holdings']),
  );
  const backtests = d['backtests'] as Record<string, Record<string, unknown>>;
  const trimmedBacktests: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(backtests)) {
    // Thin the chart curves to weekly points; the shape survives, the bytes don't.
    const curve = (v['curve'] as Array<{ date: string; value: number }>) ?? [];
    const fundCurve = (v['fundCurve'] as Array<{ date: string; value: number }>) ?? [];
    trimmedBacktests[k] = keep(v, [
      'label', 'totalReturnPct', 'annualisedReturnPct', 'volatilityPct', 'sharpe',
      'maxDrawdownPct', 'trackingErrorPct', 'beta', 'alphaPct', 'correlation',
      'activeSharePct', 'observations', 'windows', 'notes',
    ]);
    (trimmedBacktests[k] as Record<string, unknown>)['curve'] = thin(curve);
    (trimmedBacktests[k] as Record<string, unknown>)['fundCurve'] = thin(fundCurve);
  }

  return {
    snapshot: (d['snapshot'] as Record<string, unknown>) ?? null,
    snapshots,
    backtests: trimmedBacktests,
    tax: d['tax'],
    dividend: d['dividend'],
    fees: d['fees'],
    etfIpo: d['etfIpo'],
    etfIpoContributionPct: d['etfIpoContributionPct'],
    fundTotalReturnPct: d['fundTotalReturnPct'],
    fundAnnualisedReturnPct: d['fundAnnualisedReturnPct'],
    fundMaxDrawdownPct: d['fundMaxDrawdownPct'],
    fundSharpe: d['fundSharpe'],
    trackingErrorPct: d['trackingErrorPct'],
    meta: d['meta'],
    /** IPO sample is needed live for the per-IPO expectation calculation. */
    ipoSample: d['ipoSample'],
    nav: d['nav'],
  };
}

function thin(points: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  if (points.length <= 200) return points;
  const step = Math.ceil(points.length / 200);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

await main();
