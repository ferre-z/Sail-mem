import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { memories } from '../db/schema.js';
import { Memory, CreateMemoryInput } from '../types/memory.js';
import { NotFoundError, ValidationError } from '../errors.js';

export interface MemoryStoreDeps {
  db?: ReturnType<typeof getDb>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export class MemoryStore {
  private db: ReturnType<typeof getDb>;

  constructor(deps: MemoryStoreDeps = {}) {
    this.db = deps.db ?? getDb();
  }

  async create(input: CreateMemoryInput): Promise<Memory> {
    assertUuid(input.bankId, 'bankId');
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Memory content cannot be empty');
    }
    const [result] = await this.db
      .insert(memories)
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

    return this.mapToMemory(result);
  }

  async getById(id: string): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    const [result] = await this.db.select().from(memories).where(eq(memories.id, id));
    return result ? this.mapToMemory(result) : null;
  }

  async getByIdOrThrow(id: string): Promise<Memory> {
    const memory = await this.getById(id);
    if (!memory) throw new NotFoundError('Memory', id);
    return memory;
  }

  async update(id: string, input: Partial<CreateMemoryInput>): Promise<Memory | null> {
    if (id) assertUuid(id, 'memoryId');
    if (input.bankId) assertUuid(input.bankId, 'bankId');
    const [result] = await this.db
      .update(memories)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id))
      .returning();

    return result ? this.mapToMemory(result) : null;
  }

  async delete(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    await this.db.delete(memories).where(eq(memories.id, id));
  }

  async listByBank(bankId: string, limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const results = await this.db
      .select()
      .from(memories)
      .where(eq(memories.bankId, bankId))
      .orderBy(desc(memories.createdAt))
      .limit(safeLimit);

    return results.map(this.mapToMemory);
  }

  async listByType(bankId: string, type: Memory['type'], limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const safeLimit = Math.max(1, Math.min(limit, 10_000));
    const results = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.bankId, bankId), eq(memories.type, type)))
      .orderBy(desc(memories.createdAt))
      .limit(safeLimit);

    return results.map(this.mapToMemory);
  }

  async incrementAccessCount(id: string): Promise<void> {
    if (id) assertUuid(id, 'memoryId');
    await this.db
      .update(memories)
      .set({
        accessCount: sql`${memories.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(memories.id, id));
  }

  private mapToMemory(row: any): Memory {
    return {
      id: row.id,
      bankId: row.bankId,
      type: row.type,
      content: row.content,
      embedding: row.embedding,
      metadata: row.metadata || {},
      sourceId: row.sourceId,
      parentId: row.parentId,
      confidence: row.confidence,
      accessCount: row.accessCount,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    };
  }
}
