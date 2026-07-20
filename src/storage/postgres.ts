import {
  eq,
  and,
  desc,
  sql,
} from 'drizzle-orm';
import {
  memories as memoriesTable,
  banks as banksTable,
  entities as entitiesTable,
  relationships as relationshipsTable,
  memoryEntities as memoryEntitiesTable,
} from '../db/schema.js';
import type {
  IStorage,
  CreateMemoryInput,
  Memory,
  CreateBankInput,
  Bank,
  CreateEntityInput,
  EntityRecord,
  CreateRelationshipInput,
  RelationshipRecord,
  ScoredMemory,
  SemanticSearchOptions,
  FullTextSearchOptions,
} from './types.js';
import { StorageError, ValidationError } from '../errors.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from '../db/schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

function jsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return value as T;
}

function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/[\\'`";&|(){}!*<>=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function sanitizeLikeQuery(query: string): string {
  return sanitizeFtsQuery(query).slice(0, 500);
}

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

export interface PostgresStorageDeps {
  db: DrizzleDB;
  client?: ReturnType<typeof postgres>;
}

export class PostgresStorage implements IStorage {
  private db: DrizzleDB;
  private client?: ReturnType<typeof postgres>;

  constructor(deps: PostgresStorageDeps) {
    if (!deps?.db) throw new StorageError('PostgresStorage requires a db connection');
    this.db = deps.db;
    this.client = deps.client;
  }

