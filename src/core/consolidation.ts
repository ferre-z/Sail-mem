import { getDb } from '../db/connection.js';
import { Memory, Observation } from '../types/memory.js';
import { ValidationError } from '../errors.js';
import type { IStorage } from '../storage/types.js';
import { createStorage } from '../storage/factory.js';
import { MemoryStore } from './memory-store.js';
import { EmbeddingProvider } from '../embeddings/embedder.js';
import { LocalEmbedder } from '../embeddings/local.js';
import { getConfig } from '../config/index.js';

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
  storage?: IStorage;
}

export class ConsolidationEngine {
  private memoryStore: MemoryStore;
  private embedder: EmbeddingProvider;
  private storage?: IStorage;

  constructor(deps: ConsolidationEngineDeps = {}) {
    this.memoryStore = deps.memoryStore ?? new MemoryStore({ db: deps.db, storage: deps.storage });
    this.embedder = deps.embedder ?? new LocalEmbedder();
    this.storage = deps.storage;
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    this.storage = await createStorage({ provider: 'postgres', db: this.memoryStore['db'] });
    return this.storage;
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
    const storage = await this.useStorage();
    const scored = await storage.semanticSearch(bankId, embedding, {
      limit: 20,
      minScore: threshold,
    });
    return scored.map((s) => s.memory);
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

    const storage = await this.useStorage();
    const db = (storage as any).db;
    if (db?.insert) {
      await db.insert((await import('../db/schema.js')).consolidations).values({
        observationId: observation.id,
        sourceMemoryIds: memoryIds,
        evidenceCount: validMemories.length,
      });
    }

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

    const storage = await this.useStorage();
    const db = (storage as any).db;
    if (db?.insert) {
      await db.insert((await import('../db/schema.js')).consolidations).values({
        observationId: observation.id,
        sourceMemoryIds: evidenceFromMemories.map((e) => e.memoryId),
        evidenceCount: evidenceFromMemories.length,
      });
    }

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
}

export type { MemoryStoreDeps } from './memory-store.js';
