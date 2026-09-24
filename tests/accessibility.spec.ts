import { sites } from '../config/sites.config';
import { A11Y_ANNOTATION_TYPE, SITE_ANNOTATION_TYPE } from '../src/types';
import { runAxe } from '../src/monitors/accessibility';
import { expect, test } from './fixtures';

for (const site of sites) {
  test.describe(site.name, () => {
    test('@a11y accessibility scan', async ({ page }) => {
      test.info().annotations.push({ type: SITE_ANNOTATION_TYPE, description: site.key });

      await page.goto(site.url, { waitUntil: 'load' });
      const summary = await runAxe(page);

      // Persist the full summary for the dashboard, regardless of pass/fail.
      test.info().annotations.push({
        type: A11Y_ANNOTATION_TYPE,
        description: JSON.stringify(summary),
      });

      const { critical, serious, moderate, minor } = summary.bySeverity;
      // Fail only on critical violations; report the rest without failing so the
      // dashboard still receives serious/moderate/minor counts.
      expect(
        critical,
        `${site.url} has ${critical} critical a11y violation(s) ` +
          `(serious: ${serious}, moderate: ${moderate}, minor: ${minor}); rules: ` +
          `${summary.ruleIds.join(', ')}`,
      ).toBe(0);
    });
  });
}
