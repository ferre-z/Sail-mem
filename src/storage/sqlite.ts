import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  IStorage,
  CreateMemoryInput,
  Memory,
  CreateBankInput,
  Bank,
  BankLevel,
  CreateEntityInput,
  EntityRecord,
  CreateRelationshipInput,
  RelationshipRecord,
  ScoredMemory,
  SemanticSearchOptions,
  FullTextSearchOptions,
} from './types.js';
import { StorageError, ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

function jsonParse<T>(value: string | null, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/[\\'`";&|(){}!*<>=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

interface MemoryRow {
  id: string;
  bank_id: string;
  type: string;
  content: string;
  embedding: string | null;
  metadata: string | null;
  source_id: string | null;
  parent_id: string | null;
  confidence: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

interface BankRow {
  id: string;
  name: string;
  level: string;
  parent_id: string | null;
  config: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: string;
  bank_id: string;
  name: string;
  type: string;
  properties: string | null;
  embedding: string | null;
  created_at: string;
}

interface RelationshipRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  properties: string | null;
  weight: number;
  created_at: string;
}

function rowToMemory(r: MemoryRow): Memory {
  const metadata = jsonParse<Record<string, unknown>>(r.metadata, {});
  return {
    id: r.id,
    bankId: r.bank_id,
    type: r.type as Memory['type'],
    content: r.content,
    embedding: r.embedding ? (jsonParse<number[]>(r.embedding, [])) : undefined,
    metadata: reviveDates(metadata) as any,
    sourceId: r.source_id ?? undefined,
    parentId: r.parent_id ?? undefined,
    confidence: r.confidence,
    accessCount: r.access_count,
    lastAccessedAt: r.last_accessed_at ? new Date(r.last_accessed_at) : undefined,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    expiresAt: r.expires_at ? new Date(r.expires_at) : undefined,
  };
}

function reviveDates(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reviveDates);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v)) {
      out[k] = new Date(v);
    } else if (v && typeof v === 'object') {
      out[k] = reviveDates(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function rowToBank(r: BankRow): Bank {
  return {
    id: r.id,
    name: r.name,
    level: r.level as BankLevel,
    parentId: r.parent_id ?? undefined,
    config: jsonParse<Record<string, unknown>>(r.config, {}),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function rowToEntity(r: EntityRow): EntityRecord {
  return {
    id: r.id,
    bankId: r.bank_id,
    name: r.name,
    type: r.type,
    properties: jsonParse<Record<string, unknown>>(r.properties, {}),
    embedding: r.embedding ? jsonParse<number[]>(r.embedding, []) : undefined,
    createdAt: new Date(r.created_at),
  };
}

function rowToRelationship(r: RelationshipRow): RelationshipRecord {
  return {
    id: r.id,
    sourceId: r.source_id,
    targetId: r.target_id,
    type: r.type,
    properties: jsonParse<Record<string, unknown>>(r.properties, {}),
    weight: r.weight,
    createdAt: new Date(r.created_at),
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS banks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  parent_id TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS banks_name_parent ON banks (name, parent_id);
CREATE INDEX IF NOT EXISTS banks_level ON banks (level);
CREATE INDEX IF NOT EXISTS banks_parent ON banks (parent_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  source_id TEXT,
  parent_id TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS memories_bank ON memories (bank_id);
CREATE INDEX IF NOT EXISTS memories_type ON memories (type);
CREATE INDEX IF NOT EXISTS memories_bank_type ON memories (bank_id, type);
CREATE INDEX IF NOT EXISTS memories_source ON memories (source_id);
CREATE INDEX IF NOT EXISTS memories_parent ON memories (parent_id);
CREATE INDEX IF NOT EXISTS memories_created ON memories (created_at);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  embedding TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS entities_name_bank ON entities (name, bank_id);
CREATE INDEX IF NOT EXISTS entities_bank ON entities (bank_id);
CREATE INDEX IF NOT EXISTS entities_type ON entities (type);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relationships_source ON relationships (source_id);
CREATE INDEX IF NOT EXISTS relationships_target ON relationships (target_id);
CREATE INDEX IF NOT EXISTS relationships_type ON relationships (type);

CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);

CREATE TABLE IF NOT EXISTS consolidations (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  source_memory_ids TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  last_consolidated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consolidations_observation ON consolidations (observation_id);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  bank_id UNINDEXED,
  type UNINDEXED,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, bank_id, type)
  VALUES (new.rowid, new.content, new.bank_id, new.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, bank_id, type)
  VALUES ('delete', old.rowid, old.content, old.bank_id, old.type);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, bank_id, type)
  VALUES ('delete', old.rowid, old.content, old.bank_id, old.type);
  INSERT INTO memories_fts(rowid, content, bank_id, type)
  VALUES (new.rowid, new.content, new.bank_id, new.type);
END;
`;

export interface SQLiteStorageOptions {
  path: string | ':memory:';
  readonly?: boolean;
}

export class SQLiteStorage implements IStorage {
  private db: Database.Database;
  private readonly: boolean;
  private closed = false;

  constructor(options: SQLiteStorageOptions = { path: ':memory:' }) {
    try {
      this.db = new Database(options.path);
      this.readonly = options.readonly ?? false;
      if (!this.readonly) {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
      }
    } catch (err) {
      throw new StorageError(
        `Failed to open SQLite database at ${options.path}: ${(err as Error).message}`,
        err
      );
    }
  }

  async initialize(): Promise<void> {
    try {
      this.db.exec(SCHEMA_SQL);
    } catch (err) {
      throw new StorageError(
        `Failed to initialize SQLite schema: ${(err as Error).message}`,
        err
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (err) {
      throw new StorageError(
        `Failed to close SQLite database: ${(err as Error).message}`,
        err
      );
    }
  }

  private writeTx<T>(fn: () => T): T {
    if (this.readonly) {
      throw new StorageError('Database is opened readonly');
    }
    const tx = this.db.transaction(fn);
    return tx();
  }

  async createMemory(input: CreateMemoryInput): Promise<Memory> {
    assertUuid(input.bankId, 'bankId');
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Memory content cannot be empty');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const row: MemoryRow = {
      id,
      bank_id: input.bankId,
      type: input.type,
      content: input.content,
      embedding: input.embedding ? jsonStringify(input.embedding) : null,
      metadata: jsonStringify(input.metadata || {}),
      source_id: input.sourceId ?? null,
      parent_id: input.parentId ?? null,
      confidence: input.confidence ?? 1.0,
      access_count: 0,
      last_accessed_at: null,
      created_at: now,
      updated_at: now,
      expires_at: input.expiresAt?.toISOString() ?? null,
    };

    const stmt = this.db.prepare(`
      INSERT INTO memories
      (id, bank_id, type, content, embedding, metadata, source_id, parent_id,
       confidence, access_count, last_accessed_at, created_at, updated_at, expires_at)
      VALUES (@id, @bank_id, @type, @content, @embedding, @metadata, @source_id, @parent_id,
              @confidence, @access_count, @last_accessed_at, @created_at, @updated_at, @expires_at)
    `);
    try {
      this.writeTx(() => stmt.run(row));
    } catch (err) {
      throw new StorageError(
        `Failed to create memory: ${(err as Error).message}`,
        err
      );
    }
    return rowToMemory(row);
  }

  async getMemory(id: string): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  async updateMemory(
    id: string,
    input: Partial<CreateMemoryInput>
  ): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    const existing = await this.getMemory(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: Partial<MemoryRow> = {
      bank_id: input.bankId ?? existing.bankId,
      type: input.type ?? existing.type,
      content: input.content ?? existing.content,
      embedding:
        input.embedding !== undefined
          ? jsonStringify(input.embedding)
          : existing.embedding
            ? jsonStringify(existing.embedding)
            : null,
      metadata: jsonStringify(input.metadata ?? existing.metadata),
      source_id: input.sourceId ?? existing.sourceId ?? null,
      parent_id: input.parentId ?? existing.parentId ?? null,
      confidence: input.confidence ?? existing.confidence,
      expires_at: input.expiresAt ? input.expiresAt.toISOString() : existing.expiresAt?.toISOString() ?? null,
      updated_at: now,
    };

    try {
      this.writeTx(() =>
        this.db
          .prepare(
            `UPDATE memories SET bank_id=@bank_id, type=@type, content=@content, embedding=@embedding,
              metadata=@metadata, source_id=@source_id, parent_id=@parent_id,
              confidence=@confidence, expires_at=@expires_at, updated_at=@updated_at
             WHERE id=@id`
          )
          .run({ id, ...updated })
      );
    } catch (err) {
      throw new StorageError(
        `Failed to update memory ${id}: ${(err as Error).message}`,
        err
      );
    }
    return this.getMemory(id);
  }

  async deleteMemory(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    try {
      this.writeTx(() => this.db.prepare('DELETE FROM memories WHERE id = ?').run(id));
    } catch (err) {
      throw new StorageError(
        `Failed to delete memory ${id}: ${(err as Error).message}`,
        err
      );
    }
  }

  async listMemoriesByBank(bankId: string, limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = this.db
      .prepare(
        'SELECT * FROM memories WHERE bank_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(bankId, safeLimit) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  async listMemoriesByType(
    bankId: string,
    type: Memory['type'],
    limit = 100
  ): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = this.db
      .prepare(
        'SELECT * FROM memories WHERE bank_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(bankId, type, safeLimit) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  async incrementMemoryAccess(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    this.writeTx(() =>
      this.db
        .prepare(
          `UPDATE memories SET access_count = access_count + 1,
                              last_accessed_at = ?
           WHERE id = ?`
        )
        .run(new Date().toISOString(), id)
    );
  }

  async createBank(input: CreateBankInput): Promise<Bank> {
    if (!input.name) throw new ValidationError('Bank name cannot be empty');
    if (input.parentId) assertUuid(input.parentId, 'parentId');

    const id = randomUUID();
    const now = new Date().toISOString();
    const row: BankRow = {
      id,
      name: input.name,
      level: input.level,
      parent_id: input.parentId ?? null,
      config: jsonStringify(input.config || {}),
      created_at: now,
      updated_at: now,
    };
    try {
      this.writeTx(() =>
        this.db
          .prepare(
            `INSERT INTO banks (id, name, level, parent_id, config, created_at, updated_at)
             VALUES (@id, @name, @level, @parent_id, @config, @created_at, @updated_at)`
          )
          .run(row)
      );
    } catch (err) {
      throw new StorageError(
        `Failed to create bank: ${(err as Error).message}`,
        err
      );
    }
    return rowToBank(row);
  }

  async getBank(id: string): Promise<Bank | null> {
    if (id) assertUuid(id, 'bankId');
    const row = this.db
      .prepare('SELECT * FROM banks WHERE id = ?')
      .get(id) as BankRow | undefined;
    return row ? rowToBank(row) : null;
  }

  async getBankByName(name: string, parentId?: string): Promise<Bank | null> {
    if (!name) throw new ValidationError('Bank name cannot be empty');
    if (parentId) assertUuid(parentId, 'parentId');
    const row = parentId
      ? (this.db
          .prepare('SELECT * FROM banks WHERE name = ? AND parent_id = ?')
          .get(name, parentId) as BankRow | undefined)
      : (this.db
          .prepare('SELECT * FROM banks WHERE name = ? AND parent_id IS NULL')
          .get(name) as BankRow | undefined);
    return row ? rowToBank(row) : null;
  }

  async updateBank(
    id: string,
    input: Partial<CreateBankInput>
  ): Promise<Bank | null> {
    assertUuid(id, 'bankId');
    const existing = await this.getBank(id);
    if (!existing) return null;
    const now = new Date().toISOString();

    try {
      this.writeTx(() =>
        this.db
          .prepare(
            `UPDATE banks SET name=?, level=?, parent_id=?, config=?, updated_at=?
             WHERE id=?`
          )
          .run(
            input.name ?? existing.name,
            input.level ?? existing.level,
            input.parentId ?? existing.parentId ?? null,
            jsonStringify(input.config ?? existing.config),
            now,
            id
          )
      );
    } catch (err) {
      throw new StorageError(
        `Failed to update bank ${id}: ${(err as Error).message}`,
        err
      );
    }
    return this.getBank(id);
  }

  async deleteBank(id: string): Promise<void> {
    assertUuid(id, 'bankId');
    try {
      this.writeTx(() => this.db.prepare('DELETE FROM banks WHERE id = ?').run(id));
    } catch (err) {
      throw new StorageError(
        `Failed to delete bank ${id}: ${(err as Error).message}`,
        err
      );
    }
  }

  async listBanksByLevel(level: BankLevel): Promise<Bank[]> {
    const rows = this.db
      .prepare('SELECT * FROM banks WHERE level = ? ORDER BY created_at')
      .all(level) as BankRow[];
    return rows.map(rowToBank);
  }

  async listAllBanks(): Promise<Bank[]> {
    const rows = this.db.prepare('SELECT * FROM banks').all() as BankRow[];
    return rows.map(rowToBank);
  }

  async getBankChildren(bankId: string): Promise<Bank[]> {
    assertUuid(bankId, 'bankId');
    const rows = this.db
      .prepare('SELECT * FROM banks WHERE parent_id = ?')
      .all(bankId) as BankRow[];
    return rows.map(rowToBank);
  }

  async createEntity(input: CreateEntityInput): Promise<EntityRecord> {
    assertUuid(input.bankId, 'bankId');
    if (!input.name) throw new ValidationError('Entity name cannot be empty');
    if (!input.type) throw new ValidationError('Entity type cannot be empty');

    const id = randomUUID();
    const row: EntityRow = {
      id,
      bank_id: input.bankId,
      name: input.name,
      type: input.type,
      properties: jsonStringify(input.properties || {}),
      embedding: input.embedding ? jsonStringify(input.embedding) : null,
      created_at: new Date().toISOString(),
    };
    this.writeTx(() =>
      this.db
        .prepare(
          `INSERT INTO entities (id, bank_id, name, type, properties, embedding, created_at)
           VALUES (@id, @bank_id, @name, @type, @properties, @embedding, @created_at)`
        )
        .run(row)
    );
    return rowToEntity(row);
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    assertUuid(id, 'entityId');
    const row = this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async findEntityByName(name: string, bankId: string): Promise<EntityRecord | null> {
    if (!name) throw new ValidationError('Entity name cannot be empty');
    assertUuid(bankId, 'bankId');
    const row = this.db
      .prepare('SELECT * FROM entities WHERE name = ? AND bank_id = ?')
      .get(name, bankId) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  async listEntitiesByBank(bankId: string, limit = 1000): Promise<EntityRecord[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const rows = this.db
      .prepare('SELECT * FROM entities WHERE bank_id = ? ORDER BY created_at LIMIT ?')
      .all(bankId, safeLimit) as EntityRow[];
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
    const id = randomUUID();
    const row: RelationshipRow = {
      id,
      source_id: input.sourceId,
      target_id: input.targetId,
      type: input.type,
      properties: jsonStringify(input.properties || {}),
      weight: input.weight ?? 1.0,
      created_at: new Date().toISOString(),
    };
    this.writeTx(() =>
      this.db
        .prepare(
          `INSERT INTO relationships (id, source_id, target_id, type, properties, weight, created_at)
           VALUES (@id, @source_id, @target_id, @type, @properties, @weight, @created_at)`
        )
        .run(row)
    );
    return rowToRelationship(row);
  }

  async getRelationships(entityId: string): Promise<RelationshipRecord[]> {
    assertUuid(entityId, 'entityId');
    const rows = this.db
      .prepare(
        'SELECT * FROM relationships WHERE source_id = ? OR target_id = ?'
      )
      .all(entityId, entityId) as RelationshipRow[];
    return rows.map(rowToRelationship);
  }

  async linkMemoryEntity(memoryId: string, entityId: string): Promise<void> {
    assertUuid(memoryId, 'memoryId');
    assertUuid(entityId, 'entityId');
    this.writeTx(() =>
      this.db
        .prepare(
          'INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)'
        )
        .run(memoryId, entityId)
    );
  }

  async getEntitiesForMemory(memoryId: string): Promise<EntityRecord[]> {
    assertUuid(memoryId, 'memoryId');
    const rows = this.db
      .prepare(
        `SELECT e.* FROM entities e
         JOIN memory_entities me ON me.entity_id = e.id
         WHERE me.memory_id = ?`
      )
      .all(memoryId) as EntityRow[];
    return rows.map(rowToEntity);
  }

  async semanticSearch(
    bankId: string,
    embedding: number[],
    options: SemanticSearchOptions = {}
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const limit = Math.max(1, Math.min(options.limit ?? 10, 1000));
    if (embedding.length === 0) return [];

    const candidates = this.db
      .prepare(
        'SELECT * FROM memories WHERE bank_id = ? AND embedding IS NOT NULL'
      )
      .all(bankId) as MemoryRow[];

    const scored: ScoredMemory[] = [];
    for (const row of candidates) {
      const memEmbedding = jsonParse<number[]>(row.embedding, []);
      if (memEmbedding.length !== embedding.length) continue;
      const score = cosineSimilarity(embedding, memEmbedding);
      if (options.minScore !== undefined && score < options.minScore) continue;
      scored.push({ memory: rowToMemory(row), score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
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
    const ftsQuery = `${safeQuery}*`;

    const rows = this.db
      .prepare(
        `SELECT m.*, fts.rank AS fts_rank
         FROM memories_fts fts
         JOIN memories m ON m.rowid = fts.rowid
         WHERE fts.bank_id = ? AND memories_fts MATCH ?
         ORDER BY fts.rank
         LIMIT ?`
      )
      .all(bankId, ftsQuery, limit) as (MemoryRow & { fts_rank: number })[];

    return rows.map((row) => ({
      memory: rowToMemory(row),
      score: -row.fts_rank,
    }));
  }

  async graphEntityLookup(
    bankId: string,
    nameOrTypeQuery: string,
    limit = 10
  ): Promise<ScoredMemory[]> {
    assertUuid(bankId, 'bankId');
    const safeQuery = sanitizeFtsQuery(nameOrTypeQuery);
    if (safeQuery.length === 0) return [];
    const likePattern = `%${safeQuery}%`;
    const safeLimit = Math.max(1, Math.min(limit, 1000));

    const rows = this.db
      .prepare(
        `SELECT m.*,
           CASE WHEN e.name LIKE ? THEN 1.0 ELSE 0.5 END AS score
         FROM memories m
         JOIN memory_entities me ON m.id = me.memory_id
         JOIN entities e ON e.id = me.entity_id
         WHERE m.bank_id = ? AND (e.name LIKE ? OR e.type LIKE ?)
         ORDER BY score DESC
         LIMIT ?`
      )
      .all(likePattern, bankId, likePattern, likePattern, safeLimit) as (MemoryRow & {
      score: number;
    })[];

    return rows.map((row) => ({
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
      hour: "-1 hour",
      day: "-1 day",
      week: "-7 days",
      month: "-30 days",
      year: "-365 days",
    };

    const where =
      recency === 'any'
        ? ''
        : `AND created_at >= datetime('now', '${intervalSQL[recency]}')`;

    const rows = this.db
      .prepare(
        `SELECT *,
           CASE
             WHEN created_at >= datetime('now') THEN 1.0
             WHEN created_at >= datetime('now', '-1 day') THEN 0.9
             WHEN created_at >= datetime('now', '-7 days') THEN 0.7
             WHEN created_at >= datetime('now', '-30 days') THEN 0.5
             WHEN created_at >= datetime('now', '-365 days') THEN 0.3
             ELSE 0.1
           END AS temporal_score
         FROM memories
         WHERE bank_id = ? ${where}
         ORDER BY temporal_score DESC, created_at DESC
         LIMIT ?`
      )
      .all(bankId, limit) as (MemoryRow & { temporal_score: number })[];

    return rows.map((row) => ({
      memory: rowToMemory(row),
      score: row.temporal_score,
    }));
  }

  async getStats(): Promise<{
    memories: number;
    banks: number;
    entities: number;
  }> {
    const memories = (
      this.db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }
    ).c;
    const banks = (
      this.db.prepare('SELECT COUNT(*) AS c FROM banks').get() as { c: number }
    ).c;
    const entities = (
      this.db.prepare('SELECT COUNT(*) AS c FROM entities').get() as { c: number }
    ).c;
    return { memories, banks, entities };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
