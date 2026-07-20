import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';

export class GraphSearch {
  private db = getDb();

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    // Find entities matching query, then get their connected memories
    const results = await this.db.execute(sql`
      SELECT m.*, 
        CASE WHEN e.name ILIKE ${`%${query}%`} THEN 1.0 ELSE 0.5 END as score
      FROM memories m
      JOIN memory_entities me ON m.id = me.memory_id
      JOIN entities e ON me.entity_id = e.id
      WHERE m.bank_id = ${bankId}
        AND (e.name ILIKE ${`%${query}%`} OR e.type ILIKE ${`%${query}%`})
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      memory: this.mapToMemory(row),
      score: row.score,
      strategy: 'graph',
    }));
  }

  private mapToMemory(row: any): any {
    return {
      id: row.id,
      bankId: row.bank_id,
      type: row.type,
      content: row.content,
      embedding: row.embedding,
      metadata: row.metadata || {},
      sourceId: row.source_id,
      parentId: row.parent_id,
      confidence: row.confidence,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
}
