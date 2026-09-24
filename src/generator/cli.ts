import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../../config/env';
import { generateWithAI } from './ai';
import { crawlPage } from './crawl';
import { renderTemplate } from './template';

/** Parsed command-line options. */
interface CliArgs {
  url?: string;
  story?: string;
  out?: string;
  name?: string;
}

/**
 * Parse `--flag value` style arguments from the process argv tail.
 *
 * @param argv - The raw argument list (typically `process.argv.slice(2)`).
 * @returns The parsed {@link CliArgs}.
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--url':
        args.url = argv[++i];
        break;
      case '--story':
        args.story = argv[++i];
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--name':
        args.name = argv[++i];
        break;
      default:
        break;
    }
  }
  return args;
}

/** Print CLI usage to stderr. */
function printUsage(): void {
  console.error(
    'Usage: npm run generate -- --url <https://...> [--story "..."] [--out path] [--name testName]',
  );
}

/**
 * Convert a string into a filesystem-friendly slug.
 *
 * @param value - The raw string.
 * @returns A lowercase, dash-separated slug.
 */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

/**
 * Derive a default output spec path from an explicit name or the URL.
 *
 * @param url - The crawled URL.
 * @param name - Optional explicit test name.
 * @returns A path under `tests/generated/`.
 */
function defaultOutPath(url: string, name?: string): string {
  if (name) return resolve('tests/generated', `${slugify(name)}.spec.ts`);
  const parsed = new URL(url);
  const base = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, '');
  return resolve('tests/generated', `${slugify(base)}.spec.ts`);
}

/**
 * CLI entry point: crawl a page and emit a Playwright spec, preferring AI
 * generation when a Gemini key is configured and falling back to templates.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    console.error('Error: --url is required.');
    printUsage();
    process.exit(1);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(args.url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('URL must use http or https.');
    }
  } catch {
    console.error(`Error: invalid --url value: ${args.url}`);
    printUsage();
    process.exit(1);
    return;
  }

  console.log(`Crawling ${parsedUrl.href} ...`);
  const summary = await crawlPage(parsedUrl.href);
  console.log(
    `Found ${summary.headings.length} heading(s), ${summary.forms.length} form(s), ` +
      `${summary.buttons.length} button(s), ${summary.links.length} link(s).`,
  );

  let mode: 'ai' | 'template' = 'template';
  let source: string | null = null;

  if (env.geminiApiKey) {
    console.log('Gemini key detected — attempting AI generation ...');
    source = await generateWithAI(summary, args.story);
    if (source) mode = 'ai';
  }

  if (!source) {
    source = renderTemplate(summary);
    mode = 'template';
  }

  const outPath = args.out ? resolve(args.out) : defaultOutPath(parsedUrl.href, args.name);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, source, 'utf8');

  console.log(`Wrote spec to ${outPath} (mode: ${mode}).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Generation failed: ${message}`);
  process.exit(1);
});
