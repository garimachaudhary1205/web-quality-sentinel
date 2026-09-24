/**
 * Shared history I/O for the dashboard tool-chain.
 *
 * Both the analyzer (`analyze.ts`) and the builder (`build.ts`) read the raw
 * run summaries through this single module so there is exactly one place that
 * knows the on-disk layout of `env.historyDir`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../../config/env';
import type { RunSummary } from '../types';

/** Matches the run-summary files written by the custom reporter. */
const RUN_FILE_PATTERN = /^run-.*\.json$/;

/**
 * Load and parse every `run-*.json` file from the history directory.
 *
 * Tolerant of a missing or empty directory (returns `[]`) and of individual
 * malformed files (they are logged and skipped). Runs are returned sorted by
 * their `timestamp` ascending, so the last element is the most recent run.
 *
 * @param dir - History directory to read. Defaults to `env.historyDir`.
 * @returns Every parsed {@link RunSummary}, oldest first.
 */
export function loadRuns(dir: string = env.historyDir): RunSummary[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((name) => RUN_FILE_PATTERN.test(name));
  const runs: RunSummary[] = [];
  for (const name of files) {
    try {
      const raw = readFileSync(join(dir, name), 'utf8');
      runs.push(JSON.parse(raw) as RunSummary);
    } catch (error) {
      console.warn(`[history] skipping unreadable run file ${name}:`, error);
    }
  }

  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return runs;
}

/**
 * Convenience accessor for the most recent run.
 *
 * @param runs - Runs to inspect. Loaded from disk when omitted.
 * @returns The newest {@link RunSummary}, or `undefined` when there are none.
 */
export function latestRun(runs: RunSummary[] = loadRuns()): RunSummary | undefined {
  return runs[runs.length - 1];
}
