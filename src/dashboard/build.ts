/**
 * Static dashboard builder for Web Quality Sentinel.
 *
 * Turns the {@link analyze} output into a single, self-contained
 * `public/index.html` — no external CDNs, scripts, or fonts, so it renders
 * safely under a strict CSP and on GitHub Pages. The raw analysis is embedded
 * in a `<script type="application/json" id="data">` block so the page is
 * data-driven and the JSON can be scraped by other tools.
 *
 * Runnable directly with `tsx src/dashboard/build.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from '../../config/env';
import { SEVERITY_ORDER, type Severity, type TestStatus } from '../types';
import { analyze, type Analysis, type SiteHealth, type TrendPoint } from './analyze';

/** Escape a string for safe interpolation into HTML text/attribute contexts. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Map a status to a semantic CSS class name. */
function statusClass(status: TestStatus): string {
  switch (status) {
    case 'passed':
      return 'ok';
    case 'flaky':
      return 'warn';
    case 'skipped':
      return 'muted';
    default:
      return 'bad';
  }
}

/** Choose a health class from a pass-rate percentage. */
function rateClass(rate: number): string {
  if (rate >= 90) return 'ok';
  if (rate >= 70) return 'warn';
  return 'bad';
}

/** Render the per-site health cards, or an empty-state message. */
function renderSiteCards(sites: SiteHealth[]): string {
  if (sites.length === 0) {
    return '<p class="empty">No site health data yet.</p>';
  }
  const cards = sites
    .map((site) => {
      const cls = rateClass(site.passRate);
      return `
      <article class="card ${cls}">
        <h3>${escapeHtml(site.site)}</h3>
        <div class="rate">${site.passRate}%</div>
        <div class="meta">${site.passed}/${site.total} passing</div>
        <div class="badge ${statusClass(site.latestStatus)}">latest: ${escapeHtml(
          site.latestStatus,
        )}</div>
      </article>`;
    })
    .join('');
  return `<div class="cards">${cards}</div>`;
}

/**
 * Render an inline SVG line chart of the pass-rate trend.
 *
 * Fully self-contained (no scripts, no external refs). Falls back to an
 * empty-state paragraph when there is nothing to plot.
 */
function renderTrendChart(trend: TrendPoint[]): string {
  if (trend.length === 0) {
    return '<p class="empty">No runs recorded yet — the trend will appear here.</p>';
  }
  const width = 720;
  const height = 240;
  const pad = { top: 20, right: 20, bottom: 40, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const n = trend.length;
  const x = (i: number): number =>
    n === 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (n - 1);
  const y = (rate: number): number => pad.top + plotH * (1 - rate / 100);

  const points = trend.map((point, i) => ({ px: x(i), py: y(point.passRate), point }));
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`)
    .join(' ');

  const gridLines = [0, 25, 50, 75, 100]
    .map((v) => {
      const gy = y(v).toFixed(1);
      return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" class="grid" />
        <text x="${pad.left - 8}" y="${gy}" class="axis" text-anchor="end" dominant-baseline="middle">${v}</text>`;
    })
    .join('');

  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="3.5" class="dot"><title>${escapeHtml(
          p.point.timestamp,
        )}: ${p.point.passRate}%</title></circle>`,
    )
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Pass-rate trend over runs" class="chart">
      ${gridLines}
      <path d="${path}" class="trend-line" fill="none" />
      ${dots}
      <text x="${pad.left}" y="${height - 12}" class="axis">oldest</text>
      <text x="${width - pad.right}" y="${height - 12}" class="axis" text-anchor="end">newest</text>
    </svg>`;
}

