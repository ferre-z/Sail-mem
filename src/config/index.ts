import { defaults } from './defaults.js';

export type Config = typeof defaults;

let config: Config = { ...defaults };

export function configure(overrides: Partial<Config>): void {
  config = {
    ...config,
    ...overrides,
    database: { ...config.database, ...overrides.database },
    embeddings: { ...config.embeddings, ...overrides.embeddings },
    sync: { ...config.sync, ...overrides.sync },
    retrieval: { ...config.retrieval, ...overrides.retrieval },
    consolidation: { ...config.consolidation, ...overrides.consolidation },
  };
}

export function getConfig(): Config {
  return config;
}

export function resetConfig(): void {
  config = { ...defaults };
}
