import { env } from '../../config/env';
import type { PageSummary } from './crawl';

/** Minimal shape of the Gemini `generateContent` response we consume. */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/**
 * Remove Markdown code fences (```ts ... ```) from a model response, leaving
 * only the raw source code.
 *
 * @param text - The raw model text.
 * @returns The de-fenced source.
 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Fallback: strip any stray fence lines.
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/gm, '')
    .replace(/```\s*$/gm, '')
    .trim();
}

/**
 * Build the prompt instructing Gemini to emit a Playwright test file.
 *
 * @param summary - The crawled page summary.
 * @param story - Optional user story describing the desired scenario.
 * @returns The prompt text.
 */
function buildPrompt(summary: PageSummary, story?: string): string {
  return [
    'You are a senior Playwright test author.',
    'Output ONLY a complete, valid Playwright test file written in TypeScript.',
    'Do not include any explanation, prose, or Markdown code fences.',
    "Start the file with: import { test, expect } from '@playwright/test';",
    'Use role-based and label locators (getByRole, getByLabel, getByPlaceholder).',
    'Avoid brittle CSS or XPath selectors. Do not use hard waits (waitForTimeout).',
    'Prefer web-first assertions (expect(...).toBeVisible(), toHaveTitle, etc.).',
    'Embed grep-able tags in test titles, e.g. @smoke and @health.',
    '',
    story
      ? `User story to cover:\n${story}`
      : 'No user story provided; generate sensible smoke tests.',
    '',
    'DOM summary (JSON):',
    JSON.stringify(summary),
  ].join('\n');
}

/**
 * Attempt to generate a Playwright test file via the Google Gemini REST API.
 *
 * Returns `null` immediately when no API key is configured, and also returns
 * `null` (after logging a warning) on any network error, non-200 response, or
 * empty output — allowing the caller to fall back to template generation. The
 * API key is never logged.
 *
 * @param summary - The crawled page summary to base the test on.
 * @param story - Optional user story describing the desired scenario.
 * @returns The generated test source, or `null` to signal fallback.
 */
export async function generateWithAI(summary: PageSummary, story?: string): Promise<string | null> {
  if (!env.geminiApiKey) return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(summary, story) }] }],
      }),
    });

    if (!response.ok) {
      console.warn(`[ai] Gemini request failed with status ${response.status}; using template.`);
      return null;
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const code = stripFences(text);

    if (!code) {
      console.warn('[ai] Gemini returned empty output; using template.');
      return null;
    }
    return code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai] Gemini generation error (${message}); using template.`);
    return null;
  }
}
