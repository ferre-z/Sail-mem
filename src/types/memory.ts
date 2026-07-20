import { MemoryType, MemoryMetadata } from '../db/schema.js';

export type MemoryTypeValue = MemoryType;

export interface Memory {
  id: string;
  bankId: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  sourceId?: string;
  parentId?: string;
  confidence: number;
  accessCount: number;
  lastAccessedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface CreateMemoryInput {
  bankId: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  metadata?: Partial<MemoryMetadata>;
  sourceId?: string;
  parentId?: string;
  confidence?: number;
  expiresAt?: Date;
}

export interface WorldFact extends Memory {
  type: 'world_fact';
}

export interface ExperienceFact extends Memory {
  type: 'experience_fact';
}

export interface Observation extends Memory {
  type: 'observation';
  metadata: MemoryMetadata & {
    evidence: Array<{ memoryId: string; quote: string }>;
    consolidatedFrom: string[];
  };
}

export interface MentalModel extends Memory {
  type: 'mental_model';
}

export interface Opinion extends Memory {
  type: 'opinion';
  metadata: MemoryMetadata & {
    targetEntity: string;
    confidence: number;
    evidenceIds: string[];
    contradictingIds?: string[];
    lastUpdated: Date;
  };
}
