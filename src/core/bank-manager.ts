import { getDb } from '../db/connection.js';
import { Bank, CreateBankInput, BankHierarchy } from '../types/bank.js';
import { NotFoundError, StorageError, ValidationError } from '../errors.js';
import type { IStorage } from '../storage/types.js';
import { createStorage } from '../storage/factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export interface BankManagerDeps {
  db?: ReturnType<typeof getDb>;
  storage?: IStorage;
}

export class BankManager {
  private db?: ReturnType<typeof getDb>;
  private storage?: IStorage;

  constructor(deps: BankManagerDeps = {}) {
    this.db = deps.db;
    this.storage = deps.storage;
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    if (!this.db) throw new StorageError('BankManager has no db or storage');
    this.storage = await createStorage({ provider: 'postgres', db: this.db });
    return this.storage;
  }

  async create(input: CreateBankInput): Promise<Bank> {
    const storage = await this.useStorage();
    return storage.createBank(input);
  }

  async getById(id: string): Promise<Bank | null> {
    if (!id) throw new ValidationError('bankId is required');
    const storage = await this.useStorage();
    return storage.getBank(id);
  }

  async getByIdOrThrow(id: string): Promise<Bank> {
    const bank = await this.getById(id);
    if (!bank) throw new NotFoundError('Bank', id);
    return bank;
  }

  async getByName(name: string, parentId?: string): Promise<Bank | null> {
    const storage = await this.useStorage();
    return storage.getBankByName(name, parentId);
  }

  async update(id: string, input: Partial<CreateBankInput>): Promise<Bank | null> {
    assertUuid(id, 'bankId');
    const storage = await this.useStorage();
    return storage.updateBank(id, input);
  }

  async delete(id: string): Promise<void> {
    assertUuid(id, 'bankId');
    const storage = await this.useStorage();
    return storage.deleteBank(id);
  }

  async listByLevel(level: Bank['level']): Promise<Bank[]> {
    const storage = await this.useStorage();
    return storage.listBanksByLevel(level);
  }

  async listAll(): Promise<Bank[]> {
    const storage = await this.useStorage();
    return storage.listAllBanks();
  }

  async getHierarchy(id: string): Promise<BankHierarchy> {
    assertUuid(id, 'bankId');
    const storage = await this.useStorage();

    const path: string[] = [];
    let current: Bank | null = await storage.getBank(id);
    if (!current) throw new NotFoundError('Bank', id);

    while (current) {
      path.unshift(current.id);
      current = current.parentId ? await storage.getBank(current.parentId) : null;
    }

    const children = await storage.getBankChildren(id);
    const childHierarchies = await Promise.all(
      children.map(async (child) => this.getHierarchy(child.id))
    );

    return {
      bank: await this.getByIdOrThrow(id),
      children: childHierarchies,
      path,
    };
  }

  async getChildren(id: string): Promise<Bank[]> {
    assertUuid(id, 'bankId');
    const storage = await this.useStorage();
    return storage.getBankChildren(id);
  }

  async getDescendants(id: string): Promise<Bank[]> {
    assertUuid(id, 'bankId');
    const children = await this.getChildren(id);
    const descendants: Bank[] = [...children];
    for (const child of children) {
      const childDescendants = await this.getDescendants(child.id);
      descendants.push(...childDescendants);
    }
    return descendants;
  }

  async getAncestors(id: string): Promise<Bank[]> {
    assertUuid(id, 'bankId');
    const ancestors: Bank[] = [];
    let current = await this.getById(id);
    while (current?.parentId) {
      const parent = await this.getById(current.parentId);
      if (parent) {
        ancestors.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    return ancestors;
  }
}
