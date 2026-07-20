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
