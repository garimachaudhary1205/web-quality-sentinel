import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { SEVERITY_ORDER, type AccessibilitySummary, type Severity } from '../types';

/**
 * Normalize an axe `impact` value into a known {@link Severity}.
 *
 * axe reports impact as `'critical' | 'serious' | 'moderate' | 'minor' | null`.
 * A null or unrecognized impact is treated as `'minor'`.
 *
 * @param impact - The raw impact string (or null) from an axe violation.
 * @returns A valid {@link Severity} bucket.
 */
function toSeverity(impact: string | null | undefined): Severity {
  return (SEVERITY_ORDER as string[]).includes(impact ?? '') ? (impact as Severity) : 'minor';
}

/**
 * Run an axe-core accessibility scan against the current page and summarize it.
 *
 * Uses `@axe-core/playwright` to analyze the loaded page, then buckets each
 * violation by severity and collects the deduped set of violated rule ids into
 * the shared {@link AccessibilitySummary} shape.
 *
 * @param page - The Playwright page to scan (navigate before calling).
 * @returns The aggregated {@link AccessibilitySummary}.
 */
export async function runAxe(page: Page): Promise<AccessibilitySummary> {
  const results = await new AxeBuilder({ page }).analyze();

  const bySeverity: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  const ruleIds = new Set<string>();

  for (const violation of results.violations) {
    bySeverity[toSeverity(violation.impact)] += 1;
    ruleIds.add(violation.id);
  }

  return {
    total: results.violations.length,
    bySeverity,
    ruleIds: [...ruleIds],
  };
}
