import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { memories } from '../db/schema.js';
import { Memory, CreateMemoryInput } from '../types/memory.js';

export class MemoryStore {
  private db = getDb();

  async create(input: CreateMemoryInput): Promise<Memory> {
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
    const [result] = await this.db.select().from(memories).where(eq(memories.id, id));
    return result ? this.mapToMemory(result) : null;
  }

  async update(id: string, input: Partial<CreateMemoryInput>): Promise<Memory | null> {
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
    await this.db.delete(memories).where(eq(memories.id, id));
  }

  async listByBank(bankId: string, limit = 100): Promise<Memory[]> {
    const results = await this.db
      .select()
      .from(memories)
      .where(eq(memories.bankId, bankId))
      .orderBy(desc(memories.createdAt))
      .limit(limit);

    return results.map(this.mapToMemory);
  }

  async listByType(bankId: string, type: Memory['type'], limit = 100): Promise<Memory[]> {
    const results = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.bankId, bankId), eq(memories.type, type)))
      .orderBy(desc(memories.createdAt))
      .limit(limit);

    return results.map(this.mapToMemory);
  }

  async incrementAccessCount(id: string): Promise<void> {
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
