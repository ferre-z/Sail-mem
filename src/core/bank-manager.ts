import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { banks, BankLevel } from '../db/schema.js';
import { Bank, CreateBankInput, BankHierarchy } from '../types/bank.js';
import { NotFoundError, ValidationError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export interface BankManagerDeps {
  db?: ReturnType<typeof getDb>;
}

export class BankManager {
  private db: ReturnType<typeof getDb>;

  constructor(deps: BankManagerDeps = {}) {
    this.db = deps.db ?? getDb();
  }

  async create(input: CreateBankInput): Promise<Bank> {
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Bank name cannot be empty');
    }
    if (input.parentId) assertUuid(input.parentId, 'parentId');

    const [result] = await this.db
      .insert(banks)
      .values({
        name: input.name,
        level: input.level,
        parentId: input.parentId,
        config: input.config || {},
      })
      .returning();

    return this.mapToBank(result);
  }

  async getById(id: string): Promise<Bank | null> {
    if (id) assertUuid(id, 'bankId');
    const [result] = await this.db.select().from(banks).where(eq(banks.id, id));
    return result ? this.mapToBank(result) : null;
  }

  async getByIdOrThrow(id: string): Promise<Bank> {
    const bank = await this.getById(id);
    if (!bank) throw new NotFoundError('Bank', id);
    return bank;
  }

  async getByName(name: string, parentId?: string): Promise<Bank | null> {
    if (!name) throw new ValidationError('Bank name cannot be empty');
    if (parentId) assertUuid(parentId, 'parentId');

    const conditions = parentId
      ? and(eq(banks.name, name), eq(banks.parentId, parentId))
      : eq(banks.name, name);

    const [result] = await this.db.select().from(banks).where(conditions);
    return result ? this.mapToBank(result) : null;
  }

  async update(id: string, input: Partial<CreateBankInput>): Promise<Bank | null> {
    assertUuid(id, 'bankId');
    if (input.parentId) assertUuid(input.parentId, 'parentId');

    const [result] = await this.db
      .update(banks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(banks.id, id))
      .returning();

    return result ? this.mapToBank(result) : null;
  }

  async delete(id: string): Promise<void> {
    assertUuid(id, 'bankId');
    await this.db.delete(banks).where(eq(banks.id, id));
  }

  async listByLevel(level: BankLevel): Promise<Bank[]> {
    const results = await this.db.select().from(banks).where(eq(banks.level, level));
    return results.map(this.mapToBank);
  }

  async listAll(): Promise<Bank[]> {
    const results = await this.db.select().from(banks);
    return results.map(this.mapToBank);
  }

  async getHierarchy(id: string): Promise<BankHierarchy> {
    assertUuid(id, 'bankId');
    const path: string[] = [];
    let current: Bank | null = await this.getById(id);

    if (!current) throw new NotFoundError('Bank', id);

    while (current) {
      path.unshift(current.id);
      current = current.parentId ? await this.getById(current.parentId) : null;
    }

    const children = await this.getChildren(id);
    const childHierarchies = await Promise.all(
      children.map((child) => this.getHierarchy(child.id))
    );

    return {
      bank: await this.getByIdOrThrow(id),
      children: childHierarchies,
      path,
    };
  }

  async getChildren(id: string): Promise<Bank[]> {
    assertUuid(id, 'bankId');
    const results = await this.db.select().from(banks).where(eq(banks.parentId, id));
    return results.map(this.mapToBank);
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

  private mapToBank(row: any): Bank {
    return {
      id: row.id,
      name: row.name,
      level: row.level,
      parentId: row.parentId,
      config: row.config || {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
