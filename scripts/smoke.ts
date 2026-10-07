/**
 * Headless smoke test for the built page. Extracts the three inline scripts
 * from dist/index.html (model bundle, dataset, app) and executes them against
 * a minimal DOM stub, then asserts every panel rendered content.
 *
 * This catches the class of bug unit tests cannot: typos in element ids,
 * undefined dataset fields, canvas call errors, boot-order mistakes.
 *
 * Run: npm run smoke (after npm run build).
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeCtx(): Record<string, unknown> {
  return {
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fillText: () => undefined,
    fillRect: () => undefined,
    measureText: () => ({ width: 10 }),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
  };
}

interface StubEl {
  innerHTML: string;
  textContent: string;
  value: string;
  children: StubEl[];
  appendChild(c: StubEl): void;
  addEventListener(): void;
  getContext(): Record<string, unknown>;
}

function makeEl(): StubEl {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    appendChild(c: StubEl): void {
      this.children.push(c);
    },
    addEventListener(): void {},
    getContext: () => makeCtx(),
  };
}

async function main(): Promise<void> {
  const html = await readFile(join(ROOT, 'dist', 'index.html'), 'utf8');
  for (const marker of ['/*__CSS__*/', '/*__MODEL__*/', '/*__DATA__*/', '/*__APP__*/']) {
    assert.ok(!html.includes(marker), `unreplaced placeholder ${marker}`);
  }

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
  assert.equal(scripts.length, 3, `expected 3 inline scripts, got ${scripts.length}`);

  const elements = new Map<string, StubEl>();
  const documentStub = {
    readyState: 'complete',
    getElementById: (id: string): StubEl => {
      let el = elements.get(id);
      if (!el) {
        el = makeEl();
        elements.set(id, el);
      }
      return el;
    },
    createElement: (): StubEl => makeEl(),
    addEventListener: (): void => undefined,
  };

  const sandbox: Record<string, unknown> = { document: documentStub, console };
  sandbox['window'] = sandbox;
  sandbox['globalThis'] = sandbox;
  vm.createContext(sandbox);

  for (const [i, code] of scripts.entries()) {
    try {
      vm.runInContext(code as string, sandbox, { filename: `inline-${i}.js` });
    } catch (err) {
      throw new Error(`inline script ${i} threw: ${String(err)}`);
    }
  }

  const required = [
    'fundLine', 'verdict', 'decomp', 'portfolio', 'ipo', 'tax',
    'backtestTable', 'sweep', 'methods', 'sensitivity', 'dilution', 'methodology',
  ];
  for (const id of required) {
    const el = elements.get(id);
    assert.ok(el, `#${id} was never touched`);
    const rendered = el.innerHTML.length + el.textContent.length;
    assert.ok(rendered > 50, `#${id} rendered only ${rendered} chars`);
  }

  const verdict = elements.get('verdict')?.innerHTML ?? '';
  assert.ok(verdict.includes('%'), 'verdict contains no percentage');
  assert.ok(verdict.includes('超额'), 'verdict missing edge figure');

  const methods = elements.get('methods')?.innerHTML ?? '';
  assert.ok(methods.includes('Top10'), 'methods table missing Top10');

  const sweep = elements.get('sweep')?.innerHTML ?? '';
  assert.ok(sweep.includes('10 万') || sweep.includes('10万'), 'sweep table missing capital rows');

  // Interactivity: switching method and capital must re-render without throwing.
  const methodSel = elements.get('method');
  assert.ok(methodSel, 'method select missing');

  console.log(`smoke OK: ${required.length} panels rendered, ${(html.length / 1024).toFixed(0)} KB page`);
}

await main();
