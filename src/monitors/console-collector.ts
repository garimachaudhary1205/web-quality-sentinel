import type { ConsoleMessage, Page } from '@playwright/test';

/** A live collector of console errors and uncaught page errors. */
export interface ConsoleErrorCollector {
  /** Collected error strings, in the order they occurred. */
  readonly errors: string[];
  /** Detach the listeners. Safe to call multiple times. */
  dispose(): void;
}

/**
 * Attach listeners to a page that collect `console` errors and uncaught
 * `pageerror` events.
 *
 * Attach this BEFORE navigation so errors emitted during load are captured.
 * `console` messages are collected only when their type is `error`; `pageerror`
 * events (uncaught exceptions) are always collected.
 *
 * @param page - The Playwright page to observe.
 * @returns A {@link ConsoleErrorCollector} exposing collected errors and a
 *   `dispose` method to remove the listeners.
 */
export function collectConsoleErrors(page: Page): ConsoleErrorCollector {
  const errors: string[] = [];

  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  };

  const onPageError = (error: Error): void => {
    errors.push(error.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let disposed = false;
  return {
    errors,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}
