import { getDb } from '../db/connection.js';
import { NotFoundError, StorageError, ValidationError } from '../errors.js';
import type { IStorage, EntityRecord as StorageEntity } from '../storage/types.js';
import { createStorage } from '../storage/factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError(`Invalid ${name}: ${value}`);
  }
}

export type Entity = StorageEntity;
export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  createdAt: Date;
}

export interface ConnectedEntity {
  entity: Entity;
  relationship: Relationship;
  direction: 'outgoing' | 'incoming';
}

export interface KnowledgeGraphDeps {
  db?: ReturnType<typeof getDb>;
  storage?: IStorage;
}

export class KnowledgeGraph {
  private db?: ReturnType<typeof getDb>;
  private storage?: IStorage;

  constructor(deps: KnowledgeGraphDeps = {}) {
    this.db = deps.db;
    this.storage = deps.storage;
  }

  private async useStorage(): Promise<IStorage> {
    if (this.storage) return this.storage;
    if (!this.db) throw new StorageError('KnowledgeGraph has no db or storage');
    this.storage = await createStorage({ provider: 'postgres', db: this.db });
    return this.storage;
  }

  async createEntity(input: {
    bankId: string;
    name: string;
    type: string;
    properties?: Record<string, unknown>;
    embedding?: number[];
  }): Promise<Entity> {
    const storage = await this.useStorage();
    return storage.createEntity(input);
  }

  async getEntity(id: string): Promise<Entity | null> {
    assertUuid(id, 'entityId');
    const storage = await this.useStorage();
    return storage.getEntity(id);
  }

  async getEntityOrThrow(id: string): Promise<Entity> {
    const entity = await this.getEntity(id);
    if (!entity) throw new NotFoundError('Entity', id);
    return entity;
  }

  async findEntityByName(name: string, bankId: string): Promise<Entity | null> {
    const storage = await this.useStorage();
    return storage.findEntityByName(name, bankId);
  }

  async createRelationship(input: {
    sourceId: string;
    targetId: string;
    type: string;
    properties?: Record<string, unknown>;
    weight?: number;
  }): Promise<Relationship> {
    const storage = await this.useStorage();
    const rec = await storage.createRelationship(input);
    return recToRelationship(rec);
  }

  async getConnectedEntities(entityId: string): Promise<ConnectedEntity[]> {
    assertUuid(entityId, 'entityId');
    const storage = await this.useStorage();
    const relationships = await storage.getRelationships(entityId);

    const result: ConnectedEntity[] = [];
    for (const rel of relationships) {
      if (rel.sourceId === entityId) {
        const target = await storage.getEntity(rel.targetId);
        if (target) {
          result.push({
            entity: target,
            relationship: recToRelationship(rel),
            direction: 'outgoing',
          });
        }
      } else {
        const source = await storage.getEntity(rel.sourceId);
        if (source) {
          result.push({
            entity: source,
            relationship: recToRelationship(rel),
            direction: 'incoming',
          });
        }
      }
    }
    return result;
  }

  async findPath(
    sourceId: string,
    targetId: string,
    maxDepth = 5
  ): Promise<{ entities: Entity[]; relationships: Relationship[] } | null> {
    assertUuid(sourceId, 'sourceId');
    assertUuid(targetId, 'targetId');
    const safeDepth = Math.max(1, Math.min(maxDepth, 12));
    const storage = await this.useStorage();

    const queue: Array<{ entityId: string; path: string[]; rels: Relationship[] }> = [
      { entityId: sourceId, path: [sourceId], rels: [] },
    ];
    const visited = new Set<string>([sourceId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.entityId === targetId) {
        const entities = (
          await Promise.all(current.path.map((id) => storage.getEntity(id)))
        ).filter((e): e is Entity => Boolean(e));
        return {
          entities,
          relationships: current.rels,
        };
      }

      if (current.path.length > safeDepth) continue;

      const connected = await this.getConnectedEntities(current.entityId);
      for (const { entity, relationship } of connected) {
        if (!visited.has(entity.id)) {
          visited.add(entity.id);
          queue.push({
            entityId: entity.id,
            path: [...current.path, entity.id],
            rels: [...current.rels, relationship],
          });
        }
      }
    }

    return null;
  }

  async linkMemoryToEntity(memoryId: string, entityId: string): Promise<void> {
    assertUuid(memoryId, 'memoryId');
    assertUuid(entityId, 'entityId');
    const storage = await this.useStorage();
    return storage.linkMemoryEntity(memoryId, entityId);
  }

  async getEntitiesForMemory(memoryId: string): Promise<Entity[]> {
    assertUuid(memoryId, 'memoryId');
    const storage = await this.useStorage();
    return storage.getEntitiesForMemory(memoryId);
  }
}

function recToRelationship(rec: {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
  weight: number;
  createdAt: Date;
}): Relationship {
  return rec;
}
