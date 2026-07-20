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
import { 
  configure, 
  MemoryStore, 
  BankManager, 
  SearchEngine,
  KnowledgeGraph,
  GitHubSync 
} from 'sail-mem';

// Configure the system
configure({
  database: {
    host: 'localhost',
    port: 5432,
    database: 'sail_mem',
    user: 'postgres',
    password: '',
  },
});

// Create a bank hierarchy
const bankManager = new BankManager();
const global = await bankManager.create({ 
  name: 'global', 
  level: 'global' 
});
const user = await bankManager.create({ 
  name: 'alice', 
  level: 'user', 
  parentId: global.id 
});

// Store memories
const memoryStore = new MemoryStore();
await memoryStore.create({
  bankId: user.id,
  type: 'world_fact',
  content: 'Alice prefers TypeScript over JavaScript',
});

// Search memories
const searchEngine = new SearchEngine();
const results = await searchEngine.search(user.id, 'Alice preferences');
```

## Architecture

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| **World Fact** | Objective facts | "Alice works at Google" |
| **Experience Fact** | Agent's own actions | "I recommended Python to Bob" |
| **Observation** | Consolidated knowledge | "Alice is a software engineer" |
| **Mental Model** | User-curated summaries | "Team communication best practices" |

### Bank Hierarchy

```
Global (shared across all)
└── User (per-user)
    └── Project (per-project)
        └── Thread (per-conversation)
```

### Retrieval Strategies

1. **Semantic**: Vector similarity using pgvector
2. **Keyword**: PostgreSQL full-text search
3. **Graph**: Entity relationship traversal
4. **Temporal**: Time-based filtering

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

## Database Setup

1. Install PostgreSQL with pgvector extension
2. Create a database:
```sql
CREATE DATABASE sail_mem;
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Run migrations:
```bash
npx drizzle-kit push
```

## License

MIT
