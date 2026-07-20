import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { entities, relationships, memoryEntities } from '../db/schema.js';

export interface Entity {
  id: string;
  bankId: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  embedding?: number[];
  createdAt: Date;
}

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

export class KnowledgeGraph {
  private db = getDb();

  async createEntity(input: {
    bankId: string;
    name: string;
    type: string;
    properties?: Record<string, unknown>;
    embedding?: number[];
  }): Promise<Entity> {
    const [result] = await this.db
      .insert(entities)
      .values({
        bankId: input.bankId,
        name: input.name,
        type: input.type,
        properties: input.properties || {},
        embedding: input.embedding,
      })
      .returning();

    return this.mapToEntity(result);
  }

  async getEntity(id: string): Promise<Entity | null> {
    const [result] = await this.db.select().from(entities).where(eq(entities.id, id));
    return result ? this.mapToEntity(result) : null;
  }

  async findEntityByName(name: string, bankId: string): Promise<Entity | null> {
    const [result] = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.name, name), eq(entities.bankId, bankId)));
    return result ? this.mapToEntity(result) : null;
  }

  async createRelationship(input: {
    sourceId: string;
    targetId: string;
    type: string;
    properties?: Record<string, unknown>;
    weight?: number;
  }): Promise<Relationship> {
    const [result] = await this.db
      .insert(relationships)
      .values({
        sourceId: input.sourceId,
        targetId: input.targetId,
        type: input.type,
        properties: input.properties || {},
        weight: input.weight ?? 1.0,
      })
      .returning();

    return this.mapToRelationship(result);
  }

  async getConnectedEntities(entityId: string): Promise<ConnectedEntity[]> {
    // Outgoing relationships
    const outgoing = await this.db
      .select({
        relationship: relationships,
        entity: entities,
      })
      .from(relationships)
      .innerJoin(entities, eq(relationships.targetId, entities.id))
      .where(eq(relationships.sourceId, entityId));

    // Incoming relationships
    const incoming = await this.db
      .select({
        relationship: relationships,
        entity: entities,
      })
      .from(relationships)
      .innerJoin(entities, eq(relationships.sourceId, entities.id))
      .where(eq(relationships.targetId, entityId));

    const result: ConnectedEntity[] = [];

    for (const row of outgoing) {
      result.push({
        entity: this.mapToEntity(row.entity),
        relationship: this.mapToRelationship(row.relationship),
        direction: 'outgoing',
      });
    }

    for (const row of incoming) {
      result.push({
        entity: this.mapToEntity(row.entity),
        relationship: this.mapToRelationship(row.relationship),
        direction: 'incoming',
      });
    }

    return result;
  }

  async findPath(
    sourceId: string,
    targetId: string,
    maxDepth = 5
  ): Promise<{
    entities: Entity[];
    relationships: Relationship[];
  } | null> {
    // BFS to find shortest path
    const queue: Array<{ entityId: string; path: string[]; rels: string[] }> = [
      { entityId: sourceId, path: [sourceId], rels: [] },
    ];
    const visited = new Set<string>([sourceId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.entityId === targetId) {
        const pathEntities = await Promise.all(
          current.path.map((id) => this.getEntity(id))
        );
        const pathRels = await Promise.all(
          current.rels.map((id) => this.getRelationship(id))
        );

        return {
          entities: pathEntities.filter(Boolean) as Entity[],
          relationships: pathRels.filter(Boolean) as Relationship[],
        };
      }

      if (current.path.length > maxDepth) continue;

      const connected = await this.getConnectedEntities(current.entityId);
      for (const { entity, relationship } of connected) {
        if (!visited.has(entity.id)) {
          visited.add(entity.id);
          queue.push({
            entityId: entity.id,
            path: [...current.path, entity.id],
            rels: [...current.rels, relationship.id],
          });
        }
      }
    }

    return null;
  }

  async linkMemoryToEntity(memoryId: string, entityId: string): Promise<void> {
    await this.db.insert(memoryEntities).values({ memoryId, entityId });
  }

  async getEntitiesForMemory(memoryId: string): Promise<Entity[]> {
    const results = await this.db
      .select({ entity: entities })
      .from(memoryEntities)
      .innerJoin(entities, eq(memoryEntities.entityId, entities.id))
      .where(eq(memoryEntities.memoryId, memoryId));

    return results.map((r) => this.mapToEntity(r.entity));
  }

  private async getRelationship(id: string): Promise<Relationship | null> {
    const [result] = await this.db.select().from(relationships).where(eq(relationships.id, id));
    return result ? this.mapToRelationship(result) : null;
  }

  private mapToEntity(row: any): Entity {
    return {
      id: row.id,
      bankId: row.bankId,
      name: row.name,
      type: row.type,
      properties: row.properties || {},
      embedding: row.embedding,
      createdAt: row.createdAt,
    };
  }

  private mapToRelationship(row: any): Relationship {
    return {
      id: row.id,
      sourceId: row.sourceId,
      targetId: row.targetId,
      type: row.type,
      properties: row.properties || {},
      weight: row.weight,
      createdAt: row.createdAt,
    };
  }
}
