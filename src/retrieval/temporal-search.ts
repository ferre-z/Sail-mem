import type { IStorage, ScoredMemory } from '../storage/types.js';
import { SearchResult } from './search-engine.js';
import { ValidationError } from '../errors.js';
import { createStorage } from '../storage/factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

const TEMPORAL_KEYWORDS: Array<{
  trigger: RegExp;
  recency: 'hour' | 'day' | 'week' | 'month' | 'year';
}> = [
  { trigger: /\b(today|recent(ly)?|now|just)\b/i, recency: 'day' },
  { trigger: /\b(last|this)\s+hour\b/i, recency: 'hour' },
  { trigger: /\b(last|this)\s+(week|7\s*days)\b/i, recency: 'week' },
  { trigger: /\b(last|this)\s+(month|30\s*days)\b/i, recency: 'month' },
  { trigger: /\b(last|this)\s+(year|365\s*days|12\s*months)\b/i, recency: 'year' },
];

export interface TemporalSearchDeps {
  storage?: IStorage;
}

export class TemporalSearch {
  private storage?: IStorage;

  constructor(deps: TemporalSearchDeps = {}) {
    this.storage = deps.storage;
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    this.storage = await createStorage({ provider: 'sqlite' });
    return this.storage;
  }

  async initialize(): Promise<void> {}

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    const storage = await this.useStorage();

    const recency = this.parseQueryRecency(query);
    const scored: ScoredMemory[] = await storage.temporalSearch(bankId, {
      recency,
      limit,
    });

    return scored.map((s) => ({
      memory: s.memory,
      score: s.score,
      strategy: 'temporal',
      metadata: { parsedRecency: recency },
    }));
  }

  private parseQueryRecency(
    query: string
  ): 'hour' | 'day' | 'week' | 'month' | 'year' | 'any' {
    for (const { trigger, recency } of TEMPORAL_KEYWORDS) {
      if (trigger.test(query)) return recency;
    }
    return 'any';
  }
}
