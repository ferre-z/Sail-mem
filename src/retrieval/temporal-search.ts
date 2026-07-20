import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';

export class TemporalSearch {
  private db = getDb();

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    // Parse temporal expressions from query
    const temporalFilter = this.parseTemporalQuery(query);

    const results = await this.db.execute(sql`
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
        ${sql.raw(temporalFilter)}
      ORDER BY temporal_score DESC, created_at DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      memory: this.mapToMemory(row),
      score: row.temporal_score,
      strategy: 'temporal',
      metadata: { parsedTemporal: temporalFilter },
    }));
  }

  private parseTemporalQuery(query: string): string {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('today') || lowerQuery.includes('recent')) {
      return "AND created_at > NOW() - INTERVAL '1 day'";
    }
    if (lowerQuery.includes('this week') || lowerQuery.includes('last week')) {
      return "AND created_at > NOW() - INTERVAL '1 week'";
    }
    if (lowerQuery.includes('this month') || lowerQuery.includes('last month')) {
      return "AND created_at > NOW() - INTERVAL '1 month'";
    }
    if (lowerQuery.includes('this year') || lowerQuery.includes('last year')) {
      return "AND created_at > NOW() - INTERVAL '1 year'";
    }

    return '';
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
