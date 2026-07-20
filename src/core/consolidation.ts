import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { consolidations } from '../db/schema.js';
import { MemoryStore } from './memory-store.js';
import type { MemoryStoreDeps } from './memory-store.js';

export type { MemoryStoreDeps };
import { LocalEmbedder } from '../embeddings/local.js';
import { EmbeddingProvider } from '../embeddings/embedder.js';
import { getConfig } from '../config/index.js';
import { Memory, Observation } from '../types/memory.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

function assertSameBank(memories: Memory[], bankId: string): void {
  for (const m of memories) {
    if (m.bankId !== bankId) {
      throw new ValidationError(
        `Memory ${m.id} belongs to bank ${m.bankId}, not ${bankId}. ` +
        `Cross-bank consolidation is not permitted.`
      );
    }
  }
}

const CONSOLIDATED_CONTENT_CAP = 10_000;

export interface ConsolidationEngineDeps {
  memoryStore?: MemoryStore;
  embedder?: EmbeddingProvider;
  db?: ReturnType<typeof getDb>;
}

export class ConsolidationEngine {
  private db: ReturnType<typeof getDb>;
  private memoryStore: MemoryStore;
  private embedder: EmbeddingProvider;

  constructor(deps: ConsolidationEngineDeps = {}) {
    this.db = deps.db ?? getDb();
    this.memoryStore = deps.memoryStore ?? new MemoryStore({ db: this.db });
    this.embedder = deps.embedder ?? new LocalEmbedder();
  }

  async initialize(): Promise<void> {
    if (this.embedder.initialize) {
      await this.embedder.initialize();
    }
  }

  async findSimilarMemories(
    bankId: string,
    content: string,
    threshold = getConfig().consolidation.similarityThreshold
  ): Promise<Memory[]> {
    assertValidBankId(bankId);
    if (!content || content.trim().length === 0) return [];

    const embedding = await this.embedder.embed(content);

    const results = await this.db.execute(sql`
      SELECT *
      FROM memories
      WHERE bank_id = ${bankId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) > ${threshold}
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT 20
    `);

    return results.map((row: any) => this.mapToMemory(row));
  }

  async consolidate(bankId: string, memoryIds: string[]): Promise<Observation> {
    assertValidBankId(bankId);
    if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
      throw new ValidationError('memoryIds must be a non-empty array');
    }

    const memories = await Promise.all(memoryIds.map((id) => this.memoryStore.getById(id)));
    const validMemories = memories.filter(Boolean) as Memory[];
    if (validMemories.length === 0) {
      throw new ValidationError('No valid memories found for consolidation');
    }
    assertSameBank(validMemories, bankId);

    const consolidatedContent = this.generateConsolidatedContent(validMemories);

    const observation = await this.memoryStore.create({
      bankId,
      type: 'observation',
      content: consolidatedContent,
      metadata: {
        consolidatedFrom: memoryIds,
        evidence: validMemories.map((m) => ({
          memoryId: m.id,
          quote: m.content,
        })),
      },
    });

    await this.db.insert(consolidations).values({
      observationId: observation.id,
      sourceMemoryIds: memoryIds,
      evidenceCount: validMemories.length,
    });

    return observation as Observation;
  }

  async consolidateWithEvidence(
    bankId: string,
    evidence: Array<{ memoryId: string; quote: string }>
  ): Promise<Observation> {
    assertValidBankId(bankId);
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new ValidationError('evidence must be a non-empty array');
    }

    const validMemories = (
      await Promise.all(evidence.map((e) => this.memoryStore.getById(e.memoryId)))
    ).filter(Boolean) as Memory[];
    assertSameBank(validMemories, bankId);

    const evidenceFromMemories = validMemories.map((m) => ({
      memoryId: m.id,
      quote: m.content,
    }));

    const consolidatedContent = evidenceFromMemories
      .map((e) => e.quote)
      .filter((q) => q && q.trim().length > 0)
      .join('. ');

    if (consolidatedContent.length === 0) {
      throw new ValidationError('Cannot consolidate memories with empty content');
    }

    const observation = await this.memoryStore.create({
      bankId,
      type: 'observation',
      content: consolidatedContent,
      metadata: {
        consolidatedFrom: evidenceFromMemories.map((e) => e.memoryId),
        evidence: evidenceFromMemories,
      },
    });

    await this.db.insert(consolidations).values({
      observationId: observation.id,
      sourceMemoryIds: evidenceFromMemories.map((e) => e.memoryId),
      evidenceCount: evidenceFromMemories.length,
    });

    return observation as Observation;
  }

  async findConsolidationCandidates(bankId: string): Promise<Memory[][]> {
    assertValidBankId(bankId);
    const allMemories = await this.memoryStore.listByBank(bankId, 1000);
    const clusters: Memory[][] = [];
    const processed = new Set<string>();

    for (const memory of allMemories) {
      if (processed.has(memory.id)) continue;

      const similar = await this.findSimilarMemories(bankId, memory.content);
      const cluster = [memory, ...similar.filter((m) => m.id !== memory.id)];

      if (cluster.length >= getConfig().consolidation.minEvidenceCount) {
        clusters.push(cluster);
        cluster.forEach((m) => processed.add(m.id));
      }
    }

    return clusters;
  }

  private generateConsolidatedContent(memories: Memory[]): string {
    if (memories.length === 0) return '';

    const facts = memories.map((m) => m.content).filter((c) => c && c.trim().length > 0);
    const unique = [...new Set(facts)];
    const content = unique.join('. ');

    if (content.length > CONSOLIDATED_CONTENT_CAP) {
      return content.slice(0, CONSOLIDATED_CONTENT_CAP) + '...';
    }
    return content;
  }

  private mapToMemory(row: any): Memory {
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
