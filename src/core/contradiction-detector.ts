import { MemoryStore } from './memory-store.js';
import type { Memory } from '../types/memory.js';
import { ValidationError } from '../errors.js';

const NEGATIVE_CUES = new Set([
  'not', "n't", 'never', 'no longer', 'isn\'t', 'aren\'t', 'don\'t',
  'doesn\'t', 'didn\'t', 'won\'t', 'wouldn\'t', 'shouldn\'t', 'can\'t',
  'cannot', 'neither', 'nor', 'without',
]);

export interface Contradiction {
  memoryA: Memory;
  memoryB: Memory;
  reason: 'negation-mismatch' | 'semantic-similarity';
  score: number;
}

export interface ContradictionDeps {
  memoryStore: MemoryStore;
}

export class ContradictionDetector {
  private memoryStore: MemoryStore;

  constructor(deps: ContradictionDeps) {
    this.memoryStore = deps.memoryStore;
  }

  async findContradictions(bankId: string): Promise<Contradiction[]> {
    if (!bankId.match(/^[0-9a-f-]{36}$/i)) {
      throw new ValidationError('Invalid bankId');
    }
    const memories = await this.memoryStore.listByBank(bankId, 1000);
    const out: Contradiction[] = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i];
        const b = memories[j];
        if (a.type === 'opinion' || b.type === 'opinion') continue;
        const c = await this.detect(a, b);
        if (c) out.push(c);
      }
    }
    return out;
  }

  async detect(a: Memory, b: Memory): Promise<Contradiction | null> {
    if (a.bankId !== b.bankId) {
      throw new ValidationError('Cross-bank contradiction detection is not allowed');
    }
    const aHasNeg = hasNegationCue(a.content);
    const bHasNeg = hasNegationCue(b.content);
    if (aHasNeg !== bHasNeg) {
      const tokensA = tokenize(a.content);
      const tokensB = tokenize(b.content);
      const overlap = jaccard(tokensA, tokensB);
      if (overlap >= 0.2) {
        return {
          memoryA: a,
          memoryB: b,
          reason: 'negation-mismatch',
          score: overlap,
        };
      }
    }
    return null;
  }

  async resolve(c: Contradiction): Promise<{ keepId: string; discardId: string }> {
    const aId = c.memoryA.id;
    const bId = c.memoryB.id;
    const evidenceA = c.memoryA.metadata.evidenceCount ?? c.memoryA.accessCount;
    const evidenceB = c.memoryB.metadata.evidenceCount ?? c.memoryB.accessCount;
    const [keepId, discardId] =
      evidenceA >= evidenceB ? [aId, bId] : [bId, aId];
    await this.memoryStore.delete(discardId);
    return { keepId, discardId };
  }
}

function hasNegationCue(text: string): boolean {
  const lower = text.toLowerCase();
  for (const cue of NEGATIVE_CUES) {
    if (lower.includes(cue)) return true;
  }
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  return inter / (sa.size + sb.size - inter);
}
