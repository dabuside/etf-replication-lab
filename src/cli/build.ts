/**
 * Produces dist/index.html: a single self-contained page with no backend, no
 * CDN and no runtime fetch. The model bundle, the transpiled app and the
 * trimmed dataset are all inlined, so the file opens straight from disk.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'dist', 'index.html');

function transpileApp(source: string): string {
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
    fileName: 'app.ts',
  });
  return out.outputText;
}

/**
 * Drop fields the page never reads. Daily prices and full-date curves would
 * make a locally-opened file sluggish for no benefit; weekly-thinned curves
 * keep the chart shape.
 */
function trimDataset(d: Record<string, unknown>): Record<string, unknown> {
  const backtests = d['backtests'] as Record<string, Record<string, unknown>>;
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(backtests)) {
    const curve = (v['curve'] as Array<{ date: string; value: number }>) ?? [];
    const fundCurve = (v['fundCurve'] as Array<{ date: string; value: number }>) ?? [];
    slim[k] = {
      label: v['label'],
      totalReturnPct: v['totalReturnPct'],
      annualisedReturnPct: v['annualisedReturnPct'],
      volatilityPct: v['volatilityPct'],
      sharpe: v['sharpe'],
      maxDrawdownPct: v['maxDrawdownPct'],
      trackingErrorPct: v['trackingErrorPct'],
      beta: v['beta'],
      alphaPct: v['alphaPct'],
      correlation: v['correlation'],
      activeSharePct: v['activeSharePct'],
      observations: v['observations'],
      windows: v['windows'],
      fullWindows: v['fullWindows'],
      attribution: v['attribution'],
      notes: v['notes'],
      curve: thin(curve),
      fundCurve: thin(fundCurve),
    };
  }

  return {
    snapshot: d['snapshot'],
    backtests: slim,
    tax: d['tax'],
    dividend: d['dividend'],
    yieldsByMethod: d['yieldsByMethod'],
    fees: d['fees'],
    etfIpo: d['etfIpo'],
    etfIpoContributionPct: d['etfIpoContributionPct'],
    fundTotalReturnPct: d['fundTotalReturnPct'],
    fundAnnualisedReturnPct: d['fundAnnualisedReturnPct'],
    fundMaxDrawdownPct: d['fundMaxDrawdownPct'],
    fundSharpe: d['fundSharpe'],
    trackingErrorPct: d['trackingErrorPct'],
    betaGapProxy: d['betaGapProxy'],
    meta: d['meta'],
    // The per-IPO expectation loop runs live in the browser, so the sample ships whole.
    ipoSample: d['ipoSample'],
  };
}

function thin(points: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  if (points.length <= 220) return points;
  const step = Math.ceil(points.length / 220);
  return points.filter((_, i) => i % step === 0 || i === points.length - 1);
}

async function main(): Promise<void> {
  const [html, css, appTs, modelJs] = await Promise.all([
    readFile(join(ROOT, 'web', 'index.html'), 'utf8'),
    readFile(join(ROOT, 'web', 'style.css'), 'utf8'),
    readFile(join(ROOT, 'web', 'app.ts'), 'utf8'),
    readFile(join(ROOT, 'web', 'vendor', 'model.bundle.js'), 'utf8'),
  ]);
  const dataset = JSON.parse(await readFile(join(ROOT, 'data', 'derived', 'dataset.json'), 'utf8')) as Record<string, unknown>;
  const payload = JSON.stringify(trimDataset(dataset)).replace(/</g, '\\u003c');

  const appJs = transpileApp(appTs);

  // Syntax-check the transpiled app before inlining it.
  const { execFile } = await import('node:child_process');
  const tmp = join(ROOT, 'dist', '.app.check.mjs');
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  await writeFile(tmp, appJs, 'utf8');
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, ['--check', tmp], (err) => (err ? reject(err) : resolve()));
  });

  const out = html
    .replace('/*__CSS__*/', css)
    .replace('/*__MODEL__*/', modelJs)
    .replace('/*__DATA__*/', payload)
    .replace('/*__APP__*/', appJs);

  await writeFile(OUT, out, 'utf8');
  console.log(`wrote dist/index.html (${(out.length / 1024).toFixed(0)} KB; app ${(appJs.length / 1024).toFixed(0)} KB, data ${(payload.length / 1024).toFixed(0)} KB)`);
}

export { trimDataset };

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
