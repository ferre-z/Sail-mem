import { sql } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { consolidations } from '../db/schema.js';
import { MemoryStore } from './memory-store.js';
import { LocalEmbedder } from '../embeddings/local.js';
import { getConfig } from '../config/index.js';
import { Memory, Observation } from '../types/memory.js';

export class ConsolidationEngine {
  private db = getDb();
  private memoryStore: MemoryStore;
  private embedder: LocalEmbedder;

  constructor() {
    this.memoryStore = new MemoryStore();
    this.embedder = new LocalEmbedder();
  }

  async initialize(): Promise<void> {
    await this.embedder.initialize();
  }

  async findSimilarMemories(
    bankId: string,
    content: string,
    threshold = getConfig().consolidation.similarityThreshold
  ): Promise<Memory[]> {
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
    const memories = await Promise.all(memoryIds.map((id) => this.memoryStore.getById(id)));

    const validMemories = memories.filter(Boolean) as Memory[];
    if (validMemories.length === 0) {
      throw new Error('No valid memories found for consolidation');
    }

    // Generate consolidated content
    const consolidatedContent = this.generateConsolidatedContent(validMemories);

    // Create observation
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

    // Track consolidation
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
    const consolidatedContent = evidence.map((e) => e.quote).join('. ');

    const observation = await this.memoryStore.create({
      bankId,
      type: 'observation',
      content: consolidatedContent,
      metadata: {
        consolidatedFrom: evidence.map((e) => e.memoryId),
        evidence,
      },
    });

    await this.db.insert(consolidations).values({
      observationId: observation.id,
      sourceMemoryIds: evidence.map((e) => e.memoryId),
      evidenceCount: evidence.length,
    });

    return observation as Observation;
  }

  async findConsolidationCandidates(bankId: string): Promise<Memory[][]> {
    // Find clusters of similar memories
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
    // Simple consolidation: combine unique facts
    const facts = memories.map((m) => m.content);
    const unique = [...new Set(facts)];
    return unique.join('. ');
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
