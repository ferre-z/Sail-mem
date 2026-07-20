import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { TieredConsolidation } from '../../src/core/tiered-consolidation.ts';

async function setup() {
  const storage = new SQLiteStorage({ path: ':memory:' });
  await storage.initialize();
  const memoryStore = new MemoryStore({ storage });
  const bankManager = new BankManager({ storage });
  const bank = await bankManager.create({ name: 'b', level: 'global' });
  return { storage, memoryStore, bankId: bank.id };
}

describe('TieredConsolidation', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => { ctx = await setup(); });
  afterEach(async () => { await ctx.storage.close(); });

  it('compresses working memories into an episodic session summary', async () => {
    for (let i = 0; i < 5; i++) {
      await ctx.memoryStore.create({
        bankId: ctx.bankId,
        type: 'experience_fact',
        content: `Tool action ${i + 1}`,
        metadata: { tier: 'working' },
      });
    }
    const tiered = new TieredConsolidation(ctx.memoryStore);
    const result = await tiered.compressToEpisodic(ctx.bankId);
    expect(result.tier).toBe('episodic');
    expect(result.summary).toContain('Session summary');

    const archived = (await ctx.memoryStore.listByBank(ctx.bankId)).filter(
      (m) => (m.metadata as Record<string, unknown>).tier === 'archived-working'
    );
    expect(archived.length).toBe(5);
  });

  it('compresses episodic memories into a semantic observation', async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.memoryStore.create({
        bankId: ctx.bankId,
        type: 'experience_fact',
        content: `Episode ${i + 1}: Alice likes TypeScript`,
        metadata: { tier: 'episodic' },
      });
    }
    const tiered = new TieredConsolidation(ctx.memoryStore);
    const result = await tiered.compressEpisodicToSemantic(ctx.bankId);
    expect(result.tier).toBe('semantic');
    expect(result.summary).toContain('Alice');
  });

  it('detects recurring workflows as procedural patterns', async () => {
    for (let i = 0; i < 4; i++) {
      await ctx.memoryStore.create({
        bankId: ctx.bankId,
        type: 'experience_fact',
        content: `Iteration ${i + 1}`,
        metadata: { tier: 'episodic', toolSequence: ['search', 'click', 'fill'] },
      });
    }
    const tiered = new TieredConsolidation(ctx.memoryStore);
    const patterns = await tiered.detectProceduralPatterns(ctx.bankId);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].tier).toBe('procedural');
  });

  it('throws when there are no working memories', async () => {
    const tiered = new TieredConsolidation(ctx.memoryStore);
    await expect(tiered.compressToEpisodic(ctx.bankId)).rejects.toThrow();
  });
});
