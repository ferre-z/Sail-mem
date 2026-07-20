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

export interface KeywordSearchDeps {
  storage?: IStorage;
}

export class KeywordSearch {
  private storage?: IStorage;

  constructor(deps: KeywordSearchDeps = {}) {
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
    if (!query || query.trim().length === 0) return [];
    const storage = await this.useStorage();
    const scored: ScoredMemory[] = await storage.fullTextSearch(bankId, query, { limit });

    return scored.map((s) => ({
      memory: s.memory,
      score: s.score,
      strategy: 'keyword',
    }));
  }
}
