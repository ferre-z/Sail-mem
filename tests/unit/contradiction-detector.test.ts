import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { ContradictionDetector } from '../../src/core/contradiction-detector.ts';

async function setup() {
  const storage = new SQLiteStorage({ path: ':memory:' });
  await storage.initialize();
  const memoryStore = new MemoryStore({ storage });
  const bankManager = new BankManager({ storage });
  const bank = await bankManager.create({ name: 'b', level: 'global' });
  return { storage, memoryStore, bankId: bank.id, detector: new ContradictionDetector({ memoryStore }) };
}

describe('ContradictionDetector', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => { ctx = await setup(); });
  afterEach(async () => { await ctx.storage.close(); });

  it('detects negation mismatches on overlapping content', async () => {
    const a = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Alice likes Python as her primary language',
    });
    const b = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Alice does not like Python as her primary language',
    });
    const c = await ctx.detector.detect(a, b);
    expect(c).not.toBeNull();
    expect(c?.reason).toBe('negation-mismatch');
  });

  it('does not flag two non-negated facts as contradictions', async () => {
    const a = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Alice likes Python',
    });
    const b = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Bob likes Python',
    });
    const c = await ctx.detector.detect(a, b);
    expect(c).toBeNull();
  });

  it('rejects cross-bank detection', async () => {
    const a = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'x',
    });
    const otherBankId = (await new BankManager({ storage: ctx.storage }).create({
      name: 'b2',
      level: 'global',
    })).id;
    const b = await ctx.memoryStore.create({
      bankId: otherBankId,
      type: 'world_fact',
      content: 'not x',
    });
    await expect(ctx.detector.detect(a, b)).rejects.toThrow(/Cross-bank/);
  });

  it('resolves by keeping the higher-evidence fact', async () => {
    const a = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Alice likes Python',
      metadata: { evidenceCount: 5 },
    });
    const b = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'world_fact',
      content: 'Alice does not like Python',
      metadata: { evidenceCount: 1 },
    });
    const c = await ctx.detector.detect(a, b);
    expect(c).not.toBeNull();
    if (!c) return;
    const resolution = await ctx.detector.resolve(c);
    expect(resolution.keepId).toBe(a.id);
    expect(resolution.discardId).toBe(b.id);

    const stillThere = await ctx.memoryStore.getById(b.id);
    expect(stillThere).toBeNull();
  });
});
