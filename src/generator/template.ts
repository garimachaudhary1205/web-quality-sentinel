import type { FieldSummary, FormSummary, PageSummary } from './crawl';

/**
 * Escape a string so it can be safely embedded inside a single-quoted
 * TypeScript string literal.
 *
 * @param value - The raw string to escape.
 * @returns The escaped string (without surrounding quotes).
 */
function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').trim();
}

/** Field types we treat as fillable free-text inputs. */
const TEXT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', '']);

/** Produce placeholder sample data for a given field. */
function sampleValue(field: FieldSummary): string {
  const type = (field.type ?? '').toLowerCase();
  if (type === 'email') return 'test@example.com';
  if (type === 'password') return 'S3curePass!';
  if (type === 'tel') return '5551234567';
  if (type === 'url') return 'https://example.com';
  if (type === 'number') return '42';
  return 'Test input';
}

/**
 * Build the best available role-based/label locator expression for a field.
 *
 * Prefers `getByLabel`, then `getByRole('textbox', { name })`, then
 * `getByPlaceholder`. When no accessible name exists, returns a best-effort
 * locator plus a flag so the caller can emit a TODO comment.
 *
 * @param field - The field to locate.
 * @returns The locator expression and whether it is a confident match.
 */
function fillLocator(field: FieldSummary): { expr: string; confident: boolean } {
  if (field.label) {
    return { expr: `page.getByLabel('${esc(field.label)}')`, confident: true };
  }
  const role = field.role ?? 'textbox';
  if (field.accessibleName && role === 'textbox') {
    return {
      expr: `page.getByRole('textbox', { name: '${esc(field.accessibleName)}' })`,
      confident: true,
    };
  }
  if (field.placeholder) {
    return { expr: `page.getByPlaceholder('${esc(field.placeholder)}')`, confident: true };
  }
  if (field.accessibleName) {
    return {
      expr: `page.getByRole('${role}', { name: '${esc(field.accessibleName)}' })`,
      confident: true,
    };
  }
  // Best-effort fallback locator (needs human review).
  if (field.id) return { expr: `page.locator('#${esc(field.id)}')`, confident: false };
  if (field.name) {
    return { expr: `page.locator('[name="${esc(field.name)}"]')`, confident: false };
  }
  return { expr: `page.locator('${field.tag}')`, confident: false };
}

/** A concise human-readable label for a form (for the test title). */
function formLabel(form: FormSummary, index: number): string {
  return form.name || form.id || `form ${index + 1}`;
}

/** Render the smoke test block. */
function renderSmoke(summary: PageSummary): string {
  const lines: string[] = [];
  lines.push(`test('@smoke page loads and renders @health', async ({ page }) => {`);
  lines.push(`  await page.goto('${esc(summary.url)}');`);
  if (summary.title) {
    lines.push(`  await expect(page).toHaveTitle(/${escRegex(summary.title)}/i);`);
  }
  const h1 = summary.headings.find((h) => h.level === 1) ?? summary.headings[0];
  if (h1) {
    lines.push(
      `  await expect(page.getByRole('heading', { name: '${esc(h1.text)}' }).first()).toBeVisible();`,
    );
  } else {
    lines.push(`  await expect(page.locator('body')).toBeVisible();`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

/** Escape a string for safe inclusion inside a RegExp literal. */
function escRegex(value: string): string {
  return esc(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render one form-submission test block. */
function renderForm(form: FormSummary, index: number, summary: PageSummary): string {
  const lines: string[] = [];
  const label = formLabel(form, index);
  lines.push(`test('@smoke submit ${esc(label)}', async ({ page }) => {`);
  lines.push(`  await page.goto('${esc(summary.url)}');`);

  const fillable = form.fields.filter((f) => {
    const type = (f.type ?? '').toLowerCase();
    return f.tag === 'textarea' || (f.tag === 'input' && TEXT_TYPES.has(type));
  });

  if (fillable.length === 0) {
    lines.push(`  // TODO: no fillable text fields detected in this form.`);
  }

  for (const field of fillable) {
    const { expr, confident } = fillLocator(field);
    if (!confident) {
      lines.push(`  // TODO: no accessible name found; verify this locator.`);
    }
    lines.push(`  await ${expr}.fill('${esc(sampleValue(field))}');`);
  }

  const submit = summary.buttons.find((b) =>
    /submit|log ?in|sign ?in|send|search|continue/i.test(b.text),
  );
  const button = submit ?? summary.buttons[0];
  if (button) {
    lines.push(
      `  await page.getByRole('button', { name: '${esc(button.accessibleName ?? button.text)}' }).click();`,
    );
  } else {
    lines.push(`  // TODO: no submit button detected for this form.`);
  }
  lines.push(`});`);
  return lines.join('\n');
}

/** Render the "key buttons are visible" test block. */
function renderButtons(summary: PageSummary): string {
  const lines: string[] = [];
  lines.push(`test('@smoke key buttons are visible', async ({ page }) => {`);
  lines.push(`  await page.goto('${esc(summary.url)}');`);
  const keyButtons = summary.buttons.slice(0, 5);
  if (keyButtons.length === 0) {
    lines.push(`  // TODO: no buttons detected on the page.`);
    lines.push(`  await expect(page.locator('body')).toBeVisible();`);
  }
  for (const button of keyButtons) {
    const name = esc(button.accessibleName ?? button.text);
    lines.push(
      `  await expect(page.getByRole('button', { name: '${name}' }).first()).toBeVisible();`,
    );
  }
  lines.push(`});`);
  return lines.join('\n');
}

/**
 * Render a complete, ready-to-run Playwright test file from a {@link PageSummary}.
 *
 * Produces a smoke test, one submission test per detected form, and a test that
 * asserts key buttons are visible. Locators prefer `getByLabel` /
 * `getByPlaceholder` / `getByRole`; fields without an accessible name fall back
 * to a best-effort locator preceded by a `TODO` comment. Output follows the
 * project's Prettier settings (single quotes, semicolons).
 *
 * @param summary - The crawled page summary.
 * @returns Valid Playwright TypeScript test source.
 */
export function renderTemplate(summary: PageSummary): string {
  const blocks: string[] = [];
  blocks.push(renderSmoke(summary));
  summary.forms.forEach((form, index) => {
    blocks.push(renderForm(form, index, summary));
  });
  blocks.push(renderButtons(summary));

  const header = [
    '/**',
    ' * Auto-generated by Web Quality Sentinel (template mode).',
    ` * Source: ${summary.url}`,
    ` * Generated: ${new Date().toISOString()}`,
    ' * Review before committing — locators marked TODO need a human.',
    ' */',
  ].join('\n');

  return `${header}
import { test, expect } from '@playwright/test';

${blocks.join('\n\n')}
`;
}
