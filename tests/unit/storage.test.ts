import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { ValidationError, NotFoundError } from '../../src/errors.ts';
import type { IStorage } from '../../src/storage/types.ts';

describe('BankManager (SQLite)', () => {
  let storage: IStorage;
  let manager: BankManager;

  beforeEach(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    manager = new BankManager({ storage });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates a bank with valid input', async () => {
    const bank = await manager.create({ name: 'global', level: 'global' });
    expect(bank.id).toBeDefined();
    expect(bank.name).toBe('global');
    expect(bank.level).toBe('global');
    expect(bank.parentId).toBeUndefined();
  });

  it('rejects empty bank name', async () => {
    await expect(manager.create({ name: '', level: 'global' })).rejects.toThrow(
      ValidationError
    );
  });

  it('rejects invalid parent UUID', async () => {
    await expect(
      manager.create({ name: 'user', level: 'user', parentId: 'not-a-uuid' })
    ).rejects.toThrow(/Invalid parentId/);
  });

  it('round-trips bank hierarchy', async () => {
    const global = await manager.create({ name: 'global', level: 'global' });
    const user = await manager.create({
      name: 'alice',
      level: 'user',
      parentId: global.id,
    });
    const project = await manager.create({
      name: 'sail-mem',
      level: 'project',
      parentId: user.id,
    });

    const hierarchy = await manager.getHierarchy(project.id);
    expect(hierarchy.path).toEqual([global.id, user.id, project.id]);
  });

  it('throws NotFoundError for missing bank', async () => {
    await expect(manager.getByIdOrThrow('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError
    );
  });

  it('lists banks by level', async () => {
    await manager.create({ name: 'global-1', level: 'global' });
    await manager.create({ name: 'global-2', level: 'global' });
    await manager.create({ name: 'user-1', level: 'user' });

    const globals = await manager.listByLevel('global');
    expect(globals).toHaveLength(2);

    const users = await manager.listByLevel('user');
    expect(users).toHaveLength(1);
  });
});

describe('MemoryStore (SQLite)', () => {
  let storage: IStorage;
  let store: MemoryStore;
  let bankId: string;

  beforeEach(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    const bm = new BankManager({ storage });
    const bank = await bm.create({ name: 'test-bank', level: 'global' });
    bankId = bank.id;
    store = new MemoryStore({ storage });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates and retrieves a memory', async () => {
    const m = await store.create({
      bankId,
      type: 'world_fact',
      content: 'Alice works at Google',
    });
    expect(m.content).toBe('Alice works at Google');
    expect(m.type).toBe('world_fact');

    const retrieved = await store.getById(m.id);
    expect(retrieved?.content).toBe('Alice works at Google');
  });

  it('rejects empty content', async () => {
    await expect(
      store.create({ bankId, type: 'world_fact', content: '   ' })
    ).rejects.toThrow(/content cannot be empty/);
  });

  it('rejects invalid bank UUID', async () => {
    await expect(
      store.create({ bankId: 'bad', type: 'world_fact', content: 'x' })
    ).rejects.toThrow(/Invalid bankId/);
  });

  it('updates a memory', async () => {
    const m = await store.create({
      bankId,
      type: 'world_fact',
      content: 'Alice likes JavaScript',
    });
    const updated = await store.update(m.id, { content: 'Alice likes TypeScript' });
    expect(updated?.content).toBe('Alice likes TypeScript');
  });

  it('deletes a memory', async () => {
    const m = await store.create({
      bankId,
      type: 'world_fact',
      content: 'temporary',
    });
    await store.delete(m.id);
    const retrieved = await store.getById(m.id);
    expect(retrieved).toBeNull();
  });

  it('lists memories by bank', async () => {
    await store.create({ bankId, type: 'world_fact', content: 'a' });
    await store.create({ bankId, type: 'experience_fact', content: 'b' });

    const all = await store.listByBank(bankId);
    expect(all.length).toBe(2);
    expect(all.every((m) => m.bankId === bankId)).toBe(true);
  });

  it('lists memories by type', async () => {
    await store.create({ bankId, type: 'world_fact', content: 'a' });
    await store.create({ bankId, type: 'world_fact', content: 'b' });
    await store.create({ bankId, type: 'observation', content: 'c' });

    const facts = await store.listByType(bankId, 'world_fact');
    expect(facts).toHaveLength(2);
  });

  it('cross-bank isolation holds', async () => {
    const bm = new BankManager({ storage });
    const other = await bm.create({ name: 'other', level: 'global' });

    await store.create({ bankId, type: 'world_fact', content: 'leak?' });
    const leaked = await store.listByBank(other.id);
    expect(leaked).toHaveLength(0);
  });

  it('increments access count', async () => {
    const m = await store.create({
      bankId,
      type: 'world_fact',
      content: 'popular fact',
    });
    await store.incrementAccessCount(m.id);
    await store.incrementAccessCount(m.id);
    const after = await store.getById(m.id);
    expect(after?.accessCount).toBe(2);
  });
});

describe('KnowledgeGraph (SQLite)', () => {
  let storage: IStorage;
  let graph: InstanceType<typeof KnowledgeGraph>;
  let bankId: string;

  beforeEach(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    const bm = new BankManager({ storage });
    bankId = (await bm.create({ name: 'g', level: 'global' })).id;
    const { KnowledgeGraph } = await import('../../src/graph/knowledge-graph.ts');
    graph = new KnowledgeGraph({ storage });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('creates entities and links them to memories', async () => {
    const store = new MemoryStore({ storage });
    const mem = await store.create({
      bankId,
      type: 'world_fact',
      content: 'Alice knows Python',
    });

    const alice = await graph.createEntity({ bankId, name: 'Alice', type: 'person' });
    const python = await graph.createEntity({ bankId, name: 'Python', type: 'language' });

    await graph.linkMemoryToEntity(mem.id, alice.id);
    await graph.linkMemoryToEntity(mem.id, python.id);
    await graph.createRelationship({
      sourceId: alice.id,
      targetId: python.id,
      type: 'knows',
    });

    const connected = await graph.getConnectedEntities(alice.id);
    expect(connected).toHaveLength(1);
    expect(connected[0].entity.name).toBe('Python');
    expect(connected[0].relationship.type).toBe('knows');
    expect(connected[0].direction).toBe('outgoing');

    const entities = await graph.getEntitiesForMemory(mem.id);
    expect(entities.map((e) => e.name).sort()).toEqual(['Alice', 'Python']);
  });

  it('finds shortest path between two entities', async () => {
    const a = await graph.createEntity({ bankId, name: 'A', type: 't' });
    const b = await graph.createEntity({ bankId, name: 'B', type: 't' });
    const c = await graph.createEntity({ bankId, name: 'C', type: 't' });

    await graph.createRelationship({ sourceId: a.id, targetId: b.id, type: 'a-b' });
    await graph.createRelationship({ sourceId: b.id, targetId: c.id, type: 'b-c' });

    const path = await graph.findPath(a.id, c.id);
    expect(path).not.toBeNull();
    expect(path?.entities.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    expect(path?.relationships).toHaveLength(2);
  });

  it('rejects self-referential relationships', async () => {
    const a = await graph.createEntity({ bankId, name: 'A', type: 't' });
    await expect(
      graph.createRelationship({ sourceId: a.id, targetId: a.id, type: 'self' })
    ).rejects.toThrow(/Self-referential/);
  });
});
