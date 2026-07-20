import type { Memory } from '../types/memory.js';

export const DEFAULT_DECAY_RATES: Record<Memory['type'], number> = {
  world_fact: 0.05,
  experience_fact: 0.08,
  observation: 0.03,
  mental_model: 0.01,
  opinion: 0.06,
};

export const DEFAULT_ACCESS_BOOST_CAP = 1.5;
export const ACCESS_BOOST_FACTOR = 0.1;

export function classifyMemoryType(type: Memory['type']): number {
  return DEFAULT_DECAY_RATES[type] ?? 0.05;
}

/**
 * Ebbinghaus forgetting curve.
 *
 * R(t) = stability * exp(-decayRate * hoursElapsed)
 *
 * Clamped to [0, 1].
 */
export function ebbinghausRetention(
  hoursElapsed: number,
  decayRate: number,
  stability: number = 1.0
): number {
  if (!Number.isFinite(hoursElapsed) || hoursElapsed < 0) hoursElapsed = 0;
  if (!Number.isFinite(decayRate) || decayRate < 0) decayRate = 0;
  if (decayRate === 0) return Math.max(0, Math.min(1, stability));
  const raw = stability * Math.exp(-decayRate * hoursElapsed);
  return Math.max(0, Math.min(1, raw));
}

export function applyAccessBoost(
  baseScore: number,
  accessCount: number,
  cap: number = DEFAULT_ACCESS_BOOST_CAP
): number {
  const logBoost = Math.log2(accessCount + 1) * ACCESS_BOOST_FACTOR;
  const boosted = baseScore * (1 + logBoost);
  return Math.min(cap, Math.max(0, boosted));
}

/**
 * Composite score for ranking memories. Higher = more relevant.
 * Combines Ebbinghaus retention, type-specific decay rates and
 * an access-frequency boost.
 */
export function calculateMemoryScore(memory: Memory): number {
  const decayRate = classifyMemoryType(memory.type);
  const lastSeen = memory.lastAccessedAt ?? memory.createdAt;
  const hoursElapsed = (Date.now() - lastSeen.getTime()) / 3_600_000;
  const retention = ebbinghausRetention(
    hoursElapsed,
    decayRate,
    memory.confidence
  );
  return applyAccessBoost(retention, memory.accessCount);
}

export interface DecayResult {
  memoryId: string;
  score: number;
  shouldEvict: boolean;
}

export function scoreBatch(
  memories: Memory[],
  evictionThreshold: number = 0.05
): DecayResult[] {
  const now = Date.now();
  return memories.map((m) => {
    const score = calculateMemoryScore(m);
    const ageHours = (now - (m.lastAccessedAt ?? m.createdAt).getTime()) / 3_600_000;
    return {
      memoryId: m.id,
      score,
      shouldEvict: score < evictionThreshold && ageHours > 24 * 7,
    };
  });
}
