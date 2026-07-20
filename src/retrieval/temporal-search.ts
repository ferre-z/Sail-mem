import { sql, SQL } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

export interface TemporalSearchDeps {
  db?: ReturnType<typeof getDb>;
}

export class TemporalSearch {
  private db: ReturnType<typeof getDb>;

  constructor(deps: TemporalSearchDeps = {}) {
    this.db = deps.db ?? getDb();
  }

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > 1000) limit = 1000;

    const temporalCondition = this.parseTemporalCondition(query);

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
        ${temporalCondition ?? sql``}
      ORDER BY temporal_score DESC, created_at DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      memory: this.mapToMemory(row),
      score: row.temporal_score,
      strategy: 'temporal',
      metadata: { parsedTemporal: Boolean(temporalCondition) },
    }));
  }

  private parseTemporalCondition(query: string): SQL | undefined {
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('today') || lowerQuery.includes('recent')) {
      return sql`AND created_at > NOW() - INTERVAL '1 day'`;
    }
    if (lowerQuery.includes('this week') || lowerQuery.includes('last week')) {
      return sql`AND created_at > NOW() - INTERVAL '1 week'`;
    }
    if (lowerQuery.includes('this month') || lowerQuery.includes('last month')) {
      return sql`AND created_at > NOW() - INTERVAL '1 month'`;
    }
    if (lowerQuery.includes('this year') || lowerQuery.includes('last year')) {
      return sql`AND created_at > NOW() - INTERVAL '1 year'`;
    }

    return undefined;
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
