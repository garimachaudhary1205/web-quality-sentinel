import { env } from '../config/env';
import { sites } from '../config/sites.config';
import { SITE_ANNOTATION_TYPE } from '../src/types';
import { checkLinks } from '../src/monitors/link-checker';
import { measureNavigationTiming } from '../src/monitors/performance';
import { expect, test } from './fixtures';

for (const site of sites) {
  test.describe(site.name, () => {
    test('@smoke @health page loads successfully', async ({ page }) => {
      test.info().annotations.push({ type: SITE_ANNOTATION_TYPE, description: site.key });

      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      expect(response, 'navigation should produce a response').not.toBeNull();
      expect(response?.status(), `expected a non-error status for ${site.url}`).toBeLessThan(400);
      expect(response?.ok(), `response.ok() should be true for ${site.url}`).toBe(true);

      const bodyText = (await page.locator('body').innerText()).trim();
      expect(bodyText.length, `body of ${site.url} should not be blank`).toBeGreaterThan(0);
    });

    test('@health @perf page load performance within budget', async ({ page }) => {
      test.info().annotations.push({ type: SITE_ANNOTATION_TYPE, description: site.key });

      await page.goto(site.url, { waitUntil: 'load' });
      const timing = await measureNavigationTiming(page);
      const budget = site.perfThresholdMs ?? env.perfThresholdMs;

      expect(
        timing.loadMs,
        `load time ${timing.loadMs}ms exceeded budget ${budget}ms for ${site.url}`,
      ).toBeLessThanOrEqual(budget);
    });

    test('@health @links no broken links on the page', async ({ page, request }) => {
      test.info().annotations.push({ type: SITE_ANNOTATION_TYPE, description: site.key });
      test.skip(site.skipLinkCheck === true, 'link check disabled for this site');

      await page.goto(site.url, { waitUntil: 'domcontentloaded' });
      const { checked, broken } = await checkLinks(page, { request, site });

      const detail = broken.map((b) => `${b.url} (status ${b.status})`).join(', ');
      expect(
        broken,
        `found ${broken.length} broken link(s) of ${checked} checked: ${detail}`,
      ).toHaveLength(0);
    });

    test('@health no console errors on load', async ({ page, consoleErrors }) => {
      test.info().annotations.push({ type: SITE_ANNOTATION_TYPE, description: site.key });

      await page.goto(site.url, { waitUntil: 'load' });

      const ignore = site.ignoreConsolePatterns ?? [];
      const errors = consoleErrors.errors.filter(
        (msg) => !ignore.some((pattern) => msg.includes(pattern)),
      );

      expect(errors, `console/page errors on ${site.url}: ${errors.join(' | ')}`).toEqual([]);
    });
  });
}
