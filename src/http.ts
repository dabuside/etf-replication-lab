import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
export const RAW_DIR = join(ROOT, 'data', 'raw');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class FetchError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'FetchError';
    this.url = url;
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET with retry + exponential backoff, and an on-disk cache keyed by URL hash.
 * Caching matters here: scraping 100 constituents and 5,639 IPO records without
 * a cache would re-hit upstream on every backtest tweak.
 */
export async function fetchText(
  url: string,
  opts: { referer?: string; retries?: number; cache?: boolean } = {},
): Promise<string> {
  const { referer, retries = 3, cache = true } = opts;
  const key = createHash('sha1').update(url).digest('hex').slice(0, 20);
  const path = join(RAW_DIR, `${key}.txt`);

  if (cache) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      /* cache miss */
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new FetchError(url, res.status);
      const text = await res.text();
      if (cache) {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text, 'utf8');
      }
      return text;
    } catch (err) {
      lastErr = err;
      // Upstream rate-limits aggressively; back off hard before retrying.
      if (attempt < retries) await sleep(800 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Invalid JSON from ${url}: ${String(err)}`);
  }
}

/**
 * Retry wrapper for work the caller wants to survive a flaky upstream. Eastmoney
 * intermittently drops TLS connections under sustained load, and a single dead
 * socket shouldn't abort a 100-symbol scrape.
 */
export async function resilient<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`  retry ${i + 1}/${attempts - 1} ${label}: ${String(err).slice(0, 120)}`);
      await sleep(1_200 * 2 ** i + Math.random() * 500);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastErr)}`);
}

export async function fetchBinary(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<Uint8Array> {
  const { referer, retries = 3 } = opts ?? {};
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new FetchError(url, res.status);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr;
}
