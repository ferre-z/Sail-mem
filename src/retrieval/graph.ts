import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

function sanitizeLikeQuery(query: string): string {
  return query
    .replace(/[\\%_'"`;&|(){}!*<>=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export interface GraphSearchDeps {
  db?: ReturnType<typeof getDb>;
}

export class GraphSearch {
  private db: ReturnType<typeof getDb>;

  constructor(deps: GraphSearchDeps = {}) {
    this.db = deps.db ?? getDb();
  }

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    const safeQuery = sanitizeLikeQuery(query);
    if (safeQuery.length === 0) return [];
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > 1000) limit = 1000;

    const likePattern = `%${safeQuery}%`;

    const results = await this.db.execute(sql`
      SELECT m.*,
        CASE WHEN e.name ILIKE ${likePattern} THEN 1.0 ELSE 0.5 END as score
      FROM memories m
      JOIN memory_entities me ON m.id = me.memory_id
      JOIN entities e ON me.entity_id = e.id
      WHERE m.bank_id = ${bankId}
        AND (e.name ILIKE ${likePattern} OR e.type ILIKE ${likePattern})
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
