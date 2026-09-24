/**
 * Discord notifier for Web Quality Sentinel.
 *
 * Posts a concise run summary (per-site pass rates, flaky count, a11y totals)
 * to `env.discordWebhookUrl`. When the webhook is not configured it no-ops.
 * All failures are logged and the process still exits 0 so a flaky
 * notification never breaks CI.
 *
 * Runnable directly with `tsx src/dashboard/notify.ts`.
 */
import { argv, exit } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from '../../config/env';
import { SEVERITY_ORDER } from '../types';
import { analyze, type Analysis } from './analyze';

/** A minimal shape of the Discord embed we send. */
interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  timestamp: string;
}

/** Pick an embed color (green/amber/red) from the worst site pass rate. */
function embedColor(analysis: Analysis): number {
  if (analysis.perSite.length === 0) return 0x6b7280; // grey
  const worst = Math.min(...analysis.perSite.map((s) => s.passRate));
  if (worst >= 90) return 0x16a34a;
  if (worst >= 70) return 0xd97706;
  return 0xdc2626;
}

/** Build the Discord webhook payload from the analysis. */
function buildPayload(analysis: Analysis): { embeds: DiscordEmbed[] } {
  const flakyCount = analysis.perTest.filter((t) => t.flakinessScore > 0).length;
  const siteField = analysis.perSite.length
    ? analysis.perSite.map((s) => `${s.site}: ${s.passRate}% (${s.latestStatus})`).join('\n')
    : 'No site data yet.';
  const a11yField = SEVERITY_ORDER.map((sev) => `${sev}: ${analysis.a11y.bySeverity[sev]}`).join(
    ' · ',
  );

  const embed: DiscordEmbed = {
    title: 'Web Quality Sentinel — run summary',
    description: `${analysis.runCount} run(s) analyzed · ${flakyCount} flaky test(s)`,
    color: embedColor(analysis),
    fields: [
      { name: 'Site pass rates', value: siteField, inline: false },
      {
        name: 'Accessibility',
        value: `${analysis.a11y.total} total\n${a11yField}`,
        inline: false,
      },
    ],
    timestamp: analysis.generatedAt,
  };
  return { embeds: [embed] };
}

/**
 * Send the summary to Discord, or skip when no webhook is configured.
 *
 * @returns Resolves once the request completes (or is skipped/failed); never
 * rejects.
 */
export async function notify(): Promise<void> {
  if (!env.discordWebhookUrl) {
    console.log('Discord webhook not configured; skipping.');
    return;
  }
  try {
    const payload = buildPayload(analyze());
    const response = await fetch(env.discordWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error(`[notify] Discord responded ${response.status} ${response.statusText}`);
      return;
    }
    console.log('[notify] summary posted to Discord.');
  } catch (error) {
    console.error('[notify] failed to post to Discord:', error);
  }
}

/** True when this module is the process entry point (run via tsx/node). */
function isMain(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return fileURLToPath(import.meta.url) === entry;
  }
}

if (isMain()) {
  // Always exit 0: notification failures must not fail the pipeline.
  void notify().then(() => exit(0));
}
