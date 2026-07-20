import { MemoryStore } from './memory-store.js';
import type { Memory } from '../types/memory.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export interface MentalModelRecord {
  id: string;
  bankId: string;
  sourceQuery: string;
  content: string;
  tags: string[];
  autoRefresh: boolean;
  lastRefreshedAt: Date;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMentalModelInput {
  bankId: string;
  sourceQuery: string;
  content: string;
  tags?: string[];
  autoRefresh?: boolean;
}

export interface MentalModelEngineDeps {
  memoryStore: MemoryStore;
}

/**
 * Mental models are user-curated, auto-refreshing summaries
 * checked first during retrieval. Unlike raw facts, they are
 * stored as `mental_model`-typed memories with metadata that
 * names the source query they answer.
 */
export class MentalModelEngine {
  private memoryStore: MemoryStore;

  constructor(deps: MentalModelEngineDeps) {
    this.memoryStore = deps.memoryStore;
  }

  async create(input: CreateMentalModelInput): Promise<MentalModelRecord> {
    assertUuid(input.bankId, 'bankId');
    if (!input.sourceQuery) throw new ValidationError('sourceQuery is required');
    if (!input.content) throw new ValidationError('content is required');

    const memory = await this.memoryStore.create({
      bankId: input.bankId,
      type: 'mental_model',
      content: input.content,
      metadata: {
        source: 'mental-model',
        tags: input.tags ?? [],
        sourceQuery: input.sourceQuery,
        lastRefreshedAt: new Date(),
      },
    });

    return toMentalModel(memory, input.sourceQuery, input.autoRefresh ?? true);
  }

  async findByQuery(bankId: string, query: string): Promise<MentalModelRecord | null> {
    assertUuid(bankId, 'bankId');
    if (!query) throw new ValidationError('query is required');

    const queryTokens = new Set(
      query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    );
    if (queryTokens.size === 0) return null;

    const models = await this.listModels(bankId);
    let best: MentalModelRecord | null = null;
    let bestOverlap = 0;
    for (const m of models) {
      const sourceTokens = new Set(
        m.sourceQuery.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
      );
      let overlap = 0;
      for (const t of sourceTokens) {
        if (queryTokens.has(t)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = m;
      }
    }
    if (best && bestOverlap > 0) {
      await this.memoryStore.incrementAccessCount(best.id);
      return best;
    }
    return null;
  }

  async listModels(bankId: string, limit = 100): Promise<MentalModelRecord[]> {
    assertUuid(bankId, 'bankId');
    const memories = await this.memoryStore.listByType(bankId, 'mental_model', limit);
    return memories.map((m) =>
      toMentalModel(
        m,
        m.metadata.sourceQuery ?? m.metadata.tags?.[0] ?? 'unknown',
        true
      )
    );
  }

  async refresh(modelId: string, newContent: string): Promise<MentalModelRecord | null> {
    assertUuid(modelId, 'modelId');
    if (!newContent) throw new ValidationError('content is required');

    const updated = await this.memoryStore.update(modelId, {
      content: newContent,
      metadata: { lastRefreshedAt: new Date() },
    });
    if (!updated) return null;
    return toMentalModel(updated, updated.metadata.sourceQuery ?? 'unknown', true);
  }
}

function toMentalModel(
  memory: Memory,
  sourceQuery: string,
  autoRefresh: boolean
): MentalModelRecord {
  return {
    id: memory.id,
    bankId: memory.bankId,
    sourceQuery,
    content: memory.content,
    tags: memory.metadata.tags ?? [],
    autoRefresh,
    lastRefreshedAt: memory.metadata.lastRefreshedAt ?? memory.updatedAt,
    accessCount: memory.accessCount,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}
