/**
 * Flakiness + health analyzer for Web Quality Sentinel.
 *
 * Consumes the run history (via {@link loadRuns}) and derives the aggregates
 * the static dashboard renders: per-test flakiness, per-site health, a11y
 * totals by severity, and a per-run pass/fail trend.
 *
 * Runnable directly with `tsx src/dashboard/analyze.ts` to print a summary
 * table to stdout.
 */
import { argv } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SEVERITY_ORDER, type RunSummary, type Severity, type TestStatus } from '../types';
import { loadRuns } from './history';

/** Aggregated flakiness + timing stats for one unique test name. */
export interface TestStats {
  /** Fully-qualified test name (the aggregation key). */
  testName: string;
  /** Total occurrences of this test across all runs and projects. */
  runs: number;
  /** How many occurrences ended `passed`. */
  passed: number;
  /** How many occurrences ended `failed`/`timedOut`/`interrupted`. */
  failed: number;
  /** How many occurrences ended `flaky`. */
  flaky: number;
  /** How many occurrences were `skipped`. */
  skipped: number;
  /**
   * Flakiness score, 0–100. See {@link computeFlakiness} for the formula.
   */
  flakinessScore: number;
  /** Mean duration (ms) across non-skipped occurrences. */
  avgDurationMs: number;
  /** Status of the most recent occurrence. */
  lastStatus: TestStatus;
  /** Site key associated with the test, if any. */
  site: string | null;
}

/** Health roll-up for a single monitored site. */
export interface SiteHealth {
  site: string;
  total: number;
  passed: number;
  /** Pass rate as a percentage, 0–100. */
  passRate: number;
  /** Status of the most recent occurrence for this site. */
  latestStatus: TestStatus;
}

/** Accessibility violation totals across the whole history. */
export interface A11yTotals {
  total: number;
  bySeverity: Record<Severity, number>;
  /** Deduped rule ids seen across all a11y results. */
  ruleIds: string[];
}

/** One point on the pass/fail trend line (one per run). */
export interface TrendPoint {
  runId: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  /** Pass rate as a percentage, 0–100. */
  passRate: number;
}

/** The full analysis payload embedded into the dashboard. */
export interface Analysis {
  /** ISO timestamp of when the analysis was produced. */
  generatedAt: string;
  /** Number of runs analyzed. */
  runCount: number;
  /** Most recent commit sha seen in the history, if any. */
  lastCommit: string | null;
  perTest: TestStats[];
  perSite: SiteHealth[];
  a11y: A11yTotals;
  trend: TrendPoint[];
}

/** A single test occurrence flattened out of the run history, in run order. */
interface Occurrence {
  runId: string;
  timestamp: string;
  status: TestStatus;
  durationMs: number;
  site: string | null;
}

/**
 * Flatten every {@link RunSummary} into per-test occurrence lists, preserving
 * chronological (run) order.
 */
function flattenByTest(runs: RunSummary[]): Map<string, Occurrence[]> {
  const byTest = new Map<string, Occurrence[]>();
  for (const run of runs) {
    for (const record of run.results) {
      const occurrence: Occurrence = {
        runId: run.runId,
        timestamp: record.timestamp,
        status: record.status,
        durationMs: record.durationMs,
        site: record.site,
      };
      const list = byTest.get(record.testName);
      if (list) list.push(occurrence);
      else byTest.set(record.testName, [occurrence]);
    }
  }
  return byTest;
}

/**
 * Compute the flakiness score for one test's ordered occurrences.
 *
 * Formula: an occurrence is "unstable" when it is itself `flaky`, OR when its
 * status differs from the immediately preceding occurrence of the same test
 * (an inconsistent result that flipped between runs). The score is the
 * percentage of occurrences that are unstable:
 *
 *   flakinessScore = 100 * (unstable occurrences) / (total occurrences)
 *
 * The first occurrence has no predecessor, so it only contributes when it is
 * itself flaky. A perfectly stable, always-passing (or always-failing) test
 * scores 0; a test that flips every run trends toward 100.
 *
 * @param occurrences - Occurrences for one test, oldest first.
 * @returns A score in the inclusive range 0–100, rounded to one decimal.
 */
function computeFlakiness(occurrences: Occurrence[]): number {
  if (occurrences.length === 0) return 0;
  let unstable = 0;
  let previous: TestStatus | null = null;
  for (const occurrence of occurrences) {
    const changed = previous !== null && occurrence.status !== previous;
    if (occurrence.status === 'flaky' || changed) unstable += 1;
    previous = occurrence.status;
  }
  return round1((unstable / occurrences.length) * 100);
}

