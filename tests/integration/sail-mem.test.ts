import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryStore } from '../../src/core/memory-store.js';
import { BankManager } from '../../src/core/bank-manager.js';
import { configure, resetConfig } from '../../src/config/index.js';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let bankManager: BankManager;
  let testBankId: string;

  beforeAll(async () => {
    configure({
      database: {
        host: 'localhost',
        port: 5432,
        database: 'sail_mem_test',
        user: 'postgres',
        password: '',
      },
    });
    store = new MemoryStore();
    bankManager = new BankManager();

    // Create a test bank
    const bank = await bankManager.create({
      name: 'test-bank',
      level: 'global',
    });
    testBankId = bank.id;
  });

  afterAll(async () => {
    resetConfig();
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

describe('BankManager', () => {
  let manager: BankManager;

  beforeAll(async () => {
    configure({
      database: {
        host: 'localhost',
        port: 5432,
        database: 'sail_mem_test',
        user: 'postgres',
        password: '',
      },
    });
    manager = new BankManager();
  });

  afterAll(async () => {
    resetConfig();
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
