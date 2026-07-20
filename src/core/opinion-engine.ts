import type { Memory, Opinion } from '../types/memory.js';
import type { MemoryStore } from './memory-store.js';
import type { EmbeddingProvider } from '../embeddings/embedder.js';
import { ValidationError } from '../errors.js';
import { calculateMemoryScore } from './decay.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export interface FormOpinionInput {
  bankId: string;
  targetEntity: string;
  content: string;
  initialConfidence?: number;
  evidenceIds?: string[];
  embedding?: number[];
}

export interface OpinionEngineDeps {
  memoryStore: MemoryStore;
  embedder?: EmbeddingProvider;
}

export interface ContradictionResolution {
  merged: Opinion;
  discarded: string[];
}

/**
 * 4-Network memory model: opinion memory carries confidence +
 * the evidence trail that produced it. Confidence evolves as
 * supporting or contradicting evidence arrives.
 */
export class OpinionEngine {
  private memoryStore: MemoryStore;
  private embedder?: EmbeddingProvider;

  constructor(deps: OpinionEngineDeps) {
    this.memoryStore = deps.memoryStore;
    this.embedder = deps.embedder;
  }

  async formOpinion(input: FormOpinionInput): Promise<Opinion> {
    assertUuid(input.bankId, 'bankId');
    if (!input.targetEntity) {
      throw new ValidationError('Opinion targetEntity is required');
    }
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('Opinion content cannot be empty');
    }

    const initialConfidence = clampConfidence(
      input.initialConfidence ?? 0.5
    );

    const memory = await this.memoryStore.create({
      bankId: input.bankId,
      type: 'opinion',
      content: input.content,
      confidence: initialConfidence,
      embedding: input.embedding,
      metadata: {
        targetEntity: input.targetEntity,
        confidence: initialConfidence,
        evidenceIds: input.evidenceIds ?? [],
        lastUpdated: new Date(),
        freshness: 'new',
        evidenceCount: input.evidenceIds?.length ?? 0,
      },
    });

    return toOpinion(memory);
  }

  async findOpinionsAbout(
    bankId: string,
    targetEntity: string
  ): Promise<Opinion[]> {
    assertUuid(bankId, 'bankId');
    if (!targetEntity) throw new ValidationError('targetEntity is required');

    const all = await this.memoryStore.listByType(bankId, 'opinion', 1000);
    return all
      .filter((m) => m.metadata.targetEntity === targetEntity)
      .map(toOpinion);
  }

  /**
   * Updates opinion confidence using new supporting or
   * contradicting evidence.
   *
   *   newConfidence = currentConfidence * 0.6
   *                 + avg(supporting.confidence) * 0.4
   *   if contradicting: newConfidence *= 0.8
   */
  async updateConfidence(
    opinionId: string,
    supporting: Memory[] = [],
    contradicting: Memory[] = []
  ): Promise<Opinion | null> {
    assertUuid(opinionId, 'opinionId');

    const existing = await this.memoryStore.getById(opinionId);
    if (!existing || existing.type !== 'opinion') return null;

    const currentConfidence = clampConfidence(existing.confidence);
    const supportingWeight =
      supporting.length === 0
        ? 0
        : supporting.reduce((sum, m) => sum + m.confidence, 0) /
          supporting.length;

    let newConfidence = currentConfidence * 0.6 + supportingWeight * 0.4;
    if (contradicting.length > 0) {
      newConfidence *= 0.8;
    }
    newConfidence = clampConfidence(newConfidence);

    const evidenceIds = [
      ...(existing.metadata.evidenceIds ?? []),
      ...supporting.map((m) => m.id),
    ];
    const contradictingIds = [
      ...(existing.metadata.contradictingIds ?? []),
      ...contradicting.map((m) => m.id),
    ];

    const evidenceCount = evidenceIds.length;
    const freshness = computeFreshness(
      existing.createdAt,
      evidenceCount
    );

    const updated = await this.memoryStore.update(opinionId, {
      confidence: newConfidence,
      metadata: {
        ...existing.metadata,
        confidence: newConfidence,
        evidenceIds,
        contradictingIds,
        lastUpdated: new Date(),
        evidenceCount,
        freshness,
      },
    });

    return updated ? toOpinion(updated) : null;
  }

  async findSemanticallyRelatedOpinions(
    bankId: string,
    embedding: number[],
    limit = 5
  ): Promise<Opinion[]> {
    assertUuid(bankId, 'bankId');
    if (!this.embedder || embedding.length === 0) {
      return this.findOpinionsAbout(bankId, '');
    }
    const similar = await this.memoryStore.findSimilar(bankId, embedding, limit);
    return similar.filter((m) => m.type === 'opinion').map(toOpinion);
  }

  async resolveContradiction(
    opinionA: Opinion,
    opinionB: Opinion
  ): Promise<ContradictionResolution> {
    assertUuid(opinionA.id, 'opinionA.id');
    assertUuid(opinionB.id, 'opinionB.id');
    if (opinionA.id === opinionB.id) {
      throw new ValidationError('Cannot merge an opinion with itself');
    }

    const [keep, discard] = [opinionA, opinionB].sort((a, b) => {
      const scoreA = calculateMemoryScoreFromOpinion(a);
      const scoreB = calculateMemoryScoreFromOpinion(b);
      return scoreB - scoreA;
    });

    const mergedEvidence = [
      ...new Set([
        ...(keep.metadata.evidenceIds ?? []),
        ...(discard.metadata.evidenceIds ?? []),
      ]),
    ];

    const newConfidence = clampConfidence(
      (keep.confidence + discard.confidence) / 2
    );

    const merged = await this.memoryStore.update(keep.id, {
      confidence: newConfidence,
      content: keep.content,
      metadata: {
        ...keep.metadata,
        confidence: newConfidence,
        evidenceIds: mergedEvidence,
        contradictingIds: [
          ...(keep.metadata.contradictingIds ?? []),
          discard.id,
        ],
        lastUpdated: new Date(),
        evidenceCount: mergedEvidence.length,
        freshness: 'strengthening',
      },
    });

    await this.memoryStore.delete(discard.id);

    if (!merged) {
      throw new ValidationError('Failed to resolve contradiction: target memory missing');
    }
    return { merged: toOpinion(merged), discarded: [discard.id] };
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeFreshness(
  createdAt: Date,
  evidenceCount: number
): 'new' | 'strengthening' | 'stable' | 'weakening' | 'stale' {
  const ageHours = (Date.now() - createdAt.getTime()) / 3_600_000;
  if (ageHours < 1) return 'new';
  if (evidenceCount >= 5) return 'strengthening';
  if (ageHours < 24) return 'strengthening';
  if (ageHours < 24 * 7) return 'stable';
  if (ageHours < 24 * 30) return 'weakening';
  return 'stale';
}

function toOpinion(memory: Memory): Opinion {
  return {
    ...memory,
    type: 'opinion',
    metadata: {
      ...memory.metadata,
      targetEntity: memory.metadata.targetEntity ?? 'unknown',
      confidence: memory.metadata.confidence ?? memory.confidence,
      evidenceIds: memory.metadata.evidenceIds ?? [],
      contradictingIds: memory.metadata.contradictingIds,
      lastUpdated: new Date(),
    },
  };
}

function calculateMemoryScoreFromOpinion(opinion: Opinion): number {
  const placeholder: Memory = { ...opinion };
  return calculateMemoryScore(placeholder);
}
