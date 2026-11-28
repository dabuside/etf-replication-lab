/**
 * Shared frontend types, referencing the canonical domain types from `src/`.
 * Kept in a dedicated type-only file so `src/cli/build.ts` emits zero runtime
 * boilerplate while `tsc --noEmit` still checks every panel strictly.
 */
import type { MethodBacktest } from '../src/backtest.ts';
import type { Dataset } from '../src/dataset.ts';
import type { SensitivityKnobs } from '../src/model.ts';
import type { ModelResult, ReplicationMethod, ReplicationWeights, TaxModel } from '../src/types.ts';

export type LabCurvePoint = { date: string; value: number };
export type LabBacktest = MethodBacktest;
export type LabWeight = ReplicationWeights['weights'][number];
export type LabKnobs = Partial<SensitivityKnobs>;

export interface LabTaxModel extends TaxModel {
  bookYieldPct: number;
  reportedNetYieldPct: number;
  derivationNotes: string[];
}

export interface LabEtfIpoSummary {
  deals: number;
  costYuanH1: number;
  annualisedCostYuan: number;
  medianPremiumPct: number;
  avgNavYuan: number;
}

/** Trimmed dataset payload inlined as `window.LAB_DATA` by `src/cli/build.ts`. */
export type LabData = Pick<
  Dataset,
  | 'snapshot'
  | 'dividend'
  | 'yieldsByMethod'
  | 'fees'
  | 'etfIpoContributionPct'
  | 'fundTotalReturnPct'
  | 'fundAnnualisedReturnPct'
  | 'trackingErrorPct'
  | 'betaGapProxy'
  | 'meta'
  | 'ipoSample'
> & {
  tax: LabTaxModel;
  backtests: Record<string, LabBacktest>;
  etfIpo: LabEtfIpoSummary;
  fundMaxDrawdownPct: number;
  fundSharpe: number;
};

export interface EtfLabGlobal {
  compute(
    dataset: LabData,
    capital: number,
    method: ReplicationMethod,
    knobs?: LabKnobs,
  ): ModelResult;
  methodRequiredCount(method: ReplicationMethod): number;
  METHOD_LABELS: Record<ReplicationMethod, string>;
  ALL_METHODS: ReplicationMethod[];
}

export interface AppState {
  capital: number;
  method: ReplicationMethod;
}

declare global {
  const LAB_DATA: LabData;
  const EtfLab: EtfLabGlobal;
}
