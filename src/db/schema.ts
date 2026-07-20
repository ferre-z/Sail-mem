import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  real,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Memory types enum
export const memoryTypeEnum = [
  'world_fact',
  'experience_fact',
  'observation',
  'mental_model',
  'opinion',
] as const;
export type MemoryType = (typeof memoryTypeEnum)[number];

// Bank hierarchy levels
export const bankLevelEnum = ['global', 'user', 'project', 'thread'] as const;
export type BankLevel = (typeof bankLevelEnum)[number];

// Types for JSON columns
export interface BankConfig {
  mission?: string;
  directives?: string[];
  disposition?: Record<string, number>;
  retentionDays?: number;
  maxMemories?: number;
}

export interface MemoryMetadata {
  tags?: string[];
  source?: string;
  confidence?: number;
  temporalContext?: {
    timestamp?: Date;
    relativeTime?: string;
    duration?: string;
  };
  consolidatedFrom?: string[];
  evidence?: Array<{ memoryId: string; quote: string }>;
  /** opinion-specific */
  targetEntity?: string;
  evidenceIds?: string[];
  contradictingIds?: string[];
  lastUpdated?: Date;
  /** auto-capture metadata */
  sessionId?: string;
  /** mental-model refresh timestamp */
  lastRefreshedAt?: Date;
  /** mental-model source query */
  sourceQuery?: string;
  /** tiered-consolidation tier: working|episodic|semantic|procedural|archived-* */
  tier?: string;
  /** tier transitions */
  archivedAt?: Date;
  /** procedural detection metadata */
  occurrences?: number;
  toolSequence?: string[];
  /** consolidation freshness */
  freshness?: 'new' | 'strengthening' | 'stable' | 'weakening' | 'stale';
  evidenceCount?: number;
}

// Memory banks with hierarchical structure
export const banks = pgTable(
  'banks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    level: text('level', { enum: bankLevelEnum }).notNull(),
    parentId: uuid('parent_id'),
    config: jsonb('config').$type<BankConfig>().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('banks_level_idx').on(table.level),
    index('banks_parent_idx').on(table.parentId),
    uniqueIndex('banks_name_parent_idx').on(table.name, table.parentId),
  ]
);

// Core memories table
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bankId: uuid('bank_id')
      .notNull()
      .references(() => banks.id),
    type: text('type', { enum: memoryTypeEnum }).notNull(),
    content: text('content').notNull(),
    embedding: jsonb('embedding').$type<number[]>(),
    metadata: jsonb('metadata').$type<MemoryMetadata>().default({}),
    sourceId: text('source_id'),
    parentId: uuid('parent_id'),
    confidence: real('confidence').default(1.0),
    accessCount: integer('access_count').default(0),
    lastAccessedAt: timestamp('last_accessed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    index('memories_bank_idx').on(table.bankId),
    index('memories_type_idx').on(table.type),
    index('memories_source_idx').on(table.sourceId),
    index('memories_parent_idx').on(table.parentId),
    index('memories_created_idx').on(table.createdAt),
  ]
);

// Entities for knowledge graph
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bankId: uuid('bank_id')
      .notNull()
      .references(() => banks.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().default({}),
    embedding: jsonb('embedding').$type<number[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('entities_bank_idx').on(table.bankId),
    index('entities_type_idx').on(table.type),
    uniqueIndex('entities_name_bank_idx').on(table.name, table.bankId),
  ]
);

// Relationships between entities
export const relationships = pgTable(
  'relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => entities.id),
    targetId: uuid('target_id')
      .notNull()
      .references(() => entities.id),
    type: text('type').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().default({}),
    weight: real('weight').default(1.0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('relationships_source_idx').on(table.sourceId),
    index('relationships_target_idx').on(table.targetId),
    index('relationships_type_idx').on(table.type),
  ]
);

// Memory to entity links
export const memoryEntities = pgTable(
  'memory_entities',
  {
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('memory_entities_unique').on(table.memoryId, table.entityId)]
);

// Observation consolidation tracking
export const consolidations = pgTable('consolidations', {
  id: uuid('id').primaryKey().defaultRandom(),
  observationId: uuid('observation_id')
    .notNull()
    .references(() => memories.id),
  sourceMemoryIds: jsonb('source_memory_ids').$type<string[]>().notNull(),
  evidenceCount: integer('evidence_count').default(1),
  lastConsolidatedAt: timestamp('last_consolidated_at').defaultNow().notNull(),
});