/** Render the flakiest-tests table (already sorted by score desc). */
function renderFlakyTable(analysis: Analysis): string {
  const rows = analysis.perTest.slice(0, 25);
  if (rows.length === 0) {
    return '<p class="empty">No tests analyzed yet.</p>';
  }
  const body = rows
    .map(
      (t) => `
      <tr>
        <td class="score ${rateClass(100 - t.flakinessScore)}">${t.flakinessScore}%</td>
        <td>${escapeHtml(t.testName)}</td>
        <td>${escapeHtml(t.site ?? '—')}</td>
        <td>${t.runs}</td>
        <td class="ok">${t.passed}</td>
        <td class="bad">${t.failed}</td>
        <td class="warn">${t.flaky}</td>
        <td>${t.avgDurationMs} ms</td>
        <td class="badge ${statusClass(t.lastStatus)}">${escapeHtml(t.lastStatus)}</td>
      </tr>`,
    )
    .join('');
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Flakiness</th><th>Test</th><th>Site</th><th>Runs</th>
          <th>Pass</th><th>Fail</th><th>Flaky</th><th>Avg</th><th>Last</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

/** Render the accessibility-by-severity summary. */
function renderA11y(analysis: Analysis): string {
  const { total, bySeverity, ruleIds } = analysis.a11y;
  if (total === 0) {
    return '<p class="empty">No accessibility violations recorded. 🎉</p>';
  }
  const bars = SEVERITY_ORDER.map((severity: Severity) => {
    const count = bySeverity[severity];
    const pct = total === 0 ? 0 : Math.round((count / total) * 100);
    return `
      <div class="sev-row">
        <span class="sev-label sev-${severity}">${severity}</span>
        <span class="sev-bar"><span class="sev-fill sev-${severity}" style="width:${pct}%"></span></span>
        <span class="sev-count">${count}</span>
      </div>`;
  }).join('');
  const rules = ruleIds.length
    ? `<p class="rules">Rules: ${ruleIds.map((r) => escapeHtml(r)).join(', ')}</p>`
    : '';
  return `<div class="a11y">${bars}</div><p class="meta">${total} total violations</p>${rules}`;
}

/** The inline stylesheet, theme-aware and CSP-safe. */
const STYLES = `
  :root {
    --bg: #f7f8fa; --fg: #1c2024; --muted: #6b7280; --card: #ffffff;
    --border: #e5e7eb; --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
    --accent: #2563eb; --grid: #e5e7eb;
    --sev-critical: #dc2626; --sev-serious: #ea580c; --sev-moderate: #d97706; --sev-minor: #ca8a04;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --card: #161b22;
      --border: #30363d; --grid: #30363d;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 24px 64px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--fg); line-height: 1.5;
  }
  header { padding: 28px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
  header h1 { margin: 0 0 4px; font-size: 1.6rem; }
  header .sub { color: var(--muted); font-size: 0.85rem; }
  header code { background: var(--card); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
  section { margin: 32px 0; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-left-width: 4px;
    border-radius: 10px; padding: 16px;
  }
  .card.ok { border-left-color: var(--ok); }
  .card.warn { border-left-color: var(--warn); }
  .card.bad { border-left-color: var(--bad); }
  .card h3 { margin: 0 0 8px; font-size: 1rem; }
  .card .rate { font-size: 2rem; font-weight: 700; }
  .card .meta, .meta { color: var(--muted); font-size: 0.85rem; }
  .badge {
    display: inline-block; margin-top: 8px; font-size: 0.72rem; padding: 2px 8px;
    border-radius: 999px; border: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.04em;
  }
  .badge.ok { color: var(--ok); border-color: var(--ok); }
  .badge.warn { color: var(--warn); border-color: var(--warn); }
  .badge.bad { color: var(--bad); border-color: var(--bad); }
  .badge.muted { color: var(--muted); }
  .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .muted { color: var(--muted); }
  .chart-wrap, .table-wrap { overflow-x: auto; }
  .chart { width: 100%; max-width: 720px; height: auto; }
  .chart .grid { stroke: var(--grid); stroke-width: 1; }
  .chart .axis { fill: var(--muted); font-size: 11px; }
  .chart .trend-line { stroke: var(--accent); stroke-width: 2.5; }
  .chart .dot { fill: var(--accent); }
  .table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  .table th, .table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .table th { color: var(--muted); font-weight: 600; }
  .table td.score { font-weight: 700; }
  .table td:nth-child(2) { white-space: normal; }
  .a11y { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
  .sev-row { display: grid; grid-template-columns: 90px 1fr 40px; align-items: center; gap: 10px; }
  .sev-label { font-size: 0.8rem; text-transform: capitalize; font-weight: 600; }
  .sev-bar { background: var(--border); border-radius: 999px; height: 10px; overflow: hidden; }
  .sev-fill { display: block; height: 100%; }
  .sev-critical { color: var(--sev-critical); } .sev-fill.sev-critical { background: var(--sev-critical); }
  .sev-serious { color: var(--sev-serious); } .sev-fill.sev-serious { background: var(--sev-serious); }
  .sev-moderate { color: var(--sev-moderate); } .sev-fill.sev-moderate { background: var(--sev-moderate); }
  .sev-minor { color: var(--sev-minor); } .sev-fill.sev-minor { background: var(--sev-minor); }
  .sev-count { text-align: right; font-variant-numeric: tabular-nums; }
  .rules { color: var(--muted); font-size: 0.8rem; word-break: break-word; }
  .empty { color: var(--muted); font-style: italic; }
  footer { margin-top: 48px; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--border); padding-top: 16px; }
`;

/** Assemble the full HTML document string from the analysis. */
function renderHtml(analysis: Analysis): string {
  const commit = analysis.lastCommit ? escapeHtml(analysis.lastCommit.slice(0, 12)) : 'unknown';
  const json = JSON.stringify(analysis).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Quality Sentinel — Dashboard</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <h1>Web Quality Sentinel</h1>
    <div class="sub">
      Generated ${escapeHtml(analysis.generatedAt)} ·
      ${analysis.runCount} run(s) analyzed ·
      commit <code>${commit}</code>
    </div>
  </header>

  <section>
    <h2>Site health</h2>
    ${renderSiteCards(analysis.perSite)}
  </section>

  <section>
    <h2>Pass-rate trend</h2>
    <div class="chart-wrap">${renderTrendChart(analysis.trend)}</div>
  </section>

  <section>
    <h2>Flakiest tests</h2>
    <div class="table-wrap">${renderFlakyTable(analysis)}</div>
  </section>

  <section>
    <h2>Accessibility violations by severity</h2>
    ${renderA11y(analysis)}
  </section>

  <footer>
    Static dashboard · no external assets · data embedded below.
  </footer>

  <script type="application/json" id="data">${json}</script>
</body>
</html>
`;
}

/**
 * Build the dashboard: analyze history and write `public/index.html`.
 *
 * @param outDir - Output directory. Defaults to `env.dashboardDir`.
 * @returns The absolute-ish path of the written HTML file.
 */
export function build(outDir: string = env.dashboardDir): string {
  const analysis = analyze();
  const html = renderHtml(analysis);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'index.html');
  writeFileSync(file, html, 'utf8');
  return file;
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
  const file = build();
  console.log(`[dashboard] wrote ${file}`);
}
