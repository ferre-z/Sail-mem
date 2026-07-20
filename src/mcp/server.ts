import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MemoryStore } from '../core/memory-store.js';
import { BankManager } from '../core/bank-manager.js';
import { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { SearchEngine } from '../retrieval/search-engine.js';
import { OpinionEngine } from '../core/opinion-engine.js';
import { ConsolidationEngine } from '../core/consolidation.js';
import { createStorage } from '../storage/factory.js';
import type { IStorage } from '../storage/types.js';
import { StorageError, SailMemError } from '../errors.js';

export interface McpServerOptions {
  storage?: IStorage;
  bankManager?: BankManager;
  memoryStore?: MemoryStore;
  searchEngine?: SearchEngine;
  knowledgeGraph?: KnowledgeGraph;
  opinionEngine?: OpinionEngine;
  consolidation?: ConsolidationEngine;
}

const VALID_MEMORY_TYPES = [
  'world_fact',
  'experience_fact',
  'observation',
  'mental_model',
  'opinion',
] as const;

const VALID_RECENT = ['hour', 'day', 'week', 'month', 'year', 'any'] as const;

export class SailMemMcpServer {
  private server: McpServer;
  private storage: IStorage | undefined;
  private bankManager: BankManager;
  private memoryStore: MemoryStore;
  private searchEngine: SearchEngine;
  private knowledgeGraph: KnowledgeGraph;
  private opinionEngine: OpinionEngine;
  private consolidation: ConsolidationEngine;

  constructor(options: McpServerOptions = {}) {
    this.server = new McpServer({
      name: 'sail-mem',
      version: '0.1.0',
    });

    this.storage = options.storage;
    this.bankManager = options.bankManager ?? new BankManager({ storage: options.storage });
    this.memoryStore = options.memoryStore ?? new MemoryStore({ storage: options.storage });
    this.searchEngine = options.searchEngine ?? new SearchEngine();
    this.knowledgeGraph =
      options.knowledgeGraph ?? new KnowledgeGraph({ storage: options.storage });
    this.opinionEngine = options.opinionEngine ?? new OpinionEngine({
      memoryStore: this.memoryStore,
    });
    this.consolidation =
      options.consolidation ?? new ConsolidationEngine({ memoryStore: this.memoryStore });

    if (options.storage) {
      this.storage = options.storage;
    }

    this.registerTools();
  }

  private async ensureReady(): Promise<void> {
    if (!this.storage) {
      this.storage = await createStorage({ provider: 'sqlite' });
      this.bankManager = new BankManager({ storage: this.storage });
      this.memoryStore = new MemoryStore({ storage: this.storage });
      this.knowledgeGraph = new KnowledgeGraph({ storage: this.storage });
    }
    await this.searchEngine.initialize?.();
  }

  private registerTools(): void {
    // memory_save
    this.server.registerTool(
      'memory_save',
      {
        description: 'Save a memory to a bank. Use this to remember facts about users, projects, or your actions.',
        inputSchema: {
          bankId: z.string().uuid(),
          type: z.enum(VALID_MEMORY_TYPES),
          content: z.string().min(1).max(10_000),
          confidence: z.number().min(0).max(1).optional(),
          tags: z.array(z.string()).optional(),
        },
      },
      async (args) => this.safe(async () => {
        const memory = await this.memoryStore.create({
          bankId: args.bankId,
          type: args.type,
          content: args.content,
          confidence: args.confidence,
          metadata: { tags: args.tags, source: 'mcp' },
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(memory, null, 2) }] };
      })
    );

    // memory_recall
    this.server.registerTool(
      'memory_recall',
      {
        description: 'Search memories by query. Returns the most relevant memories for a bank.',
        inputSchema: {
          bankId: z.string().uuid(),
          query: z.string().min(1),
          maxResults: z.number().int().min(1).max(100).optional(),
          strategies: z.array(z.enum(['semantic', 'keyword', 'graph', 'temporal'])).optional(),
        },
      },
      async (args) => this.safe(async () => {
        const results = await this.searchEngine.search(args.bankId, args.query, {
          maxResults: args.maxResults,
          strategies: args.strategies,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
      })
    );

    // memory_get
    this.server.registerTool(
      'memory_get',
      {
        description: 'Retrieve a single memory by ID.',
        inputSchema: { id: z.string().uuid() },
      },
      async (args) => this.safe(async () => {
        const memory = await this.memoryStore.getById(args.id);
        if (!memory) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Memory not found: ${args.id}` }],
          };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(memory, null, 2) }] };
      })
    );

    // memory_delete
    this.server.registerTool(
      'memory_delete',
      {
        description: 'Delete a memory by ID.',
        inputSchema: { id: z.string().uuid() },
      },
      async (args) => this.safe(async () => {
        await this.memoryStore.delete(args.id);
        return { content: [{ type: 'text' as const, text: `Deleted memory ${args.id}` }] };
      })
    );

    // memory_list
    this.server.registerTool(
      'memory_list',
      {
        description: 'List memories for a bank. Optionally filter by type.',
        inputSchema: {
          bankId: z.string().uuid(),
          type: z.enum(VALID_MEMORY_TYPES).optional(),
          limit: z.number().int().min(1).max(1000).optional(),
        },
      },
      async (args) => this.safe(async () => {
        const memories = args.type
          ? await this.memoryStore.listByType(args.bankId, args.type, args.limit)
          : await this.memoryStore.listByBank(args.bankId, args.limit);
        return { content: [{ type: 'text' as const, text: JSON.stringify(memories, null, 2) }] };
      })
    );

    // bank_create
    this.server.registerTool(
      'bank_create',
      {
        description: 'Create a new memory bank at any level of the hierarchy.',
        inputSchema: {
          name: z.string().min(1).max(200),
          level: z.enum(['global', 'user', 'project', 'thread']),
          parentId: z.string().uuid().optional(),
          mission: z.string().optional(),
        },
      },
      async (args) => this.safe(async () => {
        const bank = await this.bankManager.create({
          name: args.name,
          level: args.level,
          parentId: args.parentId,
          config: args.mission ? { mission: args.mission } : undefined,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(bank, null, 2) }] };
      })
    );

    // bank_list
    this.server.registerTool(
      'bank_list',
      {
        description: 'List banks, optionally filtered by hierarchy level.',
        inputSchema: {
          level: z.enum(['global', 'user', 'project', 'thread']).optional(),
        },
      },
      async (args) => this.safe(async () => {
        const banks = args.level
          ? await this.bankManager.listByLevel(args.level)
          : await this.bankManager.listAll();
        return { content: [{ type: 'text' as const, text: JSON.stringify(banks, null, 2) }] };
      })
    );

    // bank_hierarchy
    this.server.registerTool(
      'bank_hierarchy',
      {
        description: 'Get the full hierarchy path and children for a bank.',
        inputSchema: { bankId: z.string().uuid() },
      },
      async (args) => this.safe(async () => {
        const hierarchy = await this.bankManager.getHierarchy(args.bankId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(hierarchy, null, 2) }] };
      })
    );

    // opinion_form
    this.server.registerTool(
      'opinion_form',
      {
        description: 'Form a confidence-weighted opinion about an entity, with optional supporting evidence.',
        inputSchema: {
          bankId: z.string().uuid(),
          targetEntity: z.string().min(1),
          content: z.string().min(1).max(2000),
          initialConfidence: z.number().min(0).max(1).default(0.5),
          evidenceIds: z.array(z.string().uuid()).optional(),
        },
      },
      async (args) => this.safe(async () => {
        const opinion = await this.opinionEngine.formOpinion({
          bankId: args.bankId,
          targetEntity: args.targetEntity,
          content: args.content,
          initialConfidence: args.initialConfidence,
          evidenceIds: args.evidenceIds,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(opinion, null, 2) }] };
      })
    );

    // consolidate
    this.server.registerTool(
      'consolidate',
      {
        description: 'Merge multiple memories into a single observation with evidence citations.',
        inputSchema: {
          bankId: z.string().uuid(),
          memoryIds: z.array(z.string().uuid()).min(1),
        },
      },
      async (args) => this.safe(async () => {
        const observation = await this.consolidation.consolidate(args.bankId, args.memoryIds);
        return { content: [{ type: 'text' as const, text: JSON.stringify(observation, null, 2) }] };
      })
    );

    // graph_entities
    this.server.registerTool(
      'graph_entities',
      {
        description: 'Create or look up an entity in the knowledge graph for a bank.',
        inputSchema: {
          bankId: z.string().uuid(),
          name: z.string().min(1),
          type: z.string().min(1),
        },
      },
      async (args) => this.safe(async () => {
        const existing = await this.knowledgeGraph.findEntityByName(args.name, args.bankId);
        const entity = existing ?? (await this.knowledgeGraph.createEntity({
          bankId: args.bankId,
          name: args.name,
          type: args.type,
        }));
        return { content: [{ type: 'text' as const, text: JSON.stringify(entity, null, 2) }] };
      })
    );

    // stats
    this.server.registerTool(
      'stats',
      {
        description: 'Get total count of memories, banks and entities in storage.',
        inputSchema: {},
      },
      async () => this.safe(async () => {
        if (!this.storage) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Storage not initialized' }],
          };
        }
        const stats = await this.storage.getStats();
        return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
      })
    );
  }

  private async safe(
    fn: () => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    await this.ensureReady();
    try {
      return await fn();
    } catch (err) {
      const message =
        err instanceof SailMemError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${message}` }],
      };
    }
  }

  get mcp(): McpServer {
    return this.server;
  }

  async connectStdio(): Promise<void> {
    await this.ensureReady();
    await this.server.connect(new StdioServerTransport());
  }

  async close(): Promise<void> {
    await this.server.close();
    if (this.storage) {
      await this.storage.close();
      this.storage = undefined;
    }
  }
}

export function createMcpServer(options?: McpServerOptions): SailMemMcpServer {
  return new SailMemMcpServer(options);
}

export { VALID_MEMORY_TYPES, VALID_RECENT };
export { StorageError };
