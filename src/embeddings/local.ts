import { pipeline, env } from '@xenova/transformers';
import { EmbeddingProvider } from './embedder.js';
import { getConfig } from '../config/index.js';

env.cacheDir = './node_modules/@xenova/transformers/cache';

export class LocalEmbedder implements EmbeddingProvider {
  private pipe: any;
  private dimensions: number;

  constructor() {
    this.dimensions = getConfig().embeddings.dimensions;
  }

  async initialize(): Promise<void> {
    const model = getConfig().embeddings.model;
    this.pipe = await pipeline('feature-extraction', model);
  }

  async embed(text: string): Promise<number[]> {
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data.slice(0, this.dimensions));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