  async initialize(): Promise<void> {}

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end({ timeout: 5 });
    }
  }

  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    assertUuid(input.bankId, 'bankId');
    if (!input.content) throw new ValidationError('Memory content cannot be empty');

    try {
      const [row] = await this.db
        .insert(memoriesTable)
        .values({
          bankId: input.bankId,
          type: input.type,
          content: input.content,
          embedding: input.embedding,
          metadata: input.metadata || {},
          sourceId: input.sourceId,
          parentId: input.parentId,
          confidence: input.confidence ?? 1.0,
          expiresAt: input.expiresAt,
        })
        .returning();
      return rowToMemory(row);
    } catch (err) {
      throw new StorageError(`Failed to create memory: ${(err as Error).message}`, err);
    }
  }

  async getMemory(id: string): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    const [row] = await this.db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.id, id));
    return row ? rowToMemory(row) : null;
  }

  async updateMemory(
    id: string,
    input: Partial<CreateMemoryInput>
  ): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    const [row] = await this.db
      .update(memoriesTable)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(memoriesTable.id, id))
      .returning();
    return row ? rowToMemory(row) : null;
  }

  async deleteMemory(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    await this.db.delete(memoriesTable).where(eq(memoriesTable.id, id));
  }

  async listMemoriesByBank(bankId: string, limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = await this.db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.bankId, bankId))
      .orderBy(desc(memoriesTable.createdAt))
      .limit(safeLimit);
    return rows.map(rowToMemory);
  }

  async listMemoriesByType(
    bankId: string,
    type: Memory['type'],
    limit = 100
  ): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = await this.db
      .select()
      .from(memoriesTable)
      .where(
        and(eq(memoriesTable.bankId, bankId), eq(memoriesTable.type, type))
      )
      .orderBy(desc(memoriesTable.createdAt))
      .limit(safeLimit);
    return rows.map(rowToMemory);
  }

  async incrementMemoryAccess(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    await this.db
      .update(memoriesTable)
      .set({
        accessCount: sql`${memoriesTable.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(memoriesTable.id, id));
  }

  async createBank(input: CreateBankInput): Promise<Bank> {
    if (!input.name) throw new ValidationError('Bank name cannot be empty');
    if (input.parentId) assertUuid(input.parentId, 'parentId');

    const [row] = await this.db
      .insert(banksTable)
      .values({
        name: input.name,
        level: input.level,
        parentId: input.parentId,
        config: input.config || {},
      })
      .returning();
    return rowToBank(row);
  }

  async getBank(id: string): Promise<Bank | null> {
    if (id) assertUuid(id, 'bankId');
    const [row] = await this.db
      .select()
      .from(banksTable)
      .where(eq(banksTable.id, id));
    return row ? rowToBank(row) : null;
  }

  async getBankByName(name: string, parentId?: string): Promise<Bank | null> {
    if (parentId) assertUuid(parentId, 'parentId');
    const conditions = parentId
      ? and(eq(banksTable.name, name), eq(banksTable.parentId, parentId))
      : eq(banksTable.name, name);
    const [row] = await this.db
      .select()
      .from(banksTable)
      .where(conditions);
    return row ? rowToBank(row) : null;
  }

  async updateBank(
    id: string,
    input: Partial<CreateBankInput>
  ): Promise<Bank | null> {
    assertUuid(id, 'bankId');
    const [row] = await this.db
      .update(banksTable)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(banksTable.id, id))
      .returning();
    return row ? rowToBank(row) : null;
  }

  async deleteBank(id: string): Promise<void> {
    assertUuid(id, 'bankId');
    await this.db.delete(banksTable).where(eq(banksTable.id, id));
  }

  async listBanksByLevel(level: Bank['level']): Promise<Bank[]> {
    const rows = await this.db
      .select()
      .from(banksTable)
      .where(eq(banksTable.level, level));
    return rows.map(rowToBank);
  }

  async listAllBanks(): Promise<Bank[]> {
    const rows = await this.db.select().from(banksTable);
    return rows.map(rowToBank);
  }

  async getBankChildren(bankId: string): Promise<Bank[]> {
    assertUuid(bankId, 'bankId');
    const rows = await this.db
      .select()
      .from(banksTable)
      .where(eq(banksTable.parentId, bankId));
    return rows.map(rowToBank);
  }

  async createEntity(input: CreateEntityInput): Promise<EntityRecord> {
    assertUuid(input.bankId, 'bankId');
    if (!input.name) throw new ValidationError('Entity name cannot be empty');
    if (!input.type) throw new ValidationError('Entity type cannot be empty');

    const [row] = await this.db
      .insert(entitiesTable)
      .values({
        bankId: input.bankId,
        name: input.name,
        type: input.type,
        properties: input.properties || {},
        embedding: input.embedding,
      })
      .returning();
    return rowToEntity(row);
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    assertUuid(id, 'entityId');
    const [row] = await this.db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.id, id));
    return row ? rowToEntity(row) : null;
  }

  async findEntityByName(name: string, bankId: string): Promise<EntityRecord | null> {
    if (!name) throw new ValidationError('Entity name cannot be empty');
    assertUuid(bankId, 'bankId');
    const [row] = await this.db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.name, name), eq(entitiesTable.bankId, bankId)));
    return row ? rowToEntity(row) : null;
  }

  async listEntitiesByBank(bankId: string, limit = 1000): Promise<EntityRecord[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = await this.db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.bankId, bankId))
      .limit(safeLimit);
    return rows.map(rowToEntity);
  }

  async createRelationship(
    input: CreateRelationshipInput
  ): Promise<RelationshipRecord> {
    assertUuid(input.sourceId, 'sourceId');
    assertUuid(input.targetId, 'targetId');
    if (input.sourceId === input.targetId) {
      throw new ValidationError('Self-referential relationships are not allowed');
    }
    const [row] = await this.db
      .insert(relationshipsTable)
      .values({
        sourceId: input.sourceId,
        targetId: input.targetId,
        type: input.type,
        properties: input.properties || {},
        weight: input.weight ?? 1.0,
      })
      .returning();
    return rowToRelationship(row);
  }

  async getRelationships(entityId: string): Promise<RelationshipRecord[]> {
    assertUuid(entityId, 'entityId');
    const rows = await this.db
      .select()
      .from(relationshipsTable)
      .where(
        sql`${relationshipsTable.sourceId} = ${entityId} OR ${relationshipsTable.targetId} = ${entityId}`
      );
    return rows.map(rowToRelationship);
  }

  async linkMemoryEntity(memoryId: string, entityId: string): Promise<void> {
    assertUuid(memoryId, 'memoryId');
    assertUuid(entityId, 'entityId');
    await this.db
      .insert(memoryEntitiesTable)
      .values({ memoryId, entityId })
      .onConflictDoNothing();
  }

  async getEntitiesForMemory(memoryId: string): Promise<EntityRecord[]> {
    assertUuid(memoryId, 'memoryId');
    const rows = await this.db
      .select({ entity: entitiesTable })
      .from(memoryEntitiesTable)
      .innerJoin(
        entitiesTable,
        eq(memoryEntitiesTable.entityId, entitiesTable.id)
      )
      .where(eq(memoryEntitiesTable.memoryId, memoryId));
    return rows.map((r) => rowToEntity(r.entity));
  }

  async semanticSearch(
    bankId: string,
    embedding: number[],
    options: SemanticSearchOptions = {}
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const limit = Math.max(1, Math.min(options.limit ?? 10, 1000));
    if (embedding.length === 0) return [];

    const embeddingJson = JSON.stringify(embedding);
    const minScore = options.minScore;

    const rows = await this.db.execute(sql`
      SELECT *,
        1 - (embedding <=> ${embeddingJson}::vector) as similarity
      FROM memories
      WHERE bank_id = ${bankId}
        AND embedding IS NOT NULL
        ${minScore !== undefined ? sql`AND 1 - (embedding <=> ${embeddingJson}::vector) >= ${minScore}` : sql``}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((row) => ({
      memory: rowToMemory(row),
      score: row.similarity,
    }));
  }

  async fullTextSearch(
    bankId: string,
    query: string,
    options: FullTextSearchOptions = {}
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const safeQuery = sanitizeFtsQuery(query);
    if (safeQuery.length === 0) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 10, 1000));

    const rows = await this.db.execute(sql`
      SELECT *,
        ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', ${safeQuery})) as rank
      FROM memories
      WHERE bank_id = ${bankId}
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${safeQuery})
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((row) => ({
      memory: rowToMemory(row),
      score: row.rank,
    }));
  }

  async graphEntityLookup(
    bankId: string,
    nameOrTypeQuery: string,
    limit = 10
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const safeQuery = sanitizeLikeQuery(nameOrTypeQuery);
    if (safeQuery.length === 0) return [];
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const likePattern = `%${safeQuery}%`;

    const rows = await this.db.execute(sql`
      SELECT m.*,
        CASE WHEN e.name ILIKE ${likePattern} THEN 1.0 ELSE 0.5 END as score
      FROM memories m
      JOIN memory_entities me ON m.id = me.memory_id
      JOIN entities e ON me.entity_id = e.id
      WHERE m.bank_id = ${bankId}
        AND (e.name ILIKE ${likePattern} OR e.type ILIKE ${likePattern})
      ORDER BY score DESC
      LIMIT ${safeLimit}
    `);

    return (rows as any[]).map((row) => ({
      memory: rowToMemory(row),
      score: row.score,
    }));
  }

  async temporalSearch(
    bankId: string,
    options: {
      recency?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'any';
      limit?: number;
    } = {}
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const limit = Math.max(1, Math.min(options.limit ?? 10, 1000));
    const recency = options.recency ?? 'any';

    const intervalSQL: Record<Exclude<NonNullable<typeof options.recency>, 'any'>, string> = {
      hour: '1 hour',
      day: '1 day',
      week: '7 days',
      month: '30 days',
      year: '365 days',
    };

    const whereClause =
      recency === 'any'
        ? sql``
        : sql.raw(`AND created_at > NOW() - INTERVAL '${intervalSQL[recency]}'`);

    const rows = await this.db.execute(sql`
      SELECT *,
        CASE
          WHEN created_at > NOW() - INTERVAL '1 day' THEN 1.0
          WHEN created_at > NOW() - INTERVAL '1 week' THEN 0.8
          WHEN created_at > NOW() - INTERVAL '1 month' THEN 0.6
          WHEN created_at > NOW() - INTERVAL '1 year' THEN 0.4
          ELSE 0.2
        END as temporal_score
      FROM memories
      WHERE bank_id = ${bankId}
        ${whereClause}
      ORDER BY temporal_score DESC, created_at DESC
      LIMIT ${limit}
    `);

    return (rows as any[]).map((row) => ({
      memory: rowToMemory(row),
      score: row.temporal_score,
    }));
  }

  async getStats(): Promise<{
    memories: number;
    banks: number;
    entities: number;
  }> {
    const [memResult] = await this.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM memories`
    );
    const [bankResult] = await this.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM banks`
    );
    const [entResult] = await this.db.execute(
      sql`SELECT COUNT(*)::int AS c FROM entities`
    );
    return {
      memories: Number((memResult as any).c),
      banks: Number((bankResult as any).c),
      entities: Number((entResult as any).c),
    };
  }
}

interface DbMemoryRow {
  id: string;
  bankId: string;
  type: string;
  content: string;
  embedding?: number[] | null;
  metadata?: Record<string, unknown> | null;
  sourceId?: string | null;
  parentId?: string | null;
  confidence: number;
  accessCount: number;
  lastAccessedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
}

interface DbBankRow {
  id: string;
  name: string;
  level: string;
  parentId?: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface DbEntityRow {
  id: string;
  bankId: string;
  name: string;
  type: string;
  properties?: Record<string, unknown> | null;
  embedding?: number[] | null;
  createdAt: Date;
}

interface DbRelationshipRow {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Record<string, unknown> | null;
  weight: number;
  createdAt: Date;
}

function rowToMemory(row: DbMemoryRow | any): Memory {
  return {
    id: row.id,
    bankId: row.bankId ?? row.bank_id,
    type: row.type,
    content: row.content,
    embedding: row.embedding ?? undefined,
    metadata: jsonField(row.metadata, {}),
    sourceId: row.sourceId ?? row.source_id ?? undefined,
    parentId: row.parentId ?? row.parent_id ?? undefined,
    confidence: row.confidence,
    accessCount: row.accessCount ?? row.access_count,
    lastAccessedAt: row.lastAccessedAt ?? row.last_accessed_at
      ? new Date(row.lastAccessedAt ?? row.last_accessed_at)
      : undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.created_at),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updated_at),
    expiresAt: row.expiresAt ?? row.expires_at
      ? new Date(row.expiresAt ?? row.expires_at)
      : undefined,
  };
}

function rowToBank(row: DbBankRow | any): Bank {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    parentId: row.parentId ?? row.parent_id ?? undefined,
    config: jsonField(row.config, {}),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.created_at),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updated_at),
  };
}

function rowToEntity(row: DbEntityRow | any): EntityRecord {
  return {
    id: row.id,
    bankId: row.bankId ?? row.bank_id,
    name: row.name,
    type: row.type,
    properties: jsonField(row.properties, {}),
    embedding: row.embedding ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.created_at),
  };
}

function rowToRelationship(row: DbRelationshipRow | any): RelationshipRecord {
  return {
    id: row.id,
    sourceId: row.sourceId ?? row.source_id,
    targetId: row.targetId ?? row.target_id,
    type: row.type,
    properties: jsonField(row.properties, {}),
    weight: row.weight,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.created_at),
  };
}
