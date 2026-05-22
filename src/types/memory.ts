export type MemoryKind =
  | "cache"
  | "knowledge"
  | "pattern"
  | "persona"
  | "snippet"
  | "rag"
  | "session"
  | "workflow";

export type MemoryScope =
  | "project"
  | "repo"
  | "session"
  | "team"
  | "user"
  | "workspace";

export type MemorySource =
  | "agent"
  | "bundle-import"
  | "connector"
  | "manual"
  | "system";

export type ConnectorKind = "embedded" | "mongodb" | "sqlite";
export type MemorySyncTarget = "both" | "local" | "shared";
export type MemFlowHostName = "antigravity" | "chatgpt" | "claude-code" | "codex" | "vscode";

export const MEMFLOW_SCHEMA_VERSION = 1;
export const MEMFLOW_EMBEDDING_VERSION_NONE = "none";

export interface MemoryCoordinates {
  namespace: string;
  project?: string;
  repo?: string;
  scope: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
}

export interface MemoryProvenance {
  actorId?: string;
  connector?: string;
  importedFrom?: string;
  sessionId?: string;
  source: MemorySource;
}

export interface MemoryEmbedding {
  dimensions: number;
  model?: string;
  values: number[];
}

export interface MemoryEntry {
  id: string;
  key: string;
  title: string;
  content: string;
  namespace: string;
  projectId?: string;
  coordinates: MemoryCoordinates;
  kind: MemoryKind;
  tags: string[];
  metadata: Record<string, unknown>;
  cacheControl?: { type: "ephemeral" }; // Provider-agnostic hint for caching
  source: string;
  provenance: MemoryProvenance;
  confidence?: number;
  embedding?: MemoryEmbedding;
  schemaVersion: number;
  embeddingVersion: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastVerifiedAt?: string;
  version: number;
}

export interface MemoryWriteInput {
  key: string;
  title?: string;
  content: string;
  coordinates: MemoryCoordinates;
  kind?: MemoryKind;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  provenance: MemoryProvenance;
  confidence?: number;
  embedding?: MemoryEmbedding;
  embeddingVersion?: string;
  expiresAt?: string;
  lastVerifiedAt?: string;
}

export interface MemoryUpdateInput {
  title?: string;
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  confidence?: number;
  embedding?: MemoryEmbedding;
  embeddingVersion?: string | null;
  expiresAt?: string | null;
  lastVerifiedAt?: string | null;
}

