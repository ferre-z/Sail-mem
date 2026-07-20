import type {
  Memory,
  CreateMemoryInput,
  Bank,
  CreateBankInput,
} from '../types/index.js';
import type { BankLevel } from '../db/schema.js';

export type { BankLevel, Memory, CreateMemoryInput, Bank, CreateBankInput };

export type StorageProvider = 'sqlite' | 'postgres';

export interface ScoredMemory {
  memory: Memory;
  score: number;
}

export interface FullTextSearchOptions {
  limit?: number;
  language?: 'english' | 'simple';
}

export interface SemanticSearchOptions {
  limit?: number;
  minScore?: number;
}

export interface CreateEntityInput {
  bankId: string;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

export interface EntityRecord {
  id: string;
  bankId: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  embedding?: number[];
  createdAt: Date;
}

export interface CreateRelationshipInput {
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Record<string, unknown>;
  weight?: number;
}

export interface RelationshipRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  createdAt: Date;
}

export interface MemoryStat {
  bankId: string;
  type: string;
  count: number;
  avgConfidence: number;
}

export interface IStorage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  createMemory(input: CreateMemoryInput): Promise<Memory>;
  getMemory(id: string): Promise<Memory | null>;
  updateMemory(id: string, input: Partial<CreateMemoryInput>): Promise<Memory | null>;
  deleteMemory(id: string): Promise<void>;
  listMemoriesByBank(bankId: string, limit?: number): Promise<Memory[]>;
  listMemoriesByType(bankId: string, type: Memory['type'], limit?: number): Promise<Memory[]>;
  incrementMemoryAccess(id: string): Promise<void>;

  createBank(input: CreateBankInput): Promise<Bank>;
  getBank(id: string): Promise<Bank | null>;
  getBankByName(name: string, parentId?: string): Promise<Bank | null>;
  updateBank(id: string, input: Partial<CreateBankInput>): Promise<Bank | null>;
  deleteBank(id: string): Promise<void>;
  listBanksByLevel(level: BankLevel): Promise<Bank[]>;
  listAllBanks(): Promise<Bank[]>;
  getBankChildren(bankId: string): Promise<Bank[]>;

  createEntity(input: CreateEntityInput): Promise<EntityRecord>;
  getEntity(id: string): Promise<EntityRecord | null>;
  findEntityByName(name: string, bankId: string): Promise<EntityRecord | null>;
  listEntitiesByBank(bankId: string, limit?: number): Promise<EntityRecord[]>;
  createRelationship(input: CreateRelationshipInput): Promise<RelationshipRecord>;
  getRelationships(entityId: string): Promise<RelationshipRecord[]>;
  linkMemoryEntity(memoryId: string, entityId: string): Promise<void>;
  getEntitiesForMemory(memoryId: string): Promise<EntityRecord[]>;

  semanticSearch(
    bankId: string,
    embedding: number[],
    options?: SemanticSearchOptions
  ): Promise<ScoredMemory[]>;

  fullTextSearch(
    bankId: string,
    query: string,
    options?: FullTextSearchOptions
  ): Promise<ScoredMemory[]>;

  graphEntityLookup(
    bankId: string,
    nameOrTypeQuery: string,
    limit?: number
  ): Promise<ScoredMemory[]>;

  temporalSearch(
    bankId: string,
    options: { recency?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'any'; limit?: number }
  ): Promise<ScoredMemory[]>;

  getStats(): Promise<{ memories: number; banks: number; entities: number }>;
}
