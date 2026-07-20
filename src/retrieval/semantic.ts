import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';
import { EmbeddingProvider } from '../embeddings/embedder.js';
import { LocalEmbedder } from '../embeddings/local.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

export interface SemanticSearchDeps {
  db?: ReturnType<typeof getDb>;
  embedder?: EmbeddingProvider;
}

export class SemanticSearch {
  private db: ReturnType<typeof getDb>;
  private embedder: EmbeddingProvider;

  constructor(deps: SemanticSearchDeps = {}) {
    this.db = deps.db ?? getDb();
    this.embedder = deps.embedder ?? new LocalEmbedder();
  }

  async initialize(): Promise<void> {
    if (this.embedder.initialize) {
      await this.embedder.initialize();
    }
  }

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    if (!query || query.trim().length === 0) return [];
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > 1000) limit = 1000;

    const queryEmbedding = await this.embedder.embed(query);

    const results = await this.db.execute(sql`
      SELECT *,
        1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
      FROM memories
      WHERE bank_id = ${bankId}
        AND embedding IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    return results.map((row: any) => ({
      memory: this.mapToMemory(row),
      score: row.similarity,
      strategy: 'semantic',
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