export interface MemoryQuery {
  text?: string;
  key?: string;
  namespace?: string;
  project?: string;
  repo?: string;
  scope?: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
  kind?: MemoryKind;
  tags?: string[];
  limit?: number;
  offset?: number;
  threshold?: number;
  includeExpired?: boolean;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface EmbeddingBackfillResult {
  scanned: number;
  updated: number;
}

export interface MemoryDeleteResult {
  deleted: boolean;
  id?: string;
}

export interface MemoryStats {
  connector: string;
  entries: number;
  namespaces: number;
  projects: number;
  staleEntries: number;
}

export interface OperationalMetricsQuery {
  project?: string;
  repo?: string;
  scope?: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
  days?: number;
  limit?: number;
}

export interface OperationalMetricEntry {
  count: number;
  key: string;
  metric: string;
  project?: string;
  repo?: string;
  scope: MemoryScope;
  updatedAt: string;
  user?: string;
}

export interface OperationalMetricsSnapshot {
  estimate: OperationalSavingsEstimate;
  generatedAt: string;
  recent: OperationalMetricEntry[];
  totals: Record<string, number>;
}

export interface OperationalSavingsEstimate {
  assumptions: {
    averageTokensPerCharacter: number;
    cacheHitTokenFraction: number;
    cacheLookupMs: number;
    cacheWriteMultiplier: number;
    modelRoundTripMs: number;
    patternRecallMs: number;
    profileLoadMs: number;
    sessionResumeMs: number;
    transcriptItemTokens: number;
    workflowRecallMs: number;
  };
  observed: {
    automaticCacheEntries: number;
    cacheHits: number;
    cacheMisses: number;
    cacheStores: number;
    compactedResumeHits: number;
    compactedSessionEntries: number;
    sessionResumeHits: number;
    sharedReusableEntries: number;
    patternRecalls: number;
    patternPromotions: number;
    profileLoads: number;
    workflowRecalls: number;
  };
  projected: {
    additionalCollaboratorNetTimeMs: number;
    additionalCollaboratorNetTokens: number;
  };
  timeMs: {
    cacheHitSaved: number;
    compactionSaved: number;
    sessionResumeSaved: number;
    patternRecallSaved: number;
    profileLoadSaved: number;
    workflowRecallSaved: number;
    initialExtra: number;
    net: number;
  };
  tokens: {
    cacheHitSaved: number;
    compactionSaved: number;
    initialExtra: number;
    net: number;
  };
}

export interface MemFlowHostBootstrap {
  automation: MemFlowAutomationConfig;
  configPath: string;
  databasePath: string;
  generatedAt: string;
  lifecycle: {
    finalizeCommand: string;
    mcpCommand: string;
    prepareCommand: string;
  };
  monitoring: {
    metricsCommand: string;
    savingsCommand: string;
    statusCommand: string;
  };
  paths: {
    cli: string;
    hostBootstrap: string;
    mcp: string;
  };
  trackedProjects: Array<{
    enabled: boolean;
    name: string;
    path: string;
    project: string;
    repo: string;
  }>;
}

export interface MemFlowHostIntegration {
  branding?: {
    fullLogo?: string;
    icon: string;
  };
  files: string[];
  generatedAt: string;
  host: MemFlowHostName;
  instructions: string[];
  mcpServers: Record<string, {
    args?: string[];
    command?: string;
    headers?: Record<string, string>;
    icon?: string;
    url?: string;
    type?: string;
  }>;
  monitoring: MemFlowHostBootstrap["monitoring"];
  reviewTargets: string[];
  runtime?: {
    bridgeCommand?: string;
    finalizeCommand?: string;
    prepareCommand?: string;
  };
}

export interface HostInstallationResult {
  actions: string[];
  applied: boolean;
  generated: MemFlowHostIntegration;
  host: MemFlowHostName;
  mode: "automatic" | "generated-only" | "partial";
  notes: string[];
  targets: string[];
  validation: HostValidationResult;
}

export interface HostValidationResult {
  checks: Array<{
    message: string;
    ok: boolean;
    path?: string;
  }>;
  host: MemFlowHostName;
  ok: boolean;
}

export interface MemoryExportBundle {
  exportedAt: string;
  exportedBy?: string;
  formatVersion: "1";
  entries: MemoryEntry[];
}

export interface MemoryImportResult {
  imported: number;
  skipped: number;
  updated: number;
  conflicts: MemoryMergeConflict[];
}

export interface MemoryDiffResult {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface MemoryMergeConflict {
  existingId: string;
  incomingId: string;
  key: string;
  namespace: string;
  reason: "content-conflict" | "incoming-newer" | "local-newer";
  resolution: "kept-existing" | "used-incoming";
}

export interface ProfileBlockInput {
  name: string;
  title?: string;
  content: string;
  coordinates: MemoryCoordinates;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  confidence?: number;
  lastVerifiedAt?: string;
}

export interface ProfileQuery {
  project?: string;
  repo?: string;
  scope?: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
  limit?: number;
}

export interface SessionCheckpointInput {
  sessionId?: string;
  title?: string;
  goal: string;
  summary?: string;
  nextStep?: string;
  status?: "active" | "blocked" | "completed";
  coordinates: MemoryCoordinates;
  branch?: string;
  files?: string[];
  blockers?: string[];
  decisions?: string[];
  todos?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface SessionResumeQuery {
  sessionId?: string;
  project?: string;
  repo?: string;
  scope?: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
  limit?: number;
}

export interface SessionResumeResult {
  checkpoint: MemoryEntry | null;
  compacted: MemoryEntry | null;
}

export interface SessionCompactionInput {
  sessionId?: string;
  coordinates: MemoryCoordinates;
  goal?: string;
  summary?: string;
  transcript?: string[];
  decisions?: string[];
  blockers?: string[];
  nextStep?: string;
  activeFiles?: string[];
  activeTodos?: string[];
  invalidatedAssumptions?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface SessionCompactionResult {
  checkpoint: MemoryEntry;
  compacted: MemoryEntry;
}

export interface AgentMemoryPrepareInput {
  coordinates: MemoryCoordinates;
  sessionId?: string;
  goal?: string;
  prompt?: string;
  task?: string;
  supplier?: "claude" | "openai" | "generic";
  profileLimit?: number;
  patternLimit?: number;
  cacheLimit?: number;
}

export interface AgentMemoryPrepareResult {
  actions: string[];
  cache: MemoryEntry | null;
  checkpoint: MemoryEntry | null;
  compacted: MemoryEntry | null;
  patterns: MemoryEntry[];
  profiles: MemoryEntry[];
  workflows: MemoryEntry[];
}

export interface AgentMemoryFinalizeInput {
  coordinates: MemoryCoordinates;
  sessionId?: string;
  goal: string;
  summary?: string;
  nextStep?: string;
  status?: "active" | "blocked" | "completed";
  prompt?: string;
  task?: string;
  output?: string;
  branch?: string;
  files?: string[];
  blockers?: string[];
  decisions?: string[];
  todos?: string[];
  activeFiles?: string[];
  activeTodos?: string[];
  invalidatedAssumptions?: string[];
  transcript?: string[];
  compact?: boolean;
  storeCache?: boolean;
  cacheMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface AgentMemoryFinalizeResult {
  actions: string[];
  cache: MemoryEntry | null;
  checkpoint: MemoryEntry;
  compacted: MemoryEntry | null;
}

export interface PatternPromotionInput {
  title: string;
  failure: string;
  rootCause: string;
  safeFix: string;
  detection?: string;
  coordinates: MemoryCoordinates;
  tags?: string[];
  confidence?: number;
  lastVerifiedAt?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface MemorySyncPolicy {
  name: string;
  defaultTarget: MemorySyncTarget;
  kindTargets?: Partial<Record<MemoryKind, MemorySyncTarget>>;
  scopeTargets?: Partial<Record<MemoryScope, MemorySyncTarget>>;
}

export interface MemorySyncPlanDecision {
  id: string;
  key: string;
  kind: MemoryKind;
  namespace: string;
  scope: MemoryScope;
  target: MemorySyncTarget;
  reason: string;
}

export interface MemorySyncPlanResult {
  policy: MemorySyncPolicy;
  total: number;
  local: number;
  shared: number;
  both: number;
  decisions: MemorySyncPlanDecision[];
}

export interface MemFlowInitInput {
  project?: string;
  repo?: string;
  tenant?: string;
  user?: string;
  workspace?: string;
  actorId?: string;
  source?: string;
}

export interface MemFlowInitResult {
  entries: MemoryEntry[];
  syncPolicy: MemorySyncPolicy;
}

export interface MemFlowTrackedProject {
  enabled: boolean;
  name: string;
  path: string;
  project: string;
  repo: string;
  addedAt: string;
  updatedAt: string;
}

export interface MemFlowAutomationConfig {
  autoCompact: boolean;
  autoFinalize: boolean;
  autoPrepare: boolean;
  autoPromptCache: boolean;
  enabled: boolean;
  metrics: boolean;
}

export interface MemFlowMongoConfig {
  uri?: string;
  database?: string;
  collection?: string;
  connectTimeoutMs?: number;
  maxPoolSize?: number;
  minPoolSize?: number;
  socketTimeoutMS?: number;
  waitQueueTimeoutMS?: number;
  moduleSearchPaths?: string[];
}

export interface SecuritySweepConfig {
  enabled: boolean;
  level: "block" | "redact" | "warn";
  rules?: {
    privateKeys?: boolean;
    apiKeys?: boolean;
    databaseUris?: boolean;
    pii?: boolean;
  };
  customPatterns?: Array<{ name: string; regex: string }>;
  trustedNamespaces?: string[];
}

export interface MemFlowConfig {
  version: "1";
  profile?: string;
  activation?: {
    activationSessionId?: string;
    completedHosts: Array<MemFlowHostName>;
    lastUpdatedAt: string;
    pendingHosts: Array<MemFlowHostName>;
    shellPending: boolean;
  };
  automation: MemFlowAutomationConfig;
  connector: "embedded" | "mongodb" | "sqlite";
  databasePath: string;
  mongo?: MemFlowMongoConfig;
  enabledHosts?: Array<MemFlowHostName>;
  onboarding?: {
    completedAt?: string;
    lastPromptedAt?: string;
  };
  projectsRoot?: string;
  trackedProjects: MemFlowTrackedProject[];
  tenant?: string;
  user?: string;
  workspace?: string;
  securitySweep?: SecuritySweepConfig;
}


export interface PromptCacheStoreInput {
  key: string;
  title?: string;
  content: string;
  coordinates: MemoryCoordinates;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  embeddingVersion?: string;
  schemaVersion?: number;
  confidence?: number;
}

export interface PromptCacheQuery {
  key?: string;
  text?: string;
  coordinates: Partial<MemoryCoordinates> & Pick<MemoryCoordinates, "namespace">;
  limit?: number;
}

export interface PromptCacheAutoKeyInput {
  prompt: string;
  coordinates: Partial<MemoryCoordinates> & Pick<MemoryCoordinates, "namespace">;
  task?: string;
  schemaVersion?: number;
  embeddingVersion?: string;
}

export interface PromptCacheAutoGetInput extends PromptCacheAutoKeyInput {
  limit?: number;
}

export interface PromptCacheAutoStoreInput extends PromptCacheAutoKeyInput {
  content: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  source?: string;
  tags?: string[];
  title?: string;
}

export interface PromptCacheInvalidateInput {
  namespace: string;
  project?: string;
  repo?: string;
  scope?: MemoryScope;
  tenant?: string;
  user?: string;
  workspace?: string;
  schemaVersion?: number;
  embeddingVersion?: string;
}

export interface PromptCacheInvalidateResult {
  deleted: number;
  ids: string[];
}

export interface MemFlowStatusResult {
  on: boolean;
  automation: MemFlowAutomationConfig & {
    activeRecent: boolean;
    lastActivityAt?: string;
  };
  connector: {
    kind: ConnectorKind;
    name: string;
    ok: boolean;
    details?: Record<string, unknown>;
  };
  integration: {
    configured: boolean;
    hosts: Array<MemFlowHostName>;
  };
  local: {
    configured: boolean;
    databasePath: string;
  };
  shared: {
    configured: boolean;
    connector: "embedded" | "mongodb" | "sqlite";
  };
  tracking: {
    total: number;
    enabled: number;
    disabled: number;
    currentProject?: {
      enabled: boolean;
      name: string;
      path: string;
      project: string;
      repo: string;
    };
  };
}
