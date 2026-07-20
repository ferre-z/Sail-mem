export const defaults = {
  database: {
    host: 'localhost',
    port: 5432,
    database: 'sail_mem',
    user: 'postgres',
    password: '',
  },
  storage: {
    provider: 'sqlite' as const,
    sqlitePath: './sail-mem.db',
  },
  embeddings: {
    provider: 'local' as const,
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    cloud: {
      provider: 'openai' as const,
      model: 'text-embedding-3-small',
      apiKey: '',
    },
  },
  sync: {
    provider: 'github' as const,
    repoPath: './memory-sync',
    branch: 'main',
    commitMessage: 'chore: sync memory state',
  },
  retrieval: {
    maxResults: 10,
    minScore: 0.5,
    tokenBudget: 'mid' as const,
    strategies: ['semantic', 'keyword', 'graph', 'temporal'] as const,
  },
  consolidation: {
    enabled: true,
    minEvidenceCount: 3,
    similarityThreshold: 0.85,
    autoIntervalMs: 3_600_000, // 1 hour
  },
  decay: {
    enabled: false,
    halfLifeHours: 168, // 1 week default
  },
  mcp: {
    transport: 'stdio' as const,
    port: 3000,
  },
};
