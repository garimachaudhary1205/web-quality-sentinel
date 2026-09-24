import { test as base, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  type ConsoleErrorCollector,
} from '../src/monitors/console-collector';

/** Fixtures provided by the Web Quality Sentinel test harness. */
export interface WqsFixtures {
  /**
   * A console-error collector attached to `page` before the test body runs, so
   * errors emitted during navigation are captured. Read `.errors` after load.
   */
  consoleErrors: ConsoleErrorCollector;
}

/**
 * Shared Playwright `test` object with Web Quality Sentinel fixtures.
 *
 * The `consoleErrors` fixture attaches the console collector to the page up
 * front and disposes it during teardown, so specs can navigate and then assert
 * on collected console/page errors without extra wiring.
 */
export const test = base.extend<WqsFixtures>({
  consoleErrors: async ({ page }, use) => {
    const collector = collectConsoleErrors(page);
    await use(collector);
    collector.dispose();
  },
});

export { expect };
