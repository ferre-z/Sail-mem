import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { KnowledgeGraph } from '../../src/graph/knowledge-graph.ts';
import { EntityResolver } from '../../src/core/entity-resolver.ts';
import { BankManager } from '../../src/core/bank-manager.ts';

async function setup() {
  const storage = new SQLiteStorage({ path: ':memory:' });
  await storage.initialize();
  const bankManager = new BankManager({ storage });
  const bank = await bankManager.create({ name: 'b', level: 'global' });
  const knowledgeGraph = new KnowledgeGraph({ storage });
  return {
    storage,
    bankId: bank.id,
    knowledgeGraph,
    resolver: new EntityResolver({ knowledgeGraph }),
  };
}

describe('EntityResolver', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => { ctx = await setup(); });
  afterEach(async () => { await ctx.storage.close(); });

  it('resolves exact matches with score 1.0', async () => {
    const e = await ctx.knowledgeGraph.createEntity({
      bankId: ctx.bankId,
      name: 'Alice',
      type: 'person',
    });
    const matches = await ctx.resolver.resolveAliases('Alice', ctx.bankId);
    expect(matches[0].entity.id).toBe(e.id);
    expect(matches[0].matchKind).toBe('exact');
    expect(matches[0].score).toBe(1.0);
  });

  it('detects near-matches via Levenshtein distance', async () => {
    await ctx.knowledgeGraph.createEntity({
      bankId: ctx.bankId,
      name: 'Alice',
      type: 'person',
    });
    const matches = await ctx.resolver.resolveAliases('Aliec', ctx.bankId, );
    expect(matches.length).toBeGreaterThan(0);
    const lev = matches.find((m) => m.matchKind === 'levenshtein');
    expect(lev).toBeDefined();
  });

  it('rejects empty names', async () => {
    await expect(ctx.resolver.resolveAliases('', ctx.bankId)).rejects.toThrow();
  });
});
