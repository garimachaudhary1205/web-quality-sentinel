/**
 * Shared type contracts for Web Quality Sentinel.
 *
 * These types are the "wire format" between modules:
 *  - The Playwright custom reporter (src/reporting) WRITES `RunSummary` files
 *    into /history.
 *  - The flakiness analyzer (src/dashboard/analyze.ts) and dashboard builder
 *    (src/dashboard/build.ts) READ those files.
 *  - Health-monitor tests attach `AccessibilitySummary` data via test
 *    annotations so the reporter can persist a11y counts per test.
 *
 * Keep this file dependency-free so every module can import it cheaply.
 */

/** axe-core impact levels, ordered most → least severe. */
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor'];

/** Aggregated accessibility findings for a single page/test. */
export interface AccessibilitySummary {
  /** Total number of axe violations found. */
  total: number;
  /** Violation counts bucketed by axe impact level. */
  bySeverity: Record<Severity, number>;
  /** Rule ids that were violated (deduped), useful for the dashboard. */
  ruleIds: string[];
}

/** Normalized status for a single test after retries have settled. */
export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut' | 'interrupted';

/** Annotation type used to smuggle a11y results from test → reporter. */
export const A11Y_ANNOTATION_TYPE = 'wqs-a11y';
/** Annotation type used to associate a test with a configured site key. */
export const SITE_ANNOTATION_TYPE = 'wqs-site';

/** One test's outcome within a run. This is the atomic history record. */
export interface TestResultRecord {
  /** Fully-qualified test title (suite > test). */
  testName: string;
  /** Site key from sites.config.ts (e.g. "saucedemo"), if applicable. */
  site: string | null;
  /** Site URL, if the test targets a configured site. */
  siteUrl: string | null;
  /** Final status after retries. */
  status: TestStatus;
  /** Number of retries Playwright performed for this test. */
  retries: number;
  /** Wall-clock duration of the final attempt, in milliseconds. */
  durationMs: number;
  /** ISO timestamp of when the test finished. */
  timestamp: string;
  /** Playwright project name, e.g. "chromium", "Mobile Chrome". */
  project: string;
  /** Tags parsed from the test title, e.g. ["@smoke", "@a11y"]. */
  tags: string[];
  /** Accessibility summary, present only for @a11y tests. */
  a11y?: AccessibilitySummary;
  /** Short error message if the test failed. */
  error?: string;
}

/** Roll-up counts for a whole run. */
export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

/** A single Playwright run, persisted as one JSON file in /history. */
export interface RunSummary {
  /** Stable id for the run (timestamp-based). */
  runId: string;
  /** ISO timestamp for when the run started. */
  timestamp: string;
  /** CI metadata when available. */
  ci: {
    isCI: boolean;
    commit: string | null;
    branch: string | null;
    runUrl: string | null;
  };
  totals: RunTotals;
  results: TestResultRecord[];
}

/** A configured site to monitor. Consumed by tests and the dashboard. */
export interface SiteConfig {
  /** Stable key used in history records and the dashboard. */
  key: string;
  /** Human-friendly name. */
  name: string;
  /** Absolute URL of the page to monitor. */
  url: string;
  /**
   * Optional per-site page-load performance budget (ms). Falls back to the
   * global PERF_THRESHOLD_MS when omitted.
   */
  perfThresholdMs?: number;
  /**
   * URL substrings to ignore when checking for broken links (e.g. known-flaky
   * third-party domains).
   */
  ignoreLinkPatterns?: string[];
  /** Skip the broken-link check for this site entirely. */
  skipLinkCheck?: boolean;
  /**
   * Substrings of console/page error messages to treat as known noise and
   * ignore (e.g. a third-party analytics script that fails to load). Lets us
   * keep the console-error check strict while triaging accepted exceptions.
   */
  ignoreConsolePatterns?: string[];
  /** Extra tags to associate with this site's tests. */
  tags?: string[];
}
