import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { SearchResult } from './search-engine.js';
import { LocalEmbedder } from '../embeddings/local.js';

export class SemanticSearch {
  private db = getDb();
  private embedder: LocalEmbedder;

  constructor() {
    this.embedder = new LocalEmbedder();
  }

  async initialize(): Promise<void> {
    await this.embedder.initialize();
  }

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);

    // Use pgvector cosine similarity
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
