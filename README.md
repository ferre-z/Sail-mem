# Sail-Mem

Memory engine for agents - TypeScript-based personal brain with hierarchical banks, knowledge graphs, and GitHub sync.

## Features

- **Hierarchical Memory Banks**: Global → User → Project → Thread
- **4 Memory Types**: World Facts, Experience Facts, Observations, Mental Models
- **Multi-Strategy Retrieval**: Semantic, Keyword, Graph, Temporal
- **Knowledge Graph**: Entity extraction and relationship mapping
- **Observation Consolidation**: Auto-merge related facts with evidence tracking
- **GitHub Sync**: Sync memory state via git commits
- **Hybrid Embeddings**: Local ONNX or cloud APIs

## Quick Start

```bash
npm install sail-mem
```

```typescript
import { configure } from 'sail-mem';

configure({
  database: {
    host: 'localhost',
    port: 5432,
    database: 'sail_mem',
    user: 'postgres',
    password: '',
  },
});
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## License

MIT
