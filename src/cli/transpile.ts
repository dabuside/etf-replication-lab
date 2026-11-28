/**
 * Shared TypeScript-to-classic-script bundling utilities used by both
 * `bundle-model.ts` and `build.ts` to keep `dist/index.html` zero-dependency.
 */
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

/** Transpile a single TypeScript module to ES2020 JavaScript. */
export function transpileModule(fileName: string, source: string): string {
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName,
  });
  return out.outputText;
}

/**
 * Strip internal ES module import/export wiring so multiple transpiled files
 * can be concatenated into a single classic browser script.
 */
export function delocalize(js: string): string {
  const lines = js.split('\n');
  const out: string[] = [];
  let skippingImport = false;
  let skippingExportBlock = false;

  for (const line of lines) {
    const t = line.trim();
    if (skippingImport) {
      if (t.includes('from ') || t.endsWith(';')) skippingImport = false;
      continue;
    }
    if (skippingExportBlock) {
      if (t.includes('}')) skippingExportBlock = false;
      continue;
    }
    if (t.startsWith('import ')) {
      if (!t.includes('from ') && !t.endsWith(';')) skippingImport = true;
      continue;
    }
    if (t.startsWith('export type ')) continue;
    if (t.startsWith('export {')) {
      if (!t.includes('}')) skippingExportBlock = true;
      continue;
    }
    out.push(line.replace(/^(\s*)export (default )?/, '$1'));
  }

  return out.join('\n');
}

/** Read, transpile, and concatenate a list of TypeScript files in order. */
export async function bundleClassicScript(
  rootDir: string,
  relPaths: string[],
  opts: { header?: string; footer?: string; wrapIife?: boolean } = {},
): Promise<string> {
  const parts: string[] = [];
  for (const rel of relPaths) {
    const source = await readFile(join(rootDir, rel), 'utf8');
    parts.push(`// ---- ${rel} ----\n${delocalize(transpileModule(rel, source))}`);
  }

  const body = [
    opts.header ?? '',
    ...parts,
    opts.footer ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  if (opts.wrapIife) {
    return `(function () {\n"use strict";\n${body}\n})();\n`;
  }
  return `"use strict";\n${body}\n`;
}

/** Syntax-check a JavaScript string using `node --check` in the OS temp dir. */
export async function syntaxCheckScript(code: string, label: string): Promise<void> {
  const tmpFile = join(tmpdir(), `etf-lab-check-${label}-${process.pid}-${Date.now()}.js`);
  await writeFile(tmpFile, code, 'utf8');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, ['--check', tmpFile], (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    await rm(tmpFile, { force: true });
  }
}
