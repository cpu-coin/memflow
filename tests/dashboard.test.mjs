import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSelfHealingIssues } from "../dist/core/dashboard.js";

function aggregates(overrides = {}) {
  return {
    trackedProjects: 1,
    activeProjects: 1,
    inactiveProjects: 0,
    projects: [],
    timeline: [],
    totals: {
      cache_hit: 1,
      cache_miss: 0,
      checkpoint: 1,
      compaction: 1,
    },
    untrackedEvents: 0,
    untrackedDetails: [],
    savingsByPeriod: {
      daily: { label: "Today", timeSavedMs: 0, tokensSaved: 0, events: 0, userCount: 1 },
      weekly: { label: "This Week", timeSavedMs: 0, tokensSaved: 0, events: 0, userCount: 1 },
      monthly: { label: "This Month", timeSavedMs: 0, tokensSaved: 0, events: 0, userCount: 1 },
    },
    userSavings: [],
    currentUser: "test",
    ...overrides,
  };
}

test("buildSelfHealingIssues returns no issues for a healthy dashboard state", () => {
  const issues = buildSelfHealingIssues({
    health: { ok: true },
    aggregates: aggregates(),
  });

  assert.deepEqual(issues, []);
});

test("buildSelfHealingIssues returns actionable issues for unhealthy setup signals", () => {
  const issues = buildSelfHealingIssues({
    health: { ok: false },
    aggregates: aggregates({
      trackedProjects: 0,
      activeProjects: 0,
      totals: {
        cache_hit: 0,
        cache_miss: 3,
        checkpoint: 0,
        compaction: 0,
      },
      untrackedEvents: 2,
    }),
  });

  assert.deepEqual(
    issues.map((issue) => issue.id),
    [
      "connector-unhealthy",
      "no-tracked-projects",
      "no-recent-activity",
      "cache-misses-without-hits",
      "no-compactions",
      "no-checkpoints",
      "untracked-activity",
    ]
  );
  assert.equal(issues[0].severity, "critical");
  assert.ok(issues.every((issue) => issue.nextAction.length > 0));
});
