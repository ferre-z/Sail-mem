import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { banks, BankLevel } from '../db/schema.js';
import { Bank, CreateBankInput, BankHierarchy } from '../types/bank.js';

export class BankManager {
  private db = getDb();

  async create(input: CreateBankInput): Promise<Bank> {
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
    const [result] = await this.db.select().from(banks).where(eq(banks.id, id));
    return result ? this.mapToBank(result) : null;
  }

  async getByName(name: string, parentId?: string): Promise<Bank | null> {
    const conditions = parentId
      ? and(eq(banks.name, name), eq(banks.parentId, parentId))
      : eq(banks.name, name);

    const [result] = await this.db.select().from(banks).where(conditions);
    return result ? this.mapToBank(result) : null;
  }

  async update(id: string, input: Partial<CreateBankInput>): Promise<Bank | null> {
    const [result] = await this.db
      .update(banks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(banks.id, id))
      .returning();

    return result ? this.mapToBank(result) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(banks).where(eq(banks.id, id));
  }

  async listByLevel(level: BankLevel): Promise<Bank[]> {
    const results = await this.db.select().from(banks).where(eq(banks.level, level));
    return results.map(this.mapToBank);
  }

  async getHierarchy(id: string): Promise<BankHierarchy> {
    const path: string[] = [];
    let current = await this.getById(id);

    while (current) {
      path.unshift(current.id);
      if (current.parentId) {
        current = await this.getById(current.parentId);
      } else {
        break;
      }
    }

    const bank = await this.getById(id);
    if (!bank) throw new Error('Bank not found');

    const children = await this.getChildren(id);
    const childHierarchies = await Promise.all(
      children.map((child) => this.getHierarchy(child.id))
    );

    return { bank, children: childHierarchies, path };
  }

  async getChildren(id: string): Promise<Bank[]> {
    const results = await this.db.select().from(banks).where(eq(banks.parentId, id));
    return results.map(this.mapToBank);
  }

  async getDescendants(id: string): Promise<Bank[]> {
    const children = await this.getChildren(id);
    const descendants: Bank[] = [...children];

    for (const child of children) {
      const childDescendants = await this.getDescendants(child.id);
      descendants.push(...childDescendants);
    }

    return descendants;
  }

  async getAncestors(id: string): Promise<Bank[]> {
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
