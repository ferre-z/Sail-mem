import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { OpinionEngine } from '../../src/core/opinion-engine.ts';
import { calculateMemoryScore } from '../../src/core/decay.ts';

async function setup() {
  const storage = new SQLiteStorage({ path: ':memory:' });
  await storage.initialize();
  const bankManager = new BankManager({ storage });
  const memoryStore = new MemoryStore({ storage });
  const engine = new OpinionEngine({ memoryStore });
  const bank = await bankManager.create({ name: 'b', level: 'global' });
  return { storage, memoryStore, engine, bankId: bank.id };
}

describe('OpinionEngine (SQLite)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.storage.close();
  });

  it('forms a new opinion with the requested confidence', async () => {
    const o = await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice prefers Python',
      initialConfidence: 0.6,
    });

    expect(o.confidence).toBe(0.6);
    expect(o.metadata.targetEntity).toBe('Alice');
    expect(o.metadata.evidenceIds).toEqual([]);
    expect(o.metadata.freshness).toBe('new');
  });

  it('updates confidence up with supporting evidence', async () => {
    const o = await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice likes Python',
      initialConfidence: 0.3,
    });

    const ev1 = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'experience_fact',
      content: 'Alice uses Python at work',
      confidence: 0.9,
    });
    const ev2 = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'experience_fact',
      content: 'Alice uses Python for ML',
      confidence: 0.7,
    });

    const updated = await ctx.engine.updateConfidence(o.id, [ev1, ev2]);
    expect(updated).not.toBeNull();
    expect(updated!.confidence).toBeGreaterThan(0.3);
    expect(updated!.metadata.evidenceCount).toBe(2);
  });

  it('discounts confidence when contradicting evidence arrives', async () => {
    const o = await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice likes Python',
      initialConfidence: 0.5,
    });

    const contra = await ctx.memoryStore.create({
      bankId: ctx.bankId,
      type: 'experience_fact',
      content: 'Alice wrote a strongly-typed Go service',
      confidence: 0.9,
    });

    const updated = await ctx.engine.updateConfidence(o.id, [], [contra]);
    expect(updated!.metadata.contradictingIds).toContain(contra.id);
  });

  it('resolves a contradiction by merging into the higher-confidence opinion', async () => {
    const a = await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice prefers TypeScript',
      initialConfidence: 0.9,
    });
    const b = await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice prefers Python',
      initialConfidence: 0.3,
    });

    const resolution = await ctx.engine.resolveContradiction(a, b);
    expect(resolution.discarded).toContain(b.id);
    expect(resolution.merged.confidence).toBeGreaterThan(0);

    const remaining = await ctx.memoryStore.getById(b.id);
    expect(remaining).toBeNull();
  });

  it('returns opinions about the same entity', async () => {
    await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice likes Python',
    });
    await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Alice',
      content: 'Alice writes TS at work',
    });
    await ctx.engine.formOpinion({
      bankId: ctx.bankId,
      targetEntity: 'Bob',
      content: 'Bob likes Go',
    });

    const aboutAlice = await ctx.engine.findOpinionsAbout(ctx.bankId, 'Alice');
    expect(aboutAlice).toHaveLength(2);
    expect(aboutAlice.every((o) => o.metadata.targetEntity === 'Alice')).toBe(true);
  });
});

describe('calculateMemoryScore integration', () => {
  it('returns a value in [0, cap]', () => {
    for (let access = 0; access < 100; access++) {
      const score = calculateMemoryScore({
        id: 'a',
        bankId: 'b',
        type: 'world_fact',
        content: 'x',
        metadata: {},
        confidence: 0.5,
        accessCount: access,
        createdAt: new Date(Date.now() - 1000),
        updatedAt: new Date(Date.now() - 1000),
      });
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1.5);
    }
  });
});
