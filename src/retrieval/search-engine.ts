import { SemanticSearch } from './semantic.js';
import type { SemanticSearchDeps } from './semantic.js';
import { KeywordSearch } from './keyword.js';
import type { KeywordSearchDeps } from './keyword.js';
import { GraphSearch } from './graph.js';
import type { GraphSearchDeps } from './graph.js';
import { TemporalSearch } from './temporal-search.js';
import type { TemporalSearchDeps } from './temporal-search.js';
import { getConfig } from '../config/index.js';
import { Memory } from '../types/memory.js';
import { ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidBankId(bankId: string): void {
  if (!UUID_RE.test(bankId)) {
    throw new ValidationError(`Invalid bankId: ${bankId}`);
  }
}

const DEFAULT_RRF_K = 60;

export interface SearchOptions {
  strategies?: ('semantic' | 'keyword' | 'graph' | 'temporal')[];
  maxResults?: number;
  minScore?: number;
  filters?: {
    type?: Memory['type'];
    dateRange?: { start: Date; end: Date };
    tags?: string[];
  };
}

export interface SearchResult {
  memory: Memory;
  score: number;
  strategy: string;
  metadata?: Record<string, unknown>;
}

export interface SearchEngineDeps {
  semantic?: SemanticSearch;
  keyword?: KeywordSearch;
  graph?: GraphSearch;
  temporal?: TemporalSearch;
}

export type {
  SemanticSearchDeps,
  KeywordSearchDeps,
  GraphSearchDeps,
  TemporalSearchDeps,
};

export class SearchEngine {
  private semantic: SemanticSearch;
  private keyword: KeywordSearch;
  private graph: GraphSearch;
  private temporal: TemporalSearch;

  constructor(deps: SearchEngineDeps = {}) {
    this.semantic = deps.semantic ?? new SemanticSearch();
    this.keyword = deps.keyword ?? new KeywordSearch();
    this.graph = deps.graph ?? new GraphSearch();
    this.temporal = deps.temporal ?? new TemporalSearch();
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.semantic.initialize(),
      this.keyword.initialize(),
      this.graph.initialize(),
      this.temporal.initialize(),
    ]);
  }

  async search(
    bankId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    if (!query || query.trim().length === 0) return [];

    const config = getConfig().retrieval;
    const strategies = options.strategies || [...config.strategies];
    const maxResults = clampLimit(options.maxResults ?? config.maxResults);
    const minScore = clampScore(options.minScore ?? config.minScore);

    const strategyResults = await this.runStrategies(strategies, bankId, query, maxResults);

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (let i = 0; i < strategyResults.length; i++) {
      for (const result of strategyResults[i]) {
        if (!seen.has(result.memory.id) && result.score >= minScore) {
          seen.add(result.memory.id);
          results.push({
            ...result,
            strategy: strategies[i],
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  async searchWithReciprocalRankFusion(
    bankId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    assertValidBankId(bankId);
    if (!query || query.trim().length === 0) return [];

    const config = getConfig().retrieval;
    const strategies = options.strategies || [...config.strategies];
    const maxResults = clampLimit(options.maxResults ?? config.maxResults);

    const allResults = new Map<
      string,
      { memory: Memory; scores: Map<string, number> }
    >();

    const strategyResults = await this.runStrategies(
      strategies,
      bankId,
      query,
      maxResults * 2
    );

    for (let s = 0; s < strategyResults.length; s++) {
      const strategyName = strategies[s];
      const results = strategyResults[s];
      for (let rank = 0; rank < results.length; rank++) {
        const memoryId = results[rank].memory.id;
        const existing = allResults.get(memoryId);
        if (existing) {
          existing.scores.set(strategyName, 1 / (rank + 1));
        } else {
          allResults.set(memoryId, {
            memory: results[rank].memory,
            scores: new Map([[strategyName, 1 / (rank + 1)]]),
          });
        }
      }
    }

    const finalResults: SearchResult[] = [];
    for (const [, { memory, scores }] of allResults) {
      let rrfScore = 0;
      for (const [, score] of scores) {
        rrfScore += 1 / (DEFAULT_RRF_K + 1 / score);
      }
      finalResults.push({
        memory,
        score: rrfScore,
        strategy: 'rrf',
      });
    }

    return finalResults.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  private async runStrategies(
    strategies: SearchOptions['strategies'] & string[],
    bankId: string,
    query: string,
    limit: number
  ): Promise<Array<SearchResult[]>> {
    const runOne = async (strategy: string): Promise<SearchResult[]> => {
      switch (strategy) {
        case 'semantic':
          return this.semantic.search(bankId, query, limit);
        case 'keyword':
          return this.keyword.search(bankId, query, limit);
        case 'graph':
          return this.graph.search(bankId, query, limit);
        case 'temporal':
          return this.temporal.search(bankId, query, limit);
        default:
          return [];
      }
    };
    return Promise.all(strategies.map(runOne));
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 10;
  if (value > 1000) return 1000;
  return Math.floor(value);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
