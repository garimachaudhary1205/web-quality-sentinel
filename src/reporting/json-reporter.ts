/**
 * Custom Playwright reporter for Web Quality Sentinel.
 *
 * Accumulates every test outcome during a run and, on completion, persists a
 * single {@link RunSummary} JSON file into `env.historyDir`
 * (`run-<runId>.json`). The flakiness analyzer and static dashboard read these
 * files to compute trends over time.
 *
 * The reporter is deliberately defensive: any I/O failure is logged and
 * swallowed so a broken history write can never fail an otherwise-green run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { env } from '../../config/env';
import { siteByKey } from '../../config/sites.config';
import {
  A11Y_ANNOTATION_TYPE,
  SITE_ANNOTATION_TYPE,
  type AccessibilitySummary,
  type RunSummary,
  type RunTotals,
  type TestResultRecord,
  type TestStatus,
} from '../types';

/** Max length for a persisted error message, keeps history files compact. */
const MAX_ERROR_LENGTH = 500;

/**
 * Persists one {@link RunSummary} per Playwright run for trend analysis.
 *
 * Registered in `playwright.config.ts` as `./src/reporting/json-reporter.ts`.
 */
export default class JsonReporter implements Reporter {
  /** All results grouped by their owning test case (one entry per attempt). */
  private readonly resultsByTest = new Map<TestCase, TestResult[]>();

  /** Run start time, captured at construction; also seeds the run id. */
  private readonly startedAt = new Date();

  /**
   * Called by Playwright after each test attempt (including retries) settles.
   * We accumulate every attempt so we can compute the retry count and final
   * outcome in {@link onEnd}.
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    const existing = this.resultsByTest.get(test);
    if (existing) {
      existing.push(result);
    } else {
      this.resultsByTest.set(test, [result]);
    }
  }

  /**
   * Called once when the whole run finishes. Builds and writes the run summary.
   */
  onEnd(_result: FullResult): void {
    try {
      const records = [...this.resultsByTest.entries()].map(([test, results]) =>
        this.buildRecord(test, results),
      );
      const summary = this.buildSummary(records);
      this.writeSummary(summary);
    } catch (error) {
      // Never throw from a reporter: a history-write failure must not fail CI.
      console.error('[json-reporter] failed to write run summary:', error);
    }
  }

  /**
   * Build one {@link TestResultRecord} from a test and all of its attempts.
   *
   * @param test - The Playwright test case.
   * @param results - Every attempt's result, in the order they were reported.
   * @returns The normalized history record for this test.
   */
  private buildRecord(test: TestCase, results: TestResult[]): TestResultRecord {
    const finalResult = results[results.length - 1];
    const titlePath = test.titlePath();
    // titlePath is ['', <project>, <file>, ...<describe>, <title>]; drop the
    // empty root and the project name so `testName` is stable across projects.
    const project = titlePath[1] ?? '';
    const testName = titlePath.slice(2).filter(Boolean).join(' > ') || test.title;

    const status = this.mapStatus(test, finalResult);
    const retries = results.reduce((max, r) => Math.max(max, r.retry), 0);

    const tags = testName.match(/@[\w-]+/g) ?? [];
    const site = this.readAnnotation(test, finalResult, SITE_ANNOTATION_TYPE);
    const siteUrl = site ? (siteByKey(site)?.url ?? null) : null;
    const a11y = this.readA11y(test, finalResult);
    const error = this.readError(finalResult);

    return {
      testName,
      site,
      siteUrl,
      status,
      retries,
      durationMs: finalResult.duration,
      timestamp: new Date().toISOString(),
      project,
      tags,
      ...(a11y ? { a11y } : {}),
      ...(error ? { error } : {}),
    };
  }

  /**
   * Map Playwright's outcome/status to our normalized {@link TestStatus}.
   *
   * Uses `test.outcome()` as the primary signal (expected/unexpected/flaky/
   * skipped) and refines an `unexpected` outcome to `timedOut`/`interrupted`
   * when the final attempt's status says so.
   */
  private mapStatus(test: TestCase, finalResult: TestResult): TestStatus {
    const outcome = test.outcome();
    switch (outcome) {
      case 'flaky':
        return 'flaky';
      case 'skipped':
        return 'skipped';
      case 'expected':
        return 'passed';
      case 'unexpected':
        if (finalResult.status === 'timedOut') return 'timedOut';
        if (finalResult.status === 'interrupted') return 'interrupted';
        return 'failed';
      default:
        return 'failed';
    }
  }

  /**
   * Read the (first) annotation of a given type from the test and its result.
   *
   * @returns The annotation description, or `null` when absent.
   */
  private readAnnotation(test: TestCase, finalResult: TestResult, type: string): string | null {
    const annotations = [...test.annotations, ...(finalResult.annotations ?? [])];
    const found = annotations.find((a) => a.type === type);
    return found?.description ?? null;
  }

  /**
   * Parse the accessibility summary smuggled through the a11y annotation.
   *
   * @returns The parsed {@link AccessibilitySummary}, or `undefined` if absent
   * or malformed.
   */
  private readA11y(test: TestCase, finalResult: TestResult): AccessibilitySummary | undefined {
    const raw = this.readAnnotation(test, finalResult, A11Y_ANNOTATION_TYPE);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AccessibilitySummary;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract and truncate the first error message from the final attempt.
   *
   * @returns The truncated message, or `undefined` when the test did not error.
   */
  private readError(finalResult: TestResult): string | undefined {
    const message = finalResult.error?.message ?? finalResult.errors[0]?.message;
    if (!message) return undefined;
    const clean = message.replace(/\s+/g, ' ').trim();
    return clean.length > MAX_ERROR_LENGTH ? `${clean.slice(0, MAX_ERROR_LENGTH)}…` : clean;
  }

  /**
   * Assemble the full {@link RunSummary} from the per-test records.
   */
  private buildSummary(records: TestResultRecord[]): RunSummary {
    const totals = this.computeTotals(records);
    return {
      runId: this.runId(),
      timestamp: this.startedAt.toISOString(),
      ci: {
        isCI: env.isCI,
        commit: env.gitCommit,
        branch: env.gitBranch,
        runUrl: env.ciRunUrl,
      },
      totals,
      results: records,
    };
  }

  /** Roll up per-test statuses into whole-run {@link RunTotals}. */
  private computeTotals(records: TestResultRecord[]): RunTotals {
    const totals: RunTotals = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    for (const record of records) {
      totals.total += 1;
      switch (record.status) {
        case 'passed':
          totals.passed += 1;
          break;
        case 'flaky':
          totals.flaky += 1;
          break;
        case 'skipped':
          totals.skipped += 1;
          break;
        default:
          // failed | timedOut | interrupted all count as failed.
          totals.failed += 1;
      }
    }
    return totals;
  }

  /** A filesystem-safe, sortable run id derived from the start timestamp. */
  private runId(): string {
    return this.startedAt.toISOString().replace(/[:.]/g, '-');
  }

  /** Write the summary JSON into the history directory, creating it if needed. */
  private writeSummary(summary: RunSummary): void {
    mkdirSync(env.historyDir, { recursive: true });
    const file = join(env.historyDir, `run-${summary.runId}.json`);
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`[json-reporter] wrote ${file}`);
  }
}
