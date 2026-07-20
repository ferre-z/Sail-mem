import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { MentalModelEngine } from '../../src/core/mental-model.ts';
import { BankManager } from '../../src/core/bank-manager.ts';

async function setup() {
  const storage = new SQLiteStorage({ path: ':memory:' });
  await storage.initialize();
  const memoryStore = new MemoryStore({ storage });
  const bankManager = new BankManager({ storage });
  const bank = await bankManager.create({ name: 'b', level: 'global' });
  return { storage, memoryStore, engine: new MentalModelEngine({ memoryStore }), bankId: bank.id };
}

describe('MentalModelEngine', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => { ctx = await setup(); });
  afterEach(async () => { await ctx.storage.close(); });

  it('creates mental models with source query metadata', async () => {
    const m = await ctx.engine.create({
      bankId: ctx.bankId,
      sourceQuery: 'How does Alice prefer to communicate?',
      content: 'Alice prefers async written communication over meetings',
    });
    expect(m.sourceQuery).toBe('How does Alice prefer to communicate?');
    expect(m.id).toBeDefined();
    expect(m.lastRefreshedAt).toBeDefined();
  });

  it('finds models by query match', async () => {
    await ctx.engine.create({
      bankId: ctx.bankId,
      sourceQuery: 'Alice communication',
      content: 'Async first',
    });
    const found = await ctx.engine.findByQuery(ctx.bankId, 'How does Alice like to communicate?');
    expect(found).not.toBeNull();
  });

  it('refreshes a model and updates lastRefreshedAt', async () => {
    const original = await ctx.engine.create({
      bankId: ctx.bankId,
      sourceQuery: 'alice style',
      content: 'Old content',
    });

    await new Promise((r) => setTimeout(r, 5));
    const refreshed = await ctx.engine.refresh(original.id, 'New content');
    expect(refreshed?.content).toBe('New content');
    expect(refreshed!.lastRefreshedAt.getTime()).toBeGreaterThanOrEqual(original.lastRefreshedAt.getTime());
  });

  it('lists models by bank', async () => {
    await ctx.engine.create({
      bankId: ctx.bankId,
      sourceQuery: 'q1',
      content: 'a',
    });
    await ctx.engine.create({
      bankId: ctx.bankId,
      sourceQuery: 'q2',
      content: 'b',
    });
    const all = await ctx.engine.listModels(ctx.bankId);
    expect(all).toHaveLength(2);
  });
});