/** Round to a single decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Build the per-test statistics array, sorted by flakiness descending. */
function buildPerTest(byTest: Map<string, Occurrence[]>): TestStats[] {
  const stats: TestStats[] = [];
  for (const [testName, occurrences] of byTest) {
    let passed = 0;
    let failed = 0;
    let flaky = 0;
    let skipped = 0;
    let durationSum = 0;
    let durationCount = 0;
    for (const occurrence of occurrences) {
      if (occurrence.status === 'passed') passed += 1;
      else if (occurrence.status === 'flaky') flaky += 1;
      else if (occurrence.status === 'skipped') skipped += 1;
      else failed += 1;
      if (occurrence.status !== 'skipped') {
        durationSum += occurrence.durationMs;
        durationCount += 1;
      }
    }
    const last = occurrences[occurrences.length - 1];
    stats.push({
      testName,
      runs: occurrences.length,
      passed,
      failed,
      flaky,
      skipped,
      flakinessScore: computeFlakiness(occurrences),
      avgDurationMs: durationCount === 0 ? 0 : Math.round(durationSum / durationCount),
      lastStatus: last.status,
      site: last.site,
    });
  }
  stats.sort((a, b) => b.flakinessScore - a.flakinessScore || b.runs - a.runs);
  return stats;
}

/** Build per-site health from the run history. */
function buildPerSite(runs: RunSummary[]): SiteHealth[] {
  const bySite = new Map<string, { total: number; passed: number; latest: TestStatus }>();
  for (const run of runs) {
    for (const record of run.results) {
      if (!record.site) continue;
      const entry = bySite.get(record.site) ?? { total: 0, passed: 0, latest: record.status };
      entry.total += 1;
      if (record.status === 'passed' || record.status === 'flaky') entry.passed += 1;
      entry.latest = record.status;
      bySite.set(record.site, entry);
    }
  }
  return [...bySite.entries()]
    .map(([site, entry]) => ({
      site,
      total: entry.total,
      passed: entry.passed,
      passRate: entry.total === 0 ? 0 : round1((entry.passed / entry.total) * 100),
      latestStatus: entry.latest,
    }))
    .sort((a, b) => a.site.localeCompare(b.site));
}

/** Sum accessibility violations across every a11y-annotated record. */
function buildA11yTotals(runs: RunSummary[]): A11yTotals {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  const ruleIds = new Set<string>();
  let total = 0;
  for (const run of runs) {
    for (const record of run.results) {
      if (!record.a11y) continue;
      total += record.a11y.total;
      for (const severity of SEVERITY_ORDER) {
        bySeverity[severity] += record.a11y.bySeverity[severity] ?? 0;
      }
      for (const id of record.a11y.ruleIds) ruleIds.add(id);
    }
  }
  return { total, bySeverity, ruleIds: [...ruleIds].sort() };
}

/** Build the per-run pass/fail trend line. */
function buildTrend(runs: RunSummary[]): TrendPoint[] {
  return runs.map((run) => {
    const { total, passed, failed, flaky } = run.totals;
    const denominator = total || 1;
    return {
      runId: run.runId,
      timestamp: run.timestamp,
      total,
      passed,
      failed,
      flaky,
      passRate: round1(((passed + flaky) / denominator) * 100),
    };
  });
}

/**
 * Analyze the run history into the structured payload the dashboard consumes.
 *
 * @param runs - Runs to analyze. Loaded from disk (oldest first) when omitted.
 * @returns The full {@link Analysis} aggregate.
 */
export function analyze(runs: RunSummary[] = loadRuns()): Analysis {
  const byTest = flattenByTest(runs);
  const lastCommit = [...runs].reverse().find((r) => r.ci.commit)?.ci.commit ?? null;
  return {
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    lastCommit,
    perTest: buildPerTest(byTest),
    perSite: buildPerSite(runs),
    a11y: buildA11yTotals(runs),
    trend: buildTrend(runs),
  };
}

/** Print a human-readable summary of the analysis to stdout. */
function printSummary(analysis: Analysis): void {
  const line = '─'.repeat(72);
  console.log(line);
  console.log(`Web Quality Sentinel — analysis (${analysis.runCount} run(s))`);
  console.log(`Generated: ${analysis.generatedAt}`);
  if (analysis.lastCommit) console.log(`Last commit: ${analysis.lastCommit}`);
  console.log(line);

  if (analysis.runCount === 0) {
    console.log('No history found. Run the Playwright suite to populate /history.');
    return;
  }

  console.log('\nSite health:');
  for (const site of analysis.perSite) {
    console.log(
      `  ${site.site.padEnd(26)} ${String(site.passRate).padStart(5)}%  ` +
        `(${site.passed}/${site.total})  latest=${site.latestStatus}`,
    );
  }

  console.log('\nFlakiest tests:');
  const top = analysis.perTest.slice(0, 10);
  for (const test of top) {
    console.log(
      `  ${String(test.flakinessScore).padStart(5)}%  ` +
        `${test.testName}  ` +
        `[p${test.passed}/f${test.failed}/flaky${test.flaky}, ${test.avgDurationMs}ms]`,
    );
  }

  const { total, bySeverity } = analysis.a11y;
  console.log(`\nAccessibility violations: ${total} total`);
  for (const severity of SEVERITY_ORDER) {
    console.log(`  ${severity.padEnd(10)} ${bySeverity[severity]}`);
  }

  console.log('\nPass-rate trend:');
  for (const point of analysis.trend) {
    console.log(`  ${point.timestamp}  ${String(point.passRate).padStart(5)}%`);
  }
  console.log(line);
}

/** True when this module is the process entry point (run via tsx/node). */
function isMain(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return fileURLToPath(import.meta.url) === entry;
  }
}

if (isMain()) {
  printSummary(analyze());
}
