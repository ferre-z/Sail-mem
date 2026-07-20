import { getDb } from '../db/connection.js';
import { Memory, CreateMemoryInput } from '../types/memory.js';
import { NotFoundError, StorageError, ValidationError } from '../errors.js';
import type { IStorage } from '../storage/types.js';
import { createStorage } from '../storage/factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export interface MemoryStoreDeps {
  db?: ReturnType<typeof getDb>;
  storage?: IStorage;
}

export class MemoryStore {
  private db?: ReturnType<typeof getDb>;
  private storage?: IStorage;

  constructor(deps: MemoryStoreDeps = {}) {
    this.db = deps.db;
    this.storage = deps.storage;
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    if (!this.db) throw new StorageError('MemoryStore has no db or storage');
    this.storage = await createStorage({ provider: 'postgres', db: this.db });
    return this.storage;
  }

  async create(input: CreateMemoryInput): Promise<Memory> {
    const storage = await this.useStorage();
    return storage.createMemory(input);
  }

  async getById(id: string): Promise<Memory | null> {
    if (!id) throw new ValidationError('memoryId is required');
    const storage = await this.useStorage();
    return storage.getMemory(id);
  }

  async getByIdOrThrow(id: string): Promise<Memory> {
    const memory = await this.getById(id);
    if (!memory) throw new NotFoundError('Memory', id);
    return memory;
  }

  async update(id: string, input: Partial<CreateMemoryInput>): Promise<Memory | null> {
    if (!id) throw new ValidationError('memoryId is required');
    const storage = await this.useStorage();
    return storage.updateMemory(id, input);
  }

  async delete(id: string): Promise<void> {
    if (!id) throw new ValidationError('memoryId is required');
    const storage = await this.useStorage();
    return storage.deleteMemory(id);
  }

  async listByBank(bankId: string, limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const storage = await this.useStorage();
    return storage.listMemoriesByBank(bankId, limit);
  }

  async listByType(bankId: string, type: Memory['type'], limit = 100): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    const storage = await this.useStorage();
    return storage.listMemoriesByType(bankId, type, limit);
  }

  async incrementAccessCount(id: string): Promise<void> {
    if (!id) throw new ValidationError('memoryId is required');
    const storage = await this.useStorage();
    return storage.incrementMemoryAccess(id);
  }

  async findSimilar(
    bankId: string,
    embedding: number[],
    limit = 10
  ): Promise<Memory[]> {
    assertUuid(bankId, 'bankId');
    if (embedding.length === 0) return [];
    const storage = await this.useStorage();
    const result = await storage.semanticSearch(bankId, embedding, { limit });
    return result.map((r) => r.memory);
  }
}
