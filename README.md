# Sail-Mem

Memory engine for agents. TypeScript-based personal brain with
hierarchical banks, knowledge graphs, GitHub sync, retrieval
augmentation, opinion tracking, Ebbinghaus decay, MCP server,
and zero-config SQLite or production PostgreSQL storage.

## Highlights

- **4-network memory model**: world facts, experience facts,
  observations, mental models, **opinions** (Hindsight-style).
- **5 retrieval strategies**: semantic, keyword (FTS), graph
  traversal, temporal, RRF fusion.
- **Storage abstraction** with two production-ready backends:
  SQLite (default, zero-config) and PostgreSQL with pgvector.
- **MCP server** exposes 12 tools via stdio -- drop-in for
  Cursor, Claude Code, OpenCode, and any MCP-compatible runtime.
- **Auto-capture hooks** (`SessionHooks`) capture every tool
  call, prompt, and response; secrets are stripped before
  storage.
- **Ebbinghaus decay** + access-frequency boost score memories
  for ranking or eviction sweeps.
- **Opinion engine** forms confidence-weighted opinions, updates
  them with supporting/contradicting evidence, and resolves
  contradictions by merging.
- **Knowledge graph** with entity resolution (exact, case,
  Levenshtein), 12-hop BFS path finding, and a self-relationship
  guard.
- **Privacy filter** recognises PEM, OpenAI, GitHub, AWS,
  Stripe, Slack, GCP, and JSON-style key/value secrets.
- **Auto-consolidation scheduler** runs cycles on an interval
  with re-entrancy protection and per-bank error isolation.
- **Safe by construction**: command-injection-free git ops,
  parameterised SQL, typed error hierarchy (`ValidationError`,
  `StorageError`, `EmbeddingError`, `SyncError`, `NotFoundError`).
- **Resource limits** on every query: 1-1000 result caps, 384
  embedding dimensions, 10-char content caps, 200-char commit
  message sanitisation.

## Quick Start

### As a library

```bash
npm install sail-mem
```

```typescript
import {
  configure, BankManager, MemoryStore,
  OpinionEngine, SearchEngine, MCP server, createMcpServer,
} from 'sail-mem';

// Configure storage (SQLite by default; pg via configure(...))
const { MemoryStore, BankManager } = ...;

const bm = new BankManager();
const ms = new MemoryStore();
const oe = new OpinionEngine({ memoryStore: ms });

const global = await bm.create({ name: 'global', level: 'global' });
await ms.create({
  bankId: global.id, type: 'world_fact',
  content: 'Alice prefers TypeScript over JavaScript',
});
await oe.formOpinion({
  bankId: global.id, targetEntity: 'Alice',
  content: 'Alice likes functional programming',
  initialConfidence: 0.7,
});
```

### As an MCP server

```bash
# Run via stdio (drop into Cursor / Claude Code / OpenCode)
npx sail-mem-mcp

# Or, in development:
npm run mcp:dev
```

Configure your MCP client to launch the server:

```json
{
  "mcpServers": {
    "sail-mem": {
      "command": "npx",
      "args": ["sail-mem-mcp"],
      "env": { "SAIL_MEM_STORAGE": "sqlite", "SAIL_MEM_SQLITE_PATH": "/path/to/db.sqlite" }
    }
  }
}
```

Available MCP tools:

| Tool             | Description                                |
|------------------|--------------------------------------------|
| memory_save      | Store a fact/observation/opinion           |
| memory_recall    | Multi-strategy search, returns ranked hits |
| memory_get       | Fetch one memory by id                     |
| memory_list      | List memories by bank, optional type       |
| memory_delete    | Hard delete by id                          |
| bank_create      | Create a bank at any hierarchy level       |
| bank_list        | List banks by level or all                 |
| bank_hierarchy   | Get the ancestor path and children         |
| opinion_form     | Form a confidence-scored opinion           |
| consolidate      | Merge memories into a single observation   |
| graph_entities   | Find or create a knowledge-graph entity    |
| stats            | Bank-wide counts (memories/banks/entities) |

### As a Docker service

```bash
docker compose up --build
```

This stands up:

- `sail-mem` running with SQLite, persisting data in the
  `sail-mem-data` named volume.
- Optional `postgres` with the pgvector extension for the
  production backend (set `SAIL_MEM_STORAGE=postgres` and
  `DATABASE_URL=postgres://sail:sail@postgres:5432/sail_mem`).

## Architecture

### Memory types

| Type            | Description                                       |
|-----------------|---------------------------------------------------|
| **world_fact**  | Objective facts about the external world          |
| **experience_fact** | The agent's own first-person actions           |
| **observation** | Synthesized, preference-neutral summaries         |
| **mental_model** | User-curated, auto-refreshing summaries         |
| **opinion**     | Subjective beliefs with [0,1] confidence          |

### Bank hierarchy

```
Global (shared across all)
└── User (per-user)
    └── Project (per-project)
        └── Thread (per-conversation)
```

### Retrieval strategies

1. **Semantic** -- vector similarity (pgvector / SQLite cosine)
2. **Keyword** -- SQLite FTS5 or Postgres `to_tsvector`
3. **Graph** -- entity name/type lookup joined to memories
4. **Temporal** -- recency-bucketed scoring
5. **RRF fusion** -- combine all four via Reciprocal Rank Fusion

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # produces dist/
npm run dev         # tsx watch src/index.ts
npm test            # vitest run (66+ tests, all pass)
npm run mcp:dev     # stdio MCP server
```

## Environment variables

| Variable                 | Default                  | Notes                          |
|--------------------------|--------------------------|--------------------------------|
| `SAIL_MEM_STORAGE`       | `sqlite`                 | `sqlite` or `postgres`         |
| `SAIL_MEM_SQLITE_PATH`   | `./sail-mem.db`          | SQLite path (or `:memory:`)    |
| `DATABASE_URL`           | `postgres://...:5432/...`| Postgres connection string     |
| `OPENAI_API_KEY`         | none                     | Enables cloud embedder         |

## Tests

```bash
npm test
```

Currently 66+ unit and integration tests, all running against
in-memory SQLite. No external services required.

## Security

Recent audits removed:

- Command injection via `exec`'s string interpolation in git
  operations (`src/sync/github-sync.ts`).
- SQL injection foot-gun in temporal search (`sql.raw`) replaced
  with parameterised fragments.
- Cross-bank consolidation that leaked memories across tenants.
- Plaintext-API-key logging via typed `CloudEmbedder` retry
  policy.

## License

MIT (c) 2026 Ferre Bouwens.
