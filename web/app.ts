/**
 * 159201 replication lab entry point.
 *
 * Honours the two-inputs-only contract: capital + method are the only controls.
 * Static panels render once on boot, method-only panels (backtest + charts)
 * re-render only when the method changes, and capital-sensitive panels share
 * a single `EtfLab.compute()` call per update.
 */
import type { ReplicationMethod } from '../src/types.ts';
import { $, CAPITAL_PRESETS, capitalLabel } from './format.ts';
import {
  renderBacktest,
  renderDecomp,
  renderDilution,
  renderHeader,
  renderIpo,
  renderMethodology,
  renderMethods,
  renderPortfolio,
  renderSensitivity,
  renderSweep,
  renderTax,
  renderVerdict,
} from './panels.ts';
import type { AppState } from './types.ts';

const state: AppState = {
  capital: 1_000_000,
  method: 'top10_weighted',
};

const quickButtons: Array<{ capital: number; button: HTMLButtonElement }> = [];

function syncQuickButtons(): void {
  for (const item of quickButtons) {
    if (item.button.classList) {
      item.button.classList.toggle('active', item.capital === state.capital);
    }
  }
}

function renderDynamic(opts: { methodChanged?: boolean } = {}): void {
  const current = EtfLab.compute(LAB_DATA, state.capital, state.method);
  renderVerdict(current, state);
  renderDecomp(current);
  renderPortfolio(current, state);
  renderIpo(current);
  renderTax(current, state);
  if (opts.methodChanged) {
    renderBacktest(state.method);
    renderSweep(state);
  }
  renderMethods(state);
  renderSensitivity(state);
  syncQuickButtons();
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
    state.method = methodSel.value as ReplicationMethod;
    $('methodHint').textContent = EtfLab.METHOD_LABELS[state.method] ?? '';
    renderDynamic({ methodChanged: true });
  });

  const capInput = $('capital') as HTMLInputElement;
  capInput.addEventListener('input', () => {
    const v = Number(capInput.value);
    if (Number.isFinite(v) && v > 0) {
      state.capital = Math.floor(v);
      renderDynamic();
    }
  });

  const quick = $('capitalQuick');
  for (const c of CAPITAL_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = capitalLabel(c);
    btn.addEventListener('click', () => {
      state.capital = c;
      capInput.value = String(c);
      renderDynamic();
    });
    quick.appendChild(btn);
    quickButtons.push({ capital: c, button: btn });
  }

  // Static panels render once; dynamic + method panels render on initial boot.
  renderHeader();
  renderDilution();
  renderMethodology();
  renderDynamic({ methodChanged: true });
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  boot();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', boot);
}
