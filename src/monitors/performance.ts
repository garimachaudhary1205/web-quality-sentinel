import type { Page } from '@playwright/test';

/** Key navigation-timing metrics for a page load, in milliseconds. */
export interface NavigationTiming {
  /** Time from navigation start to the `load` event. */
  loadMs: number;
  /** Time from navigation start to `DOMContentLoaded`. */
  domContentLoadedMs: number;
  /** Time to first byte (response start relative to request start). */
  ttfbMs: number;
}

/**
 * Measure page-load performance from the Navigation Timing API.
 *
 * Reads `performance.getEntriesByType('navigation')[0]` inside the page and
 * derives load, DOMContentLoaded, and TTFB durations. When timing data is
 * unavailable (e.g. the entry is missing), all metrics fall back to `0`.
 *
 * @param page - The Playwright page to measure (should be loaded first).
 * @returns The computed {@link NavigationTiming} metrics.
 */
export async function measureNavigationTiming(page: Page): Promise<NavigationTiming> {
  return page.evaluate<NavigationTiming>(() => {
    const empty = { loadMs: 0, domContentLoadedMs: 0, ttfbMs: 0 };
    const entries = performance.getEntriesByType('navigation');
    const nav = entries[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return empty;

    const loadMs = nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : 0;
    const domContentLoadedMs =
      nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd - nav.startTime : 0;
    const ttfbMs = nav.responseStart > 0 ? nav.responseStart - nav.requestStart : 0;

    return {
      loadMs: Math.max(0, Math.round(loadMs)),
      domContentLoadedMs: Math.max(0, Math.round(domContentLoadedMs)),
      ttfbMs: Math.max(0, Math.round(ttfbMs)),
    };
  });
}
