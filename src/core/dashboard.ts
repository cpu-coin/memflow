import http from "node:http";
import net from "node:net";
import { URL } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryService } from "./memory-service.js";
import { mobileChannelPreview, normalizeMobileChannel } from "./mobile-delivery.js";
import { createConnectorFromEnvironment } from "../mcp/server.js";
import { readMemFlowConfig, getDefaultConfigPath } from "./config.js";
import type {
  MemoryEntry,
  MemoryScope,
  OperationalMetricsSnapshot,
  MemoryStats,
  MemFlowConfig,
} from "../types/memory.js";

export interface DashboardOptions {
  port?: number;
  configPath?: string;
  /** If true, automatically increment the port until a free one is found. */
  autoPort?: boolean;
  /** How many ports to try before giving up. Defaults to 10. */
  maxPortRetries?: number;
}

/**
 * Probe whether a TCP port is available on localhost.
 * Returns true when nothing is listening on that port.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Kill whatever process is currently holding `port` on macOS/Linux.
 * Uses `lsof` to find the PID, then sends SIGTERM (with SIGKILL fallback).
 * Resolves once the port is free or the kill attempt finishes.
 */
export async function killPortOwner(port: number): Promise<void> {
  const { execSync } = await import("node:child_process");
  let pid: number | undefined;
  try {
    // lsof -ti TCP:<port> returns newline-separated PIDs
    const raw = execSync(`lsof -ti TCP:${port}`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    const firstPid = raw.split("\n")[0];
    pid = firstPid ? parseInt(firstPid, 10) : undefined;
  } catch {
    // Nothing listening — port is already free
    return;
  }
  if (!pid || isNaN(pid)) return;
  try {
    process.stderr.write(`Stopping existing dashboard process (PID ${pid}) on port ${port}…\n`);
    execSync(`kill -TERM ${pid}`, { stdio: "ignore" });
    // Give it up to 2 s to exit gracefully
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (await isPortFree(port)) return;
    }
    // Force-kill if still alive
    execSync(`kill -KILL ${pid}`, { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 200));
  } catch {
    // Process already gone
  }
}

export function startDashboard(options: DashboardOptions = {}): http.Server {
  const port = options.port ?? 3000;
  const configPath = options.configPath ?? getDefaultConfigPath();
  const service = new MemoryService(createConnectorFromEnvironment(configPath));

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }

      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname === "/api/status") {
        const project = url.searchParams.get("project") ?? undefined;
        const repo = url.searchParams.get("repo") ?? undefined;
        const scope = (url.searchParams.get("scope") as MemoryScope | null) ?? undefined;
        const config = readMemFlowConfig(configPath);
        const health = await service.health();
        const metrics = await service.metrics({
          days: Number(url.searchParams.get("days") ?? 30),
          limit: Number(url.searchParams.get("limit") ?? 200),
          project,
          repo,
          scope,
        });
        const stats = await service.stats();
        const aggregates = buildAggregates({ metrics, config, stats });
        const selfHealingIssues = buildSelfHealingIssues({ health, aggregates });
        const warnings = selfHealingIssues.map((issue) => issue.message);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ health, metrics, aggregates, warnings, selfHealingIssues }, null, 2));
        return;
      }

      if (url.pathname === "/api/channels") {
        const project = url.searchParams.get("project") ?? "global";
        const channel = url.searchParams.get("channel") ?? "all";
        const limit = Number(url.searchParams.get("limit") ?? 80);
        const feed = await buildChannelFeed(service, {
          channel,
          project,
          limit: Number.isFinite(limit) ? limit : 80,
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ project, channel: feed.channel, channels: feed.channels, messages: feed.messages }, null, 2));
        return;
      }

      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderPage(port));
        return;
      }

      // Serve static assets (logo, etc.)
      if (url.pathname.startsWith("/assets/")) {
        const rootDir = resolve(fileURLToPath(import.meta.url), "../../..");
        const filePath = resolve(rootDir, url.pathname.slice(1));
        if (existsSync(filePath) && filePath.startsWith(resolve(rootDir, "assets"))) {
          const ext = extname(filePath).toLowerCase();
          const mime: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
          res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.end(readFileSync(filePath));
          return;
        }
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  server.listen(port);
  return server;
}

