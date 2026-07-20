import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';

export class KeywordSearch {
  private db = getDb();

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    // PostgreSQL full-text search
    const results = await this.db.execute(sql`
      SELECT *, 
        ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', ${query})) as rank
      FROM memories
      WHERE bank_id = ${bankId}
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      memory: this.mapToMemory(row),
      score: row.rank,
      strategy: 'keyword',
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
