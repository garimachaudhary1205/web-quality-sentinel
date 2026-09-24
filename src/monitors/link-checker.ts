import type { APIRequestContext, Page } from '@playwright/test';
import { env } from '../../config/env';
import type { SiteConfig } from '../types';

/** A single broken link discovered on the page. */
export interface BrokenLink {
  /** The absolute URL that failed. */
  url: string;
  /** HTTP status code (>= 400), or 0 for a network/transport error. */
  status: number;
}

/** Result of checking every eligible link on a page. */
export interface LinkCheckResult {
  /** Number of links actually status-checked. */
  checked: number;
  /** Links whose status was >= 400 (or 0 for network errors). */
  broken: BrokenLink[];
}

/** Options for {@link checkLinks}. */
export interface CheckLinksOptions {
  /** Playwright request fixture used to issue HEAD/GET probes. */
  request: APIRequestContext;
  /** The site under test, providing `ignoreLinkPatterns`. */
  site: Pick<SiteConfig, 'ignoreLinkPatterns'>;
  /** How many probes to run concurrently. Defaults to 5. */
  concurrency?: number;
}

/** URL schemes that are never HTTP-checkable. */
const NON_HTTP_SCHEMES = ['mailto:', 'tel:', 'javascript:'];

/**
 * Statuses that mean "the resource exists but is access-controlled". A link to
 * an auth-gated page (401 Unauthorized) or a bot-blocked one (403 Forbidden) is
 * not a *broken* link — the target is reachable, it just requires credentials.
 * Treating these as broken produces noisy false positives (e.g. the
 * `/basic_auth` and `/digest_auth` demo pages), so we exclude them.
 */
const REACHABLE_PROTECTED_STATUSES = new Set([401, 403]);

/**
 * Decide whether a raw `href` value is worth status-checking.
 *
 * Filters out empty anchors, pure `#` fragments, non-HTTP schemes, and any
 * href matching one of the site's `ignoreLinkPatterns`.
 *
 * @param href - The raw href attribute value.
 * @param ignorePatterns - Substrings that mark a link as intentionally ignored.
 * @returns `true` when the link should be resolved and checked.
 */
function isCheckableHref(href: string, ignorePatterns: string[]): boolean {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed === '#' || trimmed.startsWith('#')) return false;
  const lower = trimmed.toLowerCase();
  if (NON_HTTP_SCHEMES.some((scheme) => lower.startsWith(scheme))) return false;
  if (ignorePatterns.some((pattern) => trimmed.includes(pattern))) return false;
  return true;
}

/**
 * Probe a single URL and report whether it is broken.
 *
 * Issues a `HEAD` request first; if the server rejects HEAD with 405 (method
 * not allowed) it retries with `GET`. Auth-protected statuses (401/403) are
 * treated as reachable, not broken. Any thrown transport error is reported as
 * status `0`.
 *
 * @param request - Playwright API request context.
 * @param url - Absolute URL to probe.
 * @returns A {@link BrokenLink} when broken, or `null` when healthy/protected.
 */
async function probe(request: APIRequestContext, url: string): Promise<BrokenLink | null> {
  const options = { timeout: env.linkCheckTimeoutMs, maxRedirects: 5 };
  try {
    let response = await request.head(url, options);
    let status = response.status();
    // Some servers don't implement HEAD; retry those with GET.
    if (status === 405 || status === 501) {
      response = await request.get(url, options);
      status = response.status();
    }
    if (REACHABLE_PROTECTED_STATUSES.has(status)) return null;
    return status >= 400 ? { url, status } : null;
  } catch {
    return { url, status: 0 };
  }
}

/**
 * Collect and status-check the links on the current page.
 *
 * Gathers unique `href` values from `<a>` elements, filters out non-HTTP and
 * ignored links, resolves relative URLs against the page URL, caps the list at
 * `env.maxLinksPerPage`, and probes each remaining link in modest concurrent
 * batches. No hard waits are used.
 *
 * @param page - The Playwright page whose links should be checked.
 * @param opts - The request fixture, site config, and optional concurrency.
 * @returns The number checked and the list of broken links.
 */
export async function checkLinks(page: Page, opts: CheckLinksOptions): Promise<LinkCheckResult> {
  const { request, site, concurrency = 5 } = opts;
  const ignorePatterns = site.ignoreLinkPatterns ?? [];

  const rawHrefs = await page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => a.getAttribute('href') ?? ''),
  );

  const pageUrl = page.url();
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of rawHrefs) {
    if (!isCheckableHref(href, ignorePatterns)) continue;
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
    if (urls.length >= env.maxLinksPerPage) break;
  }

  const broken: BrokenLink[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((url) => probe(request, url)));
    for (const result of results) {
      if (result) broken.push(result);
    }
  }

  return { checked: urls.length, broken };
}
