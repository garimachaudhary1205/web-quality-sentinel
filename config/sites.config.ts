import type { SiteConfig } from '../src/types';

/**
 * The list of public websites the Health Monitor watches.
 *
 * Adding a new site is a one-line change: append a `SiteConfig` object here.
 * Every monitor test iterates this array, so a new entry is automatically
 * covered by load, console-error, broken-link, performance, and accessibility
 * checks.
 *
 * Defaults use stable, well-known public demo sites that are safe and
 * intended for automated testing.
 */
export const sites: SiteConfig[] = [
  {
    key: 'saucedemo',
    name: 'Sauce Demo',
    url: 'https://www.saucedemo.com',
    tags: ['ecommerce'],
  },
  {
    key: 'todomvc',
    name: 'Playwright TodoMVC',
    url: 'https://demo.playwright.dev/todomvc',
    tags: ['spa'],
  },
  {
    key: 'the-internet',
    name: 'The Internet (Heroku)',
    url: 'https://the-internet.herokuapp.com',
    tags: ['playground'],
    // This site intentionally hosts broken links/status-code demos, so keep
    // the link check but tolerate its known-bad external references.
    ignoreLinkPatterns: ['status_codes', 'redirector', 'download'],
    // The homepage references a third-party ad/analytics script that fails DNS
    // resolution — known noise on this demo host, not an app defect.
    ignoreConsolePatterns: ['Failed to load resource', 'ERR_NAME_NOT_RESOLVED'],
  },
  {
    key: 'practicesoftwaretesting',
    name: 'Practice Software Testing',
    url: 'https://practicesoftwaretesting.com',
    tags: ['ecommerce', 'spa'],
    // SPA that hydrates and calls an API; give it a little more headroom.
    perfThresholdMs: 6000,
  },
];

/** Look up a site by its stable key. */
export function siteByKey(key: string): SiteConfig | undefined {
  return sites.find((s) => s.key === key);
}
