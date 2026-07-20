import { SemanticSearch } from './semantic.js';
import { KeywordSearch } from './keyword.js';
import { GraphSearch } from './graph.js';
import { TemporalSearch } from './temporal-search.js';
import { getConfig } from '../config/index.js';
import { Memory } from '../types/memory.js';

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

export class SearchEngine {
  private semantic: SemanticSearch;
  private keyword: KeywordSearch;
  private graph: GraphSearch;
  private temporal: TemporalSearch;

  constructor() {
    this.semantic = new SemanticSearch();
    this.keyword = new KeywordSearch();
    this.graph = new GraphSearch();
    this.temporal = new TemporalSearch();
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.semantic.initialize(),
      this.keyword.initialize(),
      this.graph.initialize(),
      this.temporal.initialize(),
    ]);
  }

  async search(bankId: string, query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const config = getConfig().retrieval;
    const strategies = options.strategies || [...config.strategies];
    const maxResults = options.maxResults || config.maxResults;
    const minScore = options.minScore || config.minScore;

    const results: SearchResult[] = [];

    // Run strategies in parallel
    const strategyPromises = strategies.map(async (strategy) => {
      switch (strategy) {
        case 'semantic':
          return this.semantic.search(bankId, query, maxResults);
        case 'keyword':
          return this.keyword.search(bankId, query, maxResults);
        case 'graph':
          return this.graph.search(bankId, query, maxResults);
        case 'temporal':
          return this.temporal.search(bankId, query, maxResults);
        default:
          return [];
      }
    });

    const strategyResults = await Promise.all(strategyPromises);

    // Merge and deduplicate results
    const seen = new Set<string>();
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

    // Sort by score and limit
    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  async searchWithReciprocalRankFusion(
    bankId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const config = getConfig().retrieval;
    const strategies = options.strategies || [...config.strategies];
    const maxResults = options.maxResults || config.maxResults;

    const allResults: Map<string, { memory: Memory; scores: Map<string, number> }> = new Map();

    // Collect results from all strategies
    for (const strategy of strategies) {
      let results: SearchResult[] = [];
      switch (strategy) {
        case 'semantic':
          results = await this.semantic.search(bankId, query, maxResults * 2);
          break;
        case 'keyword':
          results = await this.keyword.search(bankId, query, maxResults * 2);
          break;
        case 'graph':
          results = await this.graph.search(bankId, query, maxResults * 2);
          break;
        case 'temporal':
          results = await this.temporal.search(bankId, query, maxResults * 2);
          break;
      }

      for (let rank = 0; rank < results.length; rank++) {
        const existing = allResults.get(results[rank].memory.id);
        if (existing) {
          existing.scores.set(strategy, 1 / (rank + 1));
        } else {
          allResults.set(results[rank].memory.id, {
            memory: results[rank].memory,
            scores: new Map([[strategy, 1 / (rank + 1)]]),
          });
        }
      }
    }

    // Calculate RRF score: sum of 1/(k + rank) for each strategy
    const k = 60; // Standard RRF constant
    const finalResults: SearchResult[] = [];

    for (const [, { memory, scores }] of allResults) {
      let rrfScore = 0;
      for (const [, score] of scores) {
        rrfScore += 1 / (k + 1 / score);
      }
      finalResults.push({
        memory,
        score: rrfScore,
        strategy: 'rrf',
      });
    }

    return finalResults.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
}
