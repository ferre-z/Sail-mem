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

function sanitizeFtsQuery(query: string): string {
  return query
    .replace(/[\\'`";&|(){}!*<>=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export interface KeywordSearchDeps {
  db?: ReturnType<typeof getDb>;
}

export class KeywordSearch {
  private db: ReturnType<typeof getDb>;

  constructor(deps: KeywordSearchDeps = {}) {
    this.db = deps.db ?? getDb();
  }

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    const safeQuery = sanitizeFtsQuery(query);
    if (safeQuery.length === 0) return [];
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > 1000) limit = 1000;

    const results = await this.db.execute(sql`
      SELECT *,
        ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', ${safeQuery})) as rank
      FROM memories
      WHERE bank_id = ${bankId}
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${safeQuery})
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
