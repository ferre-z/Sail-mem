import type { IStorage, ScoredMemory } from '../storage/types.js';
import { SearchResult } from './search-engine.js';
import { EmbeddingProvider } from '../embeddings/embedder.js';
import { LocalEmbedder } from '../embeddings/local.js';
import { ValidationError } from '../errors.js';
import { createStorage } from '../storage/factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

export interface SemanticSearchDeps {
  storage?: IStorage;
  embedder?: EmbeddingProvider;
}

export class SemanticSearch {
  private storage?: IStorage;
  private embedder: EmbeddingProvider;

  constructor(deps: SemanticSearchDeps = {}) {
    this.storage = deps.storage;
    this.embedder = deps.embedder ?? new LocalEmbedder();
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    this.storage = await createStorage({ provider: 'sqlite' });
    return this.storage;
  }

  async initialize(): Promise<void> {
    if (this.embedder.initialize) {
      await this.embedder.initialize();
    }
  }

  async search(bankId: string, query: string, limit: number): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    if (!query || query.trim().length === 0) return [];

    const queryEmbedding = await this.embedder.embed(query);
    const storage = await this.useStorage();
    const scored: ScoredMemory[] = await storage.semanticSearch(bankId, queryEmbedding, {
      limit,
    });

    return scored.map((s) => ({
      memory: s.memory,
      score: s.score,
      strategy: 'semantic',
    }));
  }
}
