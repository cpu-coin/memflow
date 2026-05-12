import type {
  MemoryEntry,
  OperationalSavingsEstimate,
} from "../types/memory.js";

const DEFAULT_ASSUMPTIONS = {
  averageTokensPerCharacter: 0.25,
  cacheHitTokenFraction: 0.15,
  cacheLookupMs: 350,
  cacheWriteMultiplier: 1.25,
  modelRoundTripMs: 12000,
  patternRecallMs: 30000,    // ~30s saved per pattern recall (avoids retry cycle)
  profileLoadMs: 3000,       // ~3s saved per profile injection (reduces prompt engineering)
  sessionResumeMs: 8000,     // ~8s saved per session resume (avoids re-orientation)
  transcriptItemTokens: 120,
  workflowRecallMs: 10000,   // ~10s saved per workflow recall (prevents re-discovery)
} as const;

export function buildOperationalSavingsEstimate(input: {
  cacheEntries: MemoryEntry[];
  compactedEntries: MemoryEntry[];
  sharedReusableEntries: number;
  totals: Record<string, number>;
}): OperationalSavingsEstimate {
  const cacheBaselines = input.cacheEntries.map((entry) => estimateEntryTokens(entry));
  const compactedSavings = input.compactedEntries.map((entry) =>
    estimateCompactionSavedTokens(entry, DEFAULT_ASSUMPTIONS.transcriptItemTokens)
  );

  const averageCacheTokens = average(cacheBaselines);
  const initialExtraTokens = round(
    cacheBaselines.reduce(
      (sum, tokens) => sum + tokens * (DEFAULT_ASSUMPTIONS.cacheWriteMultiplier - 1),
      0
    )
  );
  const cacheHitSavedTokens = round(
    (input.totals.cache_hit ?? 0) *
      averageCacheTokens *
      (1 - DEFAULT_ASSUMPTIONS.cacheHitTokenFraction)
  );
  const compactionSavedTokens = round(
    (input.totals.compacted_resume_hit ?? 0) * average(compactedSavings)
  );
  const netTokens = cacheHitSavedTokens + compactionSavedTokens - initialExtraTokens;

  const initialExtraTimeMs = round(
    (input.cacheEntries.length ?? 0) *
      DEFAULT_ASSUMPTIONS.modelRoundTripMs *
      (DEFAULT_ASSUMPTIONS.cacheWriteMultiplier - 1)
  );
  const cacheHitSavedTimeMs = round(
    (input.totals.cache_hit ?? 0) *
      (DEFAULT_ASSUMPTIONS.modelRoundTripMs - DEFAULT_ASSUMPTIONS.cacheLookupMs)
  );
  const compactionSavedTimeMs = round(
    (input.totals.compacted_resume_hit ?? 0) *
      Math.max(DEFAULT_ASSUMPTIONS.modelRoundTripMs * 0.35, 1000)
  );

  // Session resume (checkpoint-only) — avoids re-orientation overhead
  const sessionResumeSavedTimeMs = round(
    (input.totals.session_resume_hit ?? 0) *
      DEFAULT_ASSUMPTIONS.sessionResumeMs
  );

  // Pattern recall — each recalled pattern avoids a retry cycle
  const patternRecallSavedTimeMs = round(
    (input.totals.pattern_recall ?? 0) *
      DEFAULT_ASSUMPTIONS.patternRecallMs
  );

  // Profile load — pre-loaded personas reduce prompt engineering
  const profileLoadSavedTimeMs = round(
    (input.totals.profile_load ?? 0) *
      DEFAULT_ASSUMPTIONS.profileLoadMs
  );

  // Workflow recall — pre-loaded workflows prevent re-discovery
  const workflowRecallSavedTimeMs = round(
    (input.totals.workflow_recall ?? 0) *
      DEFAULT_ASSUMPTIONS.workflowRecallMs
  );

  const netTimeMs =
    cacheHitSavedTimeMs + compactionSavedTimeMs +
    sessionResumeSavedTimeMs + patternRecallSavedTimeMs +
    profileLoadSavedTimeMs + workflowRecallSavedTimeMs -
    initialExtraTimeMs;

  const sharedProjectionFactor = input.sharedReusableEntries > 0 ? 1 : 0;

  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    observed: {
      automaticCacheEntries: input.cacheEntries.length,
      cacheHits: input.totals.cache_hit ?? 0,
      cacheMisses: input.totals.cache_miss ?? 0,
      cacheStores: input.totals.cache_store ?? 0,
      compactedResumeHits: input.totals.compacted_resume_hit ?? 0,
      compactedSessionEntries: input.compactedEntries.length,
      sessionResumeHits: input.totals.session_resume_hit ?? 0,
      sharedReusableEntries: input.sharedReusableEntries,
      patternRecalls: input.totals.pattern_recall ?? 0,
      patternPromotions: input.totals.pattern_promote ?? 0,
      profileLoads: input.totals.profile_load ?? 0,
      workflowRecalls: input.totals.workflow_recall ?? 0,
    },
    projected: {
      additionalCollaboratorNetTimeMs: round(Math.max(netTimeMs, 0) * sharedProjectionFactor),
      additionalCollaboratorNetTokens: round(Math.max(netTokens, 0) * sharedProjectionFactor),
    },
    timeMs: {
      cacheHitSaved: cacheHitSavedTimeMs,
      compactionSaved: compactionSavedTimeMs,
      sessionResumeSaved: sessionResumeSavedTimeMs,
      patternRecallSaved: patternRecallSavedTimeMs,
      profileLoadSaved: profileLoadSavedTimeMs,
      workflowRecallSaved: workflowRecallSavedTimeMs,
      initialExtra: initialExtraTimeMs,
      net: netTimeMs,
    },
    tokens: {
      cacheHitSaved: cacheHitSavedTokens,
      compactionSaved: compactionSavedTokens,
      initialExtra: initialExtraTokens,
      net: netTokens,
    },
  };
}

function estimateEntryTokens(entry: MemoryEntry): number {
  const promptChars =
    typeof entry.metadata.promptChars === "number"
      ? entry.metadata.promptChars
      : typeof entry.metadata.prompt === "string"
        ? entry.metadata.prompt.length
        : 0;
  const outputChars = entry.content.length;

  return round((promptChars + outputChars) * DEFAULT_ASSUMPTIONS.averageTokensPerCharacter);
}

function estimateCompactionSavedTokens(entry: MemoryEntry, transcriptItemTokens: number): number {
  const transcriptItems = Number(entry.metadata.transcriptItems ?? 0);
  const compactedTokens = round(entry.content.length * DEFAULT_ASSUMPTIONS.averageTokensPerCharacter);
  const rawTokens = transcriptItems * transcriptItemTokens;

  return Math.max(rawTokens - compactedTokens, 0);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value);
}
