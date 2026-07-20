import { describe, expect, it } from 'vitest';
import {
  ebbinghausRetention,
  applyAccessBoost,
  calculateMemoryScore,
  classifyMemoryType,
} from '../../src/core/decay.ts';
import type { Memory } from '../../src/types/memory.ts';

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const base: Memory = {
    id: '00000000-0000-0000-0000-000000000001',
    bankId: '00000000-0000-0000-0000-000000000099',
    type: 'world_fact',
    content: 'test',
    metadata: {},
    confidence: 0.7,
    accessCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...base, ...overrides };
}

describe('Ebbinghaus retention', () => {
  it('returns stability ~ 1.0 immediately after reinforcement', () => {
    const r = ebbinghausRetention(0, 0.05);
    expect(r).toBeCloseTo(1.0, 2);
  });

  it('decays monotonically with elapsed time', () => {
    const r1 = ebbinghausRetention(1, 0.05);
    const r24 = ebbinghausRetention(24, 0.05);
    const r168 = ebbinghausRetention(168, 0.05);
    expect(r1).toBeGreaterThan(r24);
    expect(r24).toBeGreaterThan(r168);
  });

  it('always returns a value in [0, 1]', () => {
    for (const hours of [0, 1, 24, 168, 720, 8760]) {
      const r = ebbinghausRetention(hours, 0.5);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('calculateMemoryScore', () => {
  it('ranks frequently-accessed memories above neglected ones', () => {
    const popular = makeMemory({
      accessCount: 50,
      lastAccessedAt: new Date(),
    });
    const neglected = makeMemory({
      accessCount: 1,
      lastAccessedAt: new Date(Date.now() - 30 * 86_400_000), // 30 days ago
    });
    const popularScore = calculateMemoryScore(popular);
    const neglectedScore = calculateMemoryScore(neglected);
    expect(popularScore).toBeGreaterThan(neglectedScore);
  });

  it('orders by memory type decay rate', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    const mentalModel = makeMemory({
      type: 'mental_model',
      lastAccessedAt: tenDaysAgo,
      confidence: 0.9,
    });
    const experience = makeMemory({
      type: 'experience_fact',
      lastAccessedAt: tenDaysAgo,
      confidence: 0.9,
    });
    expect(calculateMemoryScore(mentalModel)).toBeGreaterThan(
      calculateMemoryScore(experience)
    );
  });
});

describe('classifyMemoryType', () => {
  it('returns the configured decay rate for each type', () => {
    expect(typeof classifyMemoryType('world_fact')).toBe('number');
    expect(typeof classifyMemoryType('experience_fact')).toBe('number');
    expect(typeof classifyMemoryType('observation')).toBe('number');
    expect(typeof classifyMemoryType('mental_model')).toBe('number');
  });
});

describe('applyAccessBoost', () => {
  it('boosts score with access count', () => {
    const base = 0.5;
    const boosted = applyAccessBoost(base, 0);
    const moreUsed = applyAccessBoost(base, 100);
    expect(moreUsed).toBeGreaterThan(boosted);
  });
});
