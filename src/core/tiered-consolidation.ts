import { MemoryStore } from './memory-store.js';
import { Memory } from '../types/memory.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface TieredCompressionResult {
  tier: MemoryTier;
  bankId: string;
  summary: string;
  sourceMemoryIds: string[];
  createdAt: Date;
}

/**
 * Implements the four-tier human-memory inspired pipeline:
 *
 *   Working  -> raw tool output / conversation chunks
 *     |
 *     v  hourly sweep
 *   Episodic -> "what happened" session summaries
 *     |
 *     v  daily sweep
 *   Semantic -> "what I know" consolidated facts (observations)
 *     |
 *     v  on-demand
 *   Procedural -> repeated workflows / decision patterns
 *
 * Working memory lives in existing `experience_fact` records
 * with a `tier: 'working'` metadata tag so we don't have to
 * maintain a parallel store.
 */
export class TieredConsolidation {
  constructor(
    private memoryStore: MemoryStore
  ) {}

  async compressToEpisodic(
    bankId: string,
    options: { maxWorking?: number } = {}
  ): Promise<TieredCompressionResult> {
    assertUuid(bankId, 'bankId');
    const maxWorking = options.maxWorking ?? 200;
    const working = await this.listWorking(bankId, maxWorking);
    if (working.length === 0) {
      throw new ValidationError('No working memories to compress');
    }

    const summary = this.summarizeChunks(working.map((m) => m.content));

    const episodicMemory = await this.memoryStore.create({
      bankId,
      type: 'experience_fact',
      content: `Session summary: ${summary}`,
      metadata: {
        tier: 'episodic',
        consolidatedFrom: working.map((m) => m.id),
        source: 'tiered-consolidation',
      },
    });

    for (const m of working) {
      await this.memoryStore.update(m.id, {
        metadata: { ...m.metadata, tier: 'archived-working', archivedAt: new Date() },
      });
    }

    return {
      tier: 'episodic',
      bankId,
      summary: `Session summary: ${summary}`,
      sourceMemoryIds: working.map((m) => m.id),
      createdAt: episodicMemory.createdAt,
    };
  }

  async compressEpisodicToSemantic(bankId: string): Promise<TieredCompressionResult> {
    assertUuid(bankId, 'bankId');
    const episodic = await this.listEpisodic(bankId);
    if (episodic.length === 0) {
      throw new ValidationError('No episodic memories to compress');
    }

    const summary = this.summarizeChunks(episodic.map((m) => m.content));

    const semanticMemory = await this.memoryStore.create({
      bankId,
      type: 'observation',
      content: summary,
      confidence: 0.7,
      metadata: {
        tier: 'semantic',
        consolidatedFrom: episodic.map((m) => m.id),
        source: 'tiered-consolidation',
      },
    });

    return {
      tier: 'semantic',
      bankId,
      summary,
      sourceMemoryIds: episodic.map((m) => m.id),
      createdAt: semanticMemory.createdAt,
    };
  }

  async detectProceduralPatterns(bankId: string): Promise<TieredCompressionResult[]> {
    assertUuid(bankId, 'bankId');
    const episodic = await this.listEpisodic(bankId, 100);
    if (episodic.length < 3) return [];

    const sequences = groupByToolSequences(episodic);
    const procedural: TieredCompressionResult[] = [];

    for (const [signature, items] of sequences.entries()) {
      if (items.length < 3) continue;
      const memory = await this.memoryStore.create({
        bankId,
        type: 'observation',
        content: `Recurring workflow detected: ${signature}`,
        confidence: 0.6,
        metadata: {
          tier: 'procedural',
          occurrences: items.length,
          source: 'tiered-consolidation',
        },
      });
      procedural.push({
        tier: 'procedural',
        bankId,
        summary: signature,
        sourceMemoryIds: items.map((m) => m.id),
        createdAt: memory.createdAt,
      });
    }

    return procedural;
  }

  private async listWorking(bankId: string, limit: number): Promise<Memory[]> {
    const all = await this.memoryStore.listByBank(bankId, limit);
    return all.filter((m) => (m.metadata as Record<string, unknown>).tier === 'working');
  }

  private async listEpisodic(bankId: string, limit = 200): Promise<Memory[]> {
    const all = await this.memoryStore.listByBank(bankId, limit);
    return all.filter((m) => (m.metadata as Record<string, unknown>).tier === 'episodic');
  }

  private summarizeChunks(chunks: string[]): string {
    const unique = Array.from(new Set(chunks.map((c) => c.trim()).filter(Boolean)));
    const joined = unique.join('. ');
    if (joined.length > 5000) return joined.slice(0, 5000) + '...';
    return joined;
  }
}

function groupByToolSequences(memories: Memory[]): Map<string, Memory[]> {
  const map = new Map<string, Memory[]>();
  for (const m of memories) {
    const tools = Array.isArray((m.metadata as Record<string, unknown>).toolSequence)
      ? ((m.metadata as Record<string, unknown>).toolSequence as string[]).join('->')
      : 'session';
    const arr = map.get(tools) ?? [];
    arr.push(m);
    map.set(tools, arr);
  }
  return map;
}