function renderPage(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>MemFlow™ Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; background: #0b1220; color: #e6ecff; }
    .dash-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .dash-header-left h1 { margin: 0 0 4px 0; font-size: 22px; font-weight: 700; }
    .dash-header-left .subtitle { font-size: 12px; color: #6b7fa3; margin: 0; }
    .cpucoin-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: #0c1525; border: 1px solid #1f2b45; border-radius: 8px; font-size: 11px; color: #6b7fa3; white-space: nowrap; }
    .cpucoin-badge img { height: 20px; width: auto; filter: brightness(1.1); }
    .cpucoin-badge span { color: #9fb4ff; font-weight: 500; }
    h1 { margin: 0 0 4px 0; font-size: 22px; font-weight: 700; }
    h3 { margin: 0 0 10px 0; font-size: 14px; font-weight: 600; }
    .subtitle { font-size: 12px; color: #6b7fa3; margin-bottom: 16px; }
    .card { background: #111a2f; border: 1px solid #1f2b45; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .pill { display: inline-block; padding: 5px 10px; border-radius: 999px; font-size: 11px; border: 1px solid #2c3d61; }
    .ok { color: #7dffb3; border-color: #2e5b3f; background: #0f2618; }
    .bad { color: #ff9f9f; border-color: #5c2f2f; background: #2b1414; }
    .warn { color: #ffd27d; border-color: #5c4a2f; background: #2b2414; }
    pre { background: #0c1525; border: 1px solid #1f2b45; border-radius: 8px; padding: 12px; overflow: auto; font-size: 11px; }
    .stat { min-width: 110px; }
    .bar { height: 8px; border-radius: 4px; background: #18243c; overflow: hidden; }
    .bar span { display: block; height: 100%; background: linear-gradient(90deg, #7dffb3, #5cc2ff); border-radius: 4px; transition: width 0.4s ease; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 8px; text-align: left; font-size: 11px; }
    th { color: #9fb4ff; font-weight: 500; }
    tr:nth-child(odd) { background: #0c1525; }

    /* Hero savings section */
    .savings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .savings-card { background: linear-gradient(135deg, #0f1e3a 0%, #111a2f 100%); border: 1px solid #1f2b45; border-radius: 12px; padding: 20px; text-align: center; position: relative; overflow: hidden; transition: transform 0.2s, border-color 0.2s; }
    .savings-card:hover { transform: translateY(-2px); border-color: #3a5a8a; }
    .savings-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #7dffb3, #5cc2ff, #a78bfa); }
    .savings-period { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7fa3; font-weight: 600; margin-bottom: 8px; }
    .savings-value { font-size: 36px; font-weight: 700; background: linear-gradient(135deg, #7dffb3, #5cc2ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; line-height: 1.1; margin-bottom: 6px; }
    .savings-detail { font-size: 11px; color: #6b7fa3; }
    .savings-detail span { color: #9fb4ff; }

    /* Toggle controls */
    .controls { display: flex; gap: 6px; align-items: center; }
    .toggle-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid #2c3d61; background: transparent; color: #6b7fa3; cursor: pointer; font-size: 11px; font-family: inherit; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
    .toggle-btn:hover { border-color: #4a6a9a; color: #9fb4ff; }
    .toggle-btn.active { background: linear-gradient(135deg, #1a2d4f, #1a2a4a); color: #7dffb3; border-color: #2e5b3f; }

    /* User breakdown table */
    .user-row td:first-child { font-weight: 500; }
    .user-highlight { color: #7dffb3; }

    /* Activity section */
    .activity-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #1a2540; font-size: 12px; }
    .activity-item:last-child { border-bottom: none; }
    .activity-metric { color: #9fb4ff; font-weight: 500; }
    .activity-meta { color: #6b7fa3; font-size: 11px; }
    .activity-count { color: #7dffb3; font-weight: 600; font-size: 13px; }
    .channel-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
    .channel-select { background: #0c1525; color: #d8e3ff; border: 1px solid #2c3d61; border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 11px; white-space: nowrap; }
    .channel-item { display: grid; grid-template-columns: 88px 1fr 120px; gap: 10px; align-items: start; padding: 9px 0; border-bottom: 1px solid #1a2540; font-size: 12px; }
    .channel-item:last-child { border-bottom: none; }
    .channel-dir { display: inline-block; width: max-content; padding: 3px 7px; border-radius: 6px; border: 1px solid #2c3d61; color: #9fb4ff; font-size: 10px; font-weight: 600; text-transform: uppercase; white-space: nowrap; }
    .channel-dir.outbound { color: #7dffb3; border-color: #2e5b3f; background: #0f2618; }
    .channel-text { color: #e6ecff; line-height: 1.35; overflow-wrap: anywhere; }
    .channel-meta { color: #6b7fa3; font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .channel-time { color: #6b7fa3; font-size: 11px; text-align: right; white-space: nowrap; }
    .issue-list { display: grid; gap: 8px; }
    .issue-item { display: grid; grid-template-columns: 86px 1fr; gap: 10px; align-items: start; padding: 10px 0; border-bottom: 1px solid #1a2540; }
    .issue-item:last-child { border-bottom: none; }
    .issue-severity { display: inline-block; width: max-content; padding: 3px 7px; border-radius: 6px; border: 1px solid #5c4a2f; color: #ffd27d; background: #2b2414; font-size: 10px; font-weight: 600; text-transform: uppercase; white-space: nowrap; }
    .issue-severity.critical { color: #ff9f9f; border-color: #5c2f2f; background: #2b1414; }
    .issue-severity.info { color: #9fb4ff; border-color: #2c3d61; background: #0c1525; }
    .issue-title { color: #e6ecff; font-size: 12px; font-weight: 600; margin-bottom: 3px; }
    .issue-action { color: #6b7fa3; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }

    @media (max-width: 640px) { .savings-grid { grid-template-columns: 1fr; } .savings-value { font-size: 28px; } .channel-item { grid-template-columns: 72px 1fr; } .channel-time { grid-column: 2; text-align: left; } .issue-item { grid-template-columns: 1fr; gap: 5px; } }
  </style>
</head>
<body>
  <div class="dash-header">
    <div class="dash-header-left">
      <h1>MemFlow™ Dashboard</h1>
      <div class="subtitle">Shared memory layer · operational metrics · savings tracking</div>
    </div>
    <div class="cpucoin-badge">
      <img src="/assets/cpucoin-logo-dark.png" alt="CPUcoin" />
      <span>A CPUcoin project in StrataFlow™</span>
    </div>
  </div>
  <div class="card" id="savings">Loading savings…</div>
  <div class="card" id="users">Loading…</div>
  <div class="card" id="status">Loading…</div>
  <div class="card" id="warnings">Loading…</div>
  <div class="card" id="channels">Loading…</div>
  <div class="card" id="activity">Loading…</div>
  <div class="card" id="projects">Loading…</div>
  <div class="card" id="untracked">Loading…</div>
  <div class="card" id="timeline">Loading…</div>
  <script>
    let viewMode = 'individual';
    let channelProject = 'global';
    let channelName = 'all';

    function fmtTime(ms) {
      if (ms < 1000) return ms + 'ms';
      const s = ms / 1000;
      if (s < 60) return s.toFixed(1) + 's';
      const m = s / 60;
      if (m < 60) return m.toFixed(1) + 'm';
      return (m / 60).toFixed(1) + 'h';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    }

    async function fetchStatus(params = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch('/api/status' + (qs.toString() ? ('?' + qs.toString()) : ''));
      if (!res.ok) throw new Error('Status fetch failed');
      return res.json();
    }

    async function fetchChannels(params = {}) {
      const qs = new URLSearchParams(params);
      const res = await fetch('/api/channels' + (qs.toString() ? ('?' + qs.toString()) : ''));
      if (!res.ok) throw new Error('Channel fetch failed');
      return res.json();
    }

    function renderSavings(data) {
      const agg = data.aggregates ?? {};
      const sp = agg.savingsByPeriod ?? {};
      const us = agg.userSavings ?? [];
      const cu = agg.currentUser ?? 'unknown';
      const el = document.getElementById('savings');

      const periods = [
        { key: 'daily', icon: '☀️' },
        { key: 'weekly', icon: '📅' },
        { key: 'monthly', icon: '📊' },
      ];

      const cards = periods.map(p => {
        let d;
        if (viewMode === 'individual') {
          const me = us.find(u => u.user === cu);
          d = me ? me[p.key] : { label: sp[p.key]?.label ?? p.key, timeSavedMs: 0, tokensSaved: 0, events: 0, userCount: 1 };
        } else {
          d = sp[p.key] ?? { label: p.key, timeSavedMs: 0, tokensSaved: 0, events: 0, userCount: 0 };
        }
        const userLine = viewMode === 'group' ? ' · <span>' + d.userCount + ' user' + (d.userCount !== 1 ? 's' : '') + '</span>' : '';
        return '<div class="savings-card">'
          + '<div class="savings-period">' + p.icon + ' ' + (d.label || p.key) + '</div>'
          + '<div class="savings-value">' + fmtTime(d.timeSavedMs) + '</div>'
          + '<div class="savings-detail"><span>' + d.events + '</span> events · <span>' + d.tokensSaved + '</span> tokens' + userLine + '</div>'
          + '</div>';
      }).join('');

      const indClass = viewMode === 'individual' ? 'toggle-btn active' : 'toggle-btn';
      const grpClass = viewMode === 'group' ? 'toggle-btn active' : 'toggle-btn';

      el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'
        + '<h3 style="margin:0;">⚡ Time Savings</h3>'
        + '<div class="controls">'
        + '<button class="' + indClass + '" onclick="viewMode=\\'individual\\';refresh()">👤 Individual</button>'
        + '<button class="' + grpClass + '" onclick="viewMode=\\'group\\';refresh()">👥 Group</button>'
        + '</div></div>'
        + '<div class="savings-grid">' + cards + '</div>';
    }

    function renderUsers(data) {
      const agg = data.aggregates ?? {};
      const us = agg.userSavings ?? [];
      const cu = agg.currentUser ?? '';
      const el = document.getElementById('users');
      if (!us.length) { el.innerHTML = '<div class="pill">No user data</div>'; return; }
      const rows = us.map(u => {
        const isCurrent = u.user === cu;
        const cls = isCurrent ? ' class="user-highlight"' : '';
        return '<tr class="user-row"><td' + cls + '>' + u.user + (isCurrent ? ' (you)' : '') + '</td>'
          + '<td>' + fmtTime(u.daily.timeSavedMs) + '</td><td>' + u.daily.events + '</td>'
          + '<td>' + fmtTime(u.weekly.timeSavedMs) + '</td><td>' + u.weekly.events + '</td>'
          + '<td>' + fmtTime(u.monthly.timeSavedMs) + '</td><td>' + u.monthly.events + '</td></tr>';
      }).join('');
      el.innerHTML = '<h3>👥 Per-User Breakdown</h3>'
        + '<table><thead><tr><th>User</th><th>Today</th><th>Events</th><th>Week</th><th>Events</th><th>Month</th><th>Events</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>';
    }

    function renderStatus(data) {
      const health = data.health ?? {};
      const ok = health.ok ? 'ok' : 'bad';
      const el = document.getElementById('status');
      el.innerHTML = '<div class="row">'
        + '<div class="pill ' + ok + '">Connector: ' + (health.name ?? 'unknown') + ' (' + (health.ok ? 'On' : 'Off') + ')</div>'
        + '<div class="pill">Tracked: ' + (data.aggregates?.trackedProjects ?? 0) + '</div>'
        + '<div class="pill">Active: ' + (data.aggregates?.activeProjects ?? 0) + '</div>'
        + '</div>'
        + '<div style="margin-top:8px;font-size:11px;color:#6b7fa3;">' + (data.aggregates?.projects ?? []).map(p => p.name).join(' · ') + '</div>';
    }

    function renderWarnings(data) {
      const warnings = data.warnings ?? [];
      const el = document.getElementById('warnings');
      if (!warnings.length) { el.innerHTML = '<div class="pill ok">No issues detected</div>'; return; }
      const issues = data.selfHealingIssues ?? [];
      if (!issues.length) {
        el.innerHTML = warnings.map(w => '<div class="pill warn">' + escapeHtml(w) + '</div>').join(' ');
        return;
      }
      const rows = issues.map(issue => {
        const severity = escapeHtml(issue.severity ?? 'warning');
        return '<div class="issue-item">'
          + '<div><span class="issue-severity ' + severity + '">' + severity + '</span></div>'
          + '<div><div class="issue-title">' + escapeHtml(issue.message) + '</div>'
          + '<div class="issue-action">' + escapeHtml(issue.nextAction ?? 'Review MemFlow status and rerun the relevant setup command.') + '</div></div>'
          + '</div>';
      }).join('');
      el.innerHTML = '<h3>Self-Healing Issues</h3><div class="issue-list">' + rows + '</div>';
    }

    function renderChannels(data, channelData) {
      const projects = ['global', ...new Set((data.aggregates?.projects ?? []).map(p => p.name).filter(Boolean))];
      const projectOptions = projects.map(p => '<option value="' + escapeHtml(p) + '"' + (p === channelProject ? ' selected' : '') + '>' + escapeHtml(p === 'global' ? 'Global' : p) + '</option>').join('');
      const channels = channelData.channels ?? [];
      if (channelName !== 'all' && !channels.includes(channelName)) channelName = 'all';
      const channelOptions = ['all', ...channels].map(c => '<option value="' + escapeHtml(c) + '"' + (c === channelName ? ' selected' : '') + '>' + escapeHtml(c === 'all' ? 'All channels' : c) + '</option>').join('');
      const messages = channelData.messages ?? [];
      const rows = messages.map(m => {
        const dirClass = m.direction === 'outbound' ? 'channel-dir outbound' : 'channel-dir';
        const meta = [m.project, m.channel, m.status].filter(Boolean).join(' · ');
        const time = m.sentAt ? new Date(m.sentAt).toLocaleString() : '';
        return '<div class="channel-item">'
          + '<div><span class="' + dirClass + '">' + escapeHtml(m.direction) + '</span></div>'
          + '<div><div class="channel-text">' + escapeHtml(m.text) + '</div><div class="channel-meta">' + escapeHtml(meta) + '</div></div>'
          + '<div class="channel-time">' + escapeHtml(time) + '</div>'
          + '</div>';
      }).join('');
      document.getElementById('channels').innerHTML = '<div class="channel-toolbar">'
        + '<h3 style="margin:0;">Channels</h3>'
        + '<div class="controls">'
        + '<select class="channel-select" onchange="channelProject=this.value;channelName=\\'all\\';refresh()">'
        + projectOptions
        + '</select>'
        + '<select class="channel-select" onchange="channelName=this.value;refresh()">'
        + channelOptions
        + '</select>'
        + '</div>'
        + '</div>'
        + (rows || '<div class="pill">No channel traffic</div>');
    }

    function renderActivity(data) {
      const recent = (data.metrics?.recent ?? []).slice(0, 30);
      const el = document.getElementById('activity');
      if (!recent.length) { el.innerHTML = '<h3>Recent Activity</h3><div class="pill">No activity</div>'; return; }
      const items = recent.map(r => {
        const label = r.metric.replace(/_/g, ' ');
        const proj = r.project ?? r.repo ?? '';
        const user = r.user ?? '';
        const time = new Date(r.updatedAt).toLocaleDateString();
        return '<div class="activity-item">'
          + '<div><span class="activity-metric">' + label + '</span>'
          + (proj ? ' <span class="activity-meta">· ' + proj + '</span>' : '')
          + (user ? ' <span class="activity-meta">· ' + user + '</span>' : '')
          + '</div>'
          + '<div><span class="activity-count">×' + r.count + '</span> <span class="activity-meta">' + time + '</span></div>'
          + '</div>';
      }).join('');
      el.innerHTML = '<h3>📋 Recent Activity</h3>' + items;
    }

    function renderProjects(data) {
      const rows = (data.aggregates?.projects ?? []).map(p =>
        '<tr><td>' + p.name + '</td><td>' + (p.repo ?? '') + '</td><td>' + p.events + '</td>'
        + '<td>' + p.cacheHits + '</td><td>' + p.cacheMisses + '</td>'
        + '<td>' + p.checkpoints + '</td><td>' + p.compactions + '</td></tr>');
      document.getElementById('projects').innerHTML = '<h3>Per Project / Repo</h3>'
        + '<table><thead><tr><th>Project</th><th>Repo</th><th>Events</th><th>Hits</th><th>Miss</th><th>Checks</th><th>Compacts</th></tr></thead>'
        + '<tbody>' + rows.join('') + '</tbody></table>';
    }

    function renderTimeline(data) {
      const timeline = data.aggregates?.timeline ?? [];
      const el = document.getElementById('timeline');
      if (!timeline.length) { el.innerHTML = '<div class="pill">No timeline data</div>'; return; }
      const max = Math.max(...timeline.map(t => t.total || 0), 1);
      const rows = timeline.map(t => {
        const pct = Math.round((t.total || 0) / max * 100);
        return '<div style="margin:4px 0;"><div style="display:flex;justify-content:space-between;font-size:11px;"><span>' + t.day + '</span><span>' + t.total + '</span></div>'
          + '<div class="bar"><span style="width:' + pct + '%;"></span></div></div>';
      }).join('');
      el.innerHTML = '<h3>📈 Activity Timeline</h3>' + rows;
    }

    function renderUntracked(data) {
      const items = data.aggregates?.untrackedDetails ?? [];
      const el = document.getElementById('untracked');
      if (!items.length) { el.innerHTML = '<div class="pill ok">No untracked activity</div>'; return; }
      const rows = items.map(i =>
        '<tr><td>' + i.metric + '</td><td>' + i.count + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">' + i.key + '</td><td>' + i.updatedAt + '</td></tr>').join('');
      el.innerHTML = '<h3>Untracked Activity</h3>'
        + '<table><thead><tr><th>Metric</th><th>Count</th><th>Key</th><th>Updated</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>';
    }

    async function refresh() {
      try {
        const [data, channelData] = await Promise.all([
          fetchStatus(),
          fetchChannels({ project: channelProject, channel: channelName, limit: 80 })
        ]);
        renderSavings(data);
        renderUsers(data);
        renderStatus(data);
        renderWarnings(data);
        renderChannels(data, channelData);
        renderActivity(data);
        renderProjects(data);
        renderTimeline(data);
        renderUntracked(data);
      } catch (err) {
        document.getElementById('status').innerHTML = '<div class="pill bad">Error</div> ' + err.message;
      }
    }

    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

type ChannelFeedMessage = {
  channel: string;
  direction: "inbound" | "outbound";
  id: string;
  project: string;
  sentAt: string;
  status: string;
  text: string;
};

type ChannelFeed = {
  channel: string;
  channels: string[];
  messages: ChannelFeedMessage[];
};

async function buildChannelFeed(
  service: MemoryService,
  input: { channel: string; limit: number; project: string }
): Promise<ChannelFeed> {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const project = input.project || "global";
  const channel = channelFilter(input.channel);
  const [inbox, outbox] = await Promise.all([
    service.list({ namespace: "ag_bridge/inbox", includeExpired: true, limit: 200 }),
    service.list({ namespace: "ag_bridge/outbox", includeExpired: true, limit: 200 }),
  ]);

  const projectMessages = [...inbox.map((entry) => channelMessage(entry, "inbound")), ...outbox.map((entry) => channelMessage(entry, "outbound"))]
    .filter((message) => project === "global" || message.project === project);
  const channels = [...new Set(projectMessages.map((message) => message.channel))].sort();
  const messages = projectMessages
    .filter((message) => channel === "all" || message.channel === channel)
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, limit);

  return { channel, channels, messages };
}

function channelMessage(entry: MemoryEntry, direction: "inbound" | "outbound"): ChannelFeedMessage {
  const metadata = entry.metadata ?? {};
  const project =
    stringMetadata(metadata.project) ??
    entry.coordinates.project ??
    "global";
  return {
    channel: normalizeMobileChannel(metadata.channel),
    direction,
    id: entry.id,
    project,
    sentAt:
      stringMetadata(metadata.mobileTimestamp) ??
      stringMetadata(metadata.timestamp) ??
      entry.updatedAt ??
      entry.createdAt,
    status:
      stringMetadata(metadata.status) ??
      (entry.tags.includes("pending") ? "pending" : entry.tags.includes("unread") ? "unread" : "read"),
    text: mobileChannelPreview(entry.content),
  };
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function channelFilter(value: unknown): string {
  return typeof value === "string" && value.trim().toLowerCase() === "all"
    ? "all"
    : normalizeMobileChannel(value);
}

type AggregateProject = {
  name: string;
  repo?: string;
  scope?: string;
  events: number;
  cacheHits: number;
  cacheMisses: number;
  checkpoints: number;
  compactions: number;
  prepares: number;
  finalizes: number;
  lastUpdated?: string;
};

type PeriodSavings = {
  label: string;
  timeSavedMs: number;
  tokensSaved: number;
  events: number;
  userCount: number;
};

type UserSavings = {
  user: string;
  daily: PeriodSavings;
  weekly: PeriodSavings;
  monthly: PeriodSavings;
};

type Aggregates = {
  trackedProjects: number;
  activeProjects: number;
  inactiveProjects: number;
  projects: AggregateProject[];
  timeline: Array<{ day: string; total: number }>;
  totals: OperationalMetricsSnapshot["totals"];
  untrackedEvents: number;
  untrackedDetails: Array<{ metric: string; key: string; count: number; updatedAt: string }>;
  savingsByPeriod: { daily: PeriodSavings; weekly: PeriodSavings; monthly: PeriodSavings };
  userSavings: UserSavings[];
  currentUser: string;
};

function projectKey(project?: string, repo?: string): string {
  return [project ?? "", repo ?? ""].map((s) => (s ?? "").toLowerCase()).join("::");
}

function findTrackedMatch(
  tracked: Array<{ name: string; project?: string; repo?: string }>,
  project?: string | null,
  repo?: string | null
) {
  const projectLc = (project ?? "").toLowerCase();
  const repoLc = (repo ?? "").toLowerCase();
  return tracked.find((p) => {
    const names = [p.name, p.project, p.repo].map((v) => (v ?? "").toLowerCase());
    return names.includes(projectLc) || names.includes(repoLc);
  });
}

function buildAggregates(input: {
  metrics: OperationalMetricsSnapshot;
  config: MemFlowConfig;
  stats: MemoryStats;
}): Aggregates {
  const enabledTracked = (input.config.trackedProjects ?? []).filter((p) => p.enabled);
  const projectIndex = new Map<string, AggregateProject>();

  // Seed all enabled tracked projects so they show even before activity.
  for (const project of enabledTracked) {
    const key = projectKey(project.project ?? project.name, project.repo ?? project.name);
    if (projectIndex.has(key)) continue;
    projectIndex.set(key, {
      name: project.name,
      repo: project.repo,
      scope: "project",
      events: 0,
      cacheHits: 0,
      cacheMisses: 0,
      checkpoints: 0,
      compactions: 0,
      prepares: 0,
      finalizes: 0,
      lastUpdated: undefined,
    });
  }

  let untrackedEvents = 0;
  const untrackedDetails: Array<{ metric: string; key: string; count: number; updatedAt: string }> = [];

  for (const metric of input.metrics.recent) {
    const match = findTrackedMatch(enabledTracked, metric.project, metric.repo);
    const label = match?.name ?? metric.project ?? metric.repo ?? "untracked";
    const key = match ? projectKey(match.project ?? match.name, match.repo ?? match.name) : label;
    const existing =
      projectIndex.get(key) ??
      {
        name: label,
        repo: metric.repo,
        scope: metric.scope,
        events: 0,
        cacheHits: 0,
        cacheMisses: 0,
        checkpoints: 0,
        compactions: 0,
        prepares: 0,
        finalizes: 0,
        lastUpdated: metric.updatedAt,
      };

    existing.events += metric.count;
    if (metric.metric === "cache_hit") existing.cacheHits += metric.count;
    if (metric.metric === "cache_miss") existing.cacheMisses += metric.count;
    if (metric.metric === "checkpoint") existing.checkpoints += metric.count;
    if (metric.metric === "compaction") existing.compactions += metric.count;
    if (metric.metric === "agent_prepare") existing.prepares += metric.count;
    if (metric.metric === "agent_finalize") existing.finalizes += metric.count;
    existing.lastUpdated = metric.updatedAt;

    projectIndex.set(key, existing);

    if (!match) {
      untrackedEvents += metric.count;
      untrackedDetails.push({
        metric: metric.metric,
        key: metric.key,
        count: metric.count,
        updatedAt: metric.updatedAt,
      });
    }
  }

  const timelineMap = new Map<string, number>();
  for (const metric of input.metrics.recent) {
    const day = metric.updatedAt.slice(0, 10);
    timelineMap.set(day, (timelineMap.get(day) ?? 0) + metric.count);
  }

  const trackedProjects = input.config.trackedProjects?.length ?? 0;
  const activeProjects = Array.from(projectIndex.values()).filter((p) => (p.events ?? 0) > 0).length;
  const inactiveProjects = Math.max(trackedProjects - activeProjects, 0);

  // Period savings breakdown
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const estimate = input.metrics.estimate;
  const allRecent = input.metrics.recent;
  const totalEvents = allRecent.reduce((s, e) => s + e.count, 0) || 1;

  function periodSavings(label: string, cutoffMs: number): PeriodSavings {
    const entries = allRecent.filter((e) => Date.parse(e.updatedAt) >= cutoffMs);
    const events = entries.reduce((s, e) => s + e.count, 0);
    const ratio = events / totalEvents;
    const users = new Set(entries.map((e) => e.user).filter(Boolean));
    return {
      label,
      timeSavedMs: Math.round(Math.max(estimate.timeMs.net, 0) * ratio),
      tokensSaved: Math.round(Math.max(estimate.tokens.net, 0) * ratio),
      events,
      userCount: users.size || 1,
    };
  }

  const savingsByPeriod = {
    daily: periodSavings("Today", now - 1 * dayMs),
    weekly: periodSavings("This Week", now - 7 * dayMs),
    monthly: periodSavings("This Month", now - 30 * dayMs),
  };

  // Per-user savings
  const userEventsMap = new Map<string, { d: number; w: number; m: number }>();
  for (const entry of allRecent) {
    const user = entry.user ?? "unknown";
    const ts = Date.parse(entry.updatedAt);
    const existing = userEventsMap.get(user) ?? { d: 0, w: 0, m: 0 };
    if (ts >= now - 1 * dayMs) existing.d += entry.count;
    if (ts >= now - 7 * dayMs) existing.w += entry.count;
    if (ts >= now - 30 * dayMs) existing.m += entry.count;
    userEventsMap.set(user, existing);
  }

  function userPeriodSavings(label: string, events: number): PeriodSavings {
    const ratio = events / totalEvents;
    return {
      label,
      timeSavedMs: Math.round(Math.max(estimate.timeMs.net, 0) * ratio),
      tokensSaved: Math.round(Math.max(estimate.tokens.net, 0) * ratio),
      events,
      userCount: 1,
    };
  }

  const userSavings: UserSavings[] = Array.from(userEventsMap.entries())
    .map(([user, counts]) => ({
      user,
      daily: userPeriodSavings("Today", counts.d),
      weekly: userPeriodSavings("This Week", counts.w),
      monthly: userPeriodSavings("This Month", counts.m),
    }))
    .sort((a, b) => b.monthly.events - a.monthly.events);

  const currentUser = input.config.user ?? "unknown";

  return {
    trackedProjects,
    activeProjects,
    inactiveProjects,
    projects: Array.from(projectIndex.values()).sort((a, b) => (b.events || 0) - (a.events || 0)),
    timeline: Array.from(timelineMap.entries())
      .map(([day, total]) => ({ day, total }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    totals: input.metrics.totals,
    untrackedEvents,
    untrackedDetails: untrackedDetails.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 10),
    savingsByPeriod,
    userSavings,
    currentUser,
  };
}

function buildWarnings(input: { health: { ok?: boolean }; aggregates: Aggregates }): string[] {
  return buildSelfHealingIssues(input).map((issue) => issue.message);
}

export type SelfHealingIssue = {
  id: string;
  message: string;
  nextAction: string;
  severity: "critical" | "warning" | "info";
};

export function buildSelfHealingIssues(input: { health: { ok?: boolean }; aggregates: Aggregates }): SelfHealingIssue[] {
  const issues: SelfHealingIssue[] = [];
  if (!input.health.ok) {
    issues.push({
      id: "connector-unhealthy",
      message: "Connector offline or unhealthy",
      nextAction: "Run `memflow doctor`; then run `memflow restart` after fixing connector credentials or local storage access.",
      severity: "critical",
    });
  }
  if (input.aggregates.trackedProjects === 0) {
    issues.push({
      id: "no-tracked-projects",
      message: "No tracked projects configured",
      nextAction: "Run `memflow activate` or `memflow projects:add --path <repo>` in each workspace that should be self-healed.",
      severity: "warning",
    });
  }
  if (input.aggregates.activeProjects === 0) {
    issues.push({
      id: "no-recent-activity",
      message: "No recent activity in the last 7 days",
      nextAction: "Reload the host integration or run `memflow agent:prepare` and `memflow agent:finalize` from an active agent session.",
      severity: "warning",
    });
  }
  const totals = input.aggregates.totals ?? {};
  if ((totals.cache_hit ?? 0) === 0 && (totals.cache_miss ?? 0) > 0) {
    issues.push({
      id: "cache-misses-without-hits",
      message: "Cache misses are occurring but no cache hits yet",
      nextAction: "Let MemFlow store cache entries through `agent:finalize`, or seed known prompts with `memflow cache:store`.",
      severity: "info",
    });
  }
  if ((totals.compaction ?? 0) === 0) {
    issues.push({
      id: "no-compactions",
      message: "No compactions yet; enable automation or run `memflow compact`",
      nextAction: "Run `memflow start` to enable automation, or run `memflow compact --sessionId active` before long-session handoffs.",
      severity: "warning",
    });
  }
  if ((totals.checkpoint ?? 0) === 0) {
    issues.push({
      id: "no-checkpoints",
      message: "No checkpoints recorded; enable automation to capture session recoveries",
      nextAction: "Run `memflow checkpoint --sessionId active --goal \"...\" --summary \"...\"` or enable host automation.",
      severity: "warning",
    });
  }
  if ((input.aggregates.untrackedEvents ?? 0) > 0) {
    issues.push({
      id: "untracked-activity",
      message: "Some activity is untracked; run `memflow activate` inside each project",
      nextAction: "Open each project with untracked activity and run `memflow activate` so future fixes attach to the right project.",
      severity: "warning",
    });
  }
  return issues;
}
