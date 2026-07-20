import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { ValidationError } from '../../src/errors.ts';

describe('MemoryStore (integration, SQLite)', () => {
  let store: MemoryStore;
  let bankManager: BankManager;
  let testBankId: string;
  let storage: SQLiteStorage;

  beforeAll(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    store = new MemoryStore({ storage });
    bankManager = new BankManager({ storage });
    const bank = await bankManager.create({
      name: 'test-bank',
      level: 'global',
    });
    testBankId = bank.id;
  });

  afterAll(async () => {
    await storage.close();
  });

  it('should create a memory', async () => {
    const memory = await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Alice works at Google',
    });

    expect(memory).toBeDefined();
    expect(memory.id).toBeDefined();
    expect(memory.content).toBe('Alice works at Google');
    expect(memory.type).toBe('world_fact');
  });

  it('should retrieve a memory by id', async () => {
    const created = await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Bob lives in New York',
    });

    const retrieved = await store.getById(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe('Bob lives in New York');
  });

  it('should update a memory', async () => {
    const created = await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Charlie likes coffee',
    });

    const updated = await store.update(created.id, {
      content: 'Charlie prefers tea',
    });

    expect(updated?.content).toBe('Charlie prefers tea');
  });

  it('should delete a memory', async () => {
    const created = await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Temporary fact',
    });

    await store.delete(created.id);
    const retrieved = await store.getById(created.id);
    expect(retrieved).toBeNull();
  });

  it('should reject empty content', async () => {
    await expect(
      store.create({
        bankId: testBankId,
        type: 'world_fact',
        content: '',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should list memories by bank', async () => {
    await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Fact 1',
    });
    await store.create({
      bankId: testBankId,
      type: 'world_fact',
      content: 'Fact 2',
    });

    const memories = await store.listByBank(testBankId);
    expect(memories.length).toBeGreaterThanOrEqual(2);
  });
});

describe('BankManager (integration, SQLite)', () => {
  let manager: BankManager;
  let storage: SQLiteStorage;

  beforeAll(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    manager = new BankManager({ storage });
  });

  afterAll(async () => {
    await storage.close();
  });

  it('should create a global bank', async () => {
    const bank = await manager.create({
      name: 'global-knowledge',
      level: 'global',
    });

    expect(bank).toBeDefined();
    expect(bank.level).toBe('global');
    expect(bank.parentId).toBeUndefined();
  });

  it('should create a user bank under global', async () => {
    const global = await manager.create({
      name: 'global-test',
      level: 'global',
    });

    const userBank = await manager.create({
      name: 'user-alice',
      level: 'user',
      parentId: global.id,
    });

    expect(userBank.level).toBe('user');
    expect(userBank.parentId).toBe(global.id);
  });

  it('should get bank hierarchy', async () => {
    const global = await manager.create({
      name: 'global-hierarchy',
      level: 'global',
    });
    const user = await manager.create({
      name: 'user-charlie',
      level: 'user',
      parentId: global.id,
    });

    const hierarchy = await manager.getHierarchy(user.id);
    expect(hierarchy.path).toContain(global.id);
    expect(hierarchy.path).toContain(user.id);
  });
});
