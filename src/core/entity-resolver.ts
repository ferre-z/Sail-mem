import { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { Entity } from '../graph/knowledge-graph.js';
import { ValidationError } from '../errors.js';

export interface ResolvedEntityMatch {
  entity: Entity;
  matchKind: 'exact' | 'case-insensitive' | 'levenshtein';
  score: number;
}

export interface EntityResolverDeps {
  knowledgeGraph: KnowledgeGraph;
  maxLevenshteinDistance?: number;
}

export class EntityResolver {
  private knowledgeGraph: KnowledgeGraph;
  private maxLevenshteinDistance: number;

  constructor(deps: EntityResolverDeps) {
    this.knowledgeGraph = deps.knowledgeGraph;
    this.maxLevenshteinDistance = deps.maxLevenshteinDistance ?? 3;
  }

  async resolveAliases(name: string, bankId: string): Promise<ResolvedEntityMatch[]> {
    if (!name) throw new ValidationError('name is required');
    if (!bankId.match(/^[0-9a-f-]{36}$/i)) throw new ValidationError('Invalid bankId');

    const matches: ResolvedEntityMatch[] = [];

    const exact = await this.knowledgeGraph.findEntityByName(name, bankId);
    if (exact) matches.push({ entity: exact, matchKind: 'exact', score: 1.0 });

    const caseInsensitive = await this.knowledgeGraph.findEntityByName(
      name.toLowerCase(),
      bankId
    );
    if (caseInsensitive && caseInsensitive.id !== exact?.id) {
      matches.push({ entity: caseInsensitive, matchKind: 'case-insensitive', score: 0.95 });
    }

    const all = await this.listEntitiesInBank(bankId);
    for (const entity of all) {
      if (matches.some((m) => m.entity.id === entity.id)) continue;
      const d = levenshtein(name.toLowerCase(), entity.name.toLowerCase());
      if (d <= this.maxLevenshteinDistance) {
        const score = 1 - d / Math.max(name.length, entity.name.length);
        matches.push({ entity, matchKind: 'levenshtein', score: Math.max(score, 0.6) });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  async mergeEntities(canonicalId: string, aliasIds: string[]): Promise<Entity> {
    if (!canonicalId.match(/^[0-9a-f-]{36}$/i)) {
      throw new ValidationError('Invalid canonicalId');
    }
    if (aliasIds.length === 0) throw new ValidationError('aliasIds must be non-empty');

    const canonical = await this.knowledgeGraph.getEntityOrThrow(canonicalId);

    for (const aliasId of aliasIds) {
      if (aliasId === canonicalId) continue;
      const alias = await this.knowledgeGraph.getEntity(aliasId);
      if (!alias) continue;

      const mergedProps = { ...alias.properties, ...canonical.properties };
      await this.knowledgeGraph.createEntity({
        bankId: canonical.bankId,
        name: canonical.name,
        type: canonical.type,
        properties: mergedProps,
        embedding: canonical.embedding ?? alias.embedding,
      });

      const connected = await this.knowledgeGraph.getConnectedEntities(aliasId);
      for (const conn of connected) {
        const otherId =
          conn.direction === 'outgoing' ? conn.relationship.targetId : conn.relationship.sourceId;
        if (otherId === canonicalId) continue;
        try {
          await this.knowledgeGraph.createRelationship({
            sourceId: conn.direction === 'outgoing' ? canonicalId : otherId,
            targetId: conn.direction === 'outgoing' ? otherId : canonicalId,
            type: conn.relationship.type,
            properties: conn.relationship.properties,
            weight: conn.relationship.weight,
          });
        } catch {
          // already exists or invalid; skip
        }
      }
    }

    return this.knowledgeGraph.getEntityOrThrow(canonicalId);
  }

  private async listEntitiesInBank(bankId: string): Promise<Entity[]> {
    return this.knowledgeGraph.listEntitiesByBank(bankId);
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
