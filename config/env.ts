/**
 * Environment-based configuration with sensible defaults.
 *
 * Everything here is safe to run with zero environment variables set — the
 * defaults target free, public demo sites and reasonable budgets. Optional
 * integrations (Discord, AI test generation) activate only when their
 * corresponding env var is present.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() !== '' ? raw : fallback;
}

export const env = {
  /** Page-load performance budget in ms (Navigation Timing). */
  perfThresholdMs: num('PERF_THRESHOLD_MS', 4000),
  /** Max number of links to status-check per page (keeps runs fast). */
  maxLinksPerPage: num('MAX_LINKS_PER_PAGE', 20),
  /** Timeout for a single broken-link HEAD/GET request, in ms. */
  linkCheckTimeoutMs: num('LINK_CHECK_TIMEOUT_MS', 10000),
  /** Directory where run summaries are written/read. */
  historyDir: str('HISTORY_DIR', 'history'),
  /** Directory where the static dashboard is emitted. */
  dashboardDir: str('DASHBOARD_DIR', 'public'),

  /** Optional: Discord webhook for run summaries. Empty = disabled. */
  discordWebhookUrl: str('DISCORD_WEBHOOK_URL', ''),

  /**
   * Optional: Google Gemini API key for AI-enhanced test generation.
   * Accepts either GEMINI_API_KEY or GOOGLE_API_KEY. Empty = template mode.
   */
  geminiApiKey: str('GEMINI_API_KEY', '') || str('GOOGLE_API_KEY', ''),
  /** Gemini model id for the free tier. */
  geminiModel: str('GEMINI_MODEL', 'gemini-1.5-flash'),

  /** CI metadata (GitHub Actions populates these automatically). */
  isCI: process.env.CI === 'true' || process.env.CI === '1',
  gitCommit: process.env.GITHUB_SHA ?? null,
  gitBranch: process.env.GITHUB_REF_NAME ?? null,
  ciRunUrl:
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
} as const;

export type Env = typeof env;
