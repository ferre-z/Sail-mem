// Types
export * from './types/index.js';

// Database schema
export * from './db/schema.js';

// Configuration
export { configure, getConfig, resetConfig } from './config/index.js';
export type { Config } from './config/index.js';

// Database connection
export { getDb, closeConnection } from './db/connection.js';

// Core modules
export { MemoryStore } from './core/memory-store.js';
export type { MemoryStoreDeps } from './core/memory-store.js';
export { BankManager } from './core/bank-manager.js';
export type { BankManagerDeps } from './core/bank-manager.js';
export { ConsolidationEngine } from './core/consolidation.js';
export type { ConsolidationEngineDeps } from './core/consolidation.js';
export {
  OpinionEngine,
} from './core/opinion-engine.js';
export type {
  OpinionEngineDeps,
  FormOpinionInput,
  ContradictionResolution,
} from './core/opinion-engine.js';

// Retrieval
export { SearchEngine } from './retrieval/search-engine.js';
export type {
  SearchOptions,
  SearchResult,
  SearchEngineDeps,
} from './retrieval/search-engine.js';

// Embeddings
export { LocalEmbedder } from './embeddings/local.js';
export { CloudEmbedder } from './embeddings/cloud.js';
export type { EmbeddingProvider } from './embeddings/embedder.js';

// Knowledge Graph
export { KnowledgeGraph } from './graph/knowledge-graph.js';
export type {
  Entity,
  Relationship,
  ConnectedEntity,
  KnowledgeGraphDeps,
} from './graph/knowledge-graph.js';

// Sync
export { GitHubSync } from './sync/github-sync.js';
export type { GitHubSyncDeps } from './sync/github-sync.js';
export { createSnapshot, validateSnapshot } from './sync/snapshot.js';
export type { MemorySnapshot } from './sync/snapshot.js';

// Errors
export {
  SailMemError,
  ValidationError,
  StorageError,
  EmbeddingError,
  SyncError,
  NotFoundError,
} from './errors.js';

// Decay (Ebbinghaus / FSRS-flavoured scoring)
export {
  ebbinghausRetention,
  applyAccessBoost,
  calculateMemoryScore,
  classifyMemoryType,
  scoreBatch,
  DEFAULT_DECAY_RATES,
  DEFAULT_ACCESS_BOOST_CAP,
  ACCESS_BOOST_FACTOR,
} from './core/decay.js';
export type { DecayResult } from './core/decay.js';

// Privacy filter
export { stripSecrets, stripSecretsWithTrace, SECRET_PATTERNS } from './capture/privacy-filter.js';
export type { StripResult } from './capture/privacy-filter.js';

// Auto-capture hooks
export type {
  SessionHooks,
  SessionContext,
  ToolContext,
  PromptContext,
  ResponseContext,
  ToolResult,
} from './capture/hooks.js';
export { MemoryCapturer } from './capture/memory-capturer.js';
export type {
  MemoryCapturerOptions,
  CaptureFilter,
} from './capture/memory-capturer.js';

// Auto-consolidation scheduler
export { ConsolidationScheduler } from './core/consolidation-scheduler.js';
export type {
  SchedulerOptions,
  CycleResult,
} from './core/consolidation-scheduler.js';

// Mental models
export { MentalModelEngine } from './core/mental-model.js';
export type {
  MentalModelRecord,
  CreateMentalModelInput,
  MentalModelEngineDeps,
} from './core/mental-model.js';

// Entity resolution
export { EntityResolver } from './core/entity-resolver.js';
export type {
  ResolvedEntityMatch,
  EntityResolverDeps,
} from './core/entity-resolver.js';

// Contradiction detection
export { ContradictionDetector } from './core/contradiction-detector.js';
export type { Contradiction, ContradictionDeps } from './core/contradiction-detector.js';

// MCP server (industry-standard agent tool surface)
export {
  SailMemMcpServer,
  createMcpServer,
  VALID_MEMORY_TYPES,
  VALID_RECENT,
} from './mcp/server.js';
export type { McpServerOptions } from './mcp/server.js';

// Storage
export type {
  IStorage,
  StorageProvider,
  ScoredMemory,
  SemanticSearchOptions,
  FullTextSearchOptions,
  MemoryStat,
  EntityRecord,
  RelationshipRecord,
  CreateEntityInput,
  CreateRelationshipInput,
} from './storage/types.js';
export { SQLiteStorage } from './storage/sqlite.js';
export { PostgresStorage } from './storage/postgres.js';
export type { PostgresStorageDeps, DrizzleDB } from './storage/postgres.js';
export {
  createStorage,
  closeStorage,
  resetStorageCache,
} from './storage/factory.js';
export type { StorageFactoryOptions } from './storage/factory.js';
