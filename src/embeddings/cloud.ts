import { EmbeddingProvider } from './embedder.js';
import { getConfig } from '../config/index.js';

export class CloudEmbedder implements EmbeddingProvider {
  private dimensions: number;

  constructor() {
    this.dimensions = getConfig().embeddings.dimensions;
  }

  async initialize(): Promise<void> {
    // Cloud APIs don't need initialization
  }

  async embed(text: string): Promise<number[]> {
    const config = getConfig().embeddings.cloud;

    if (config.provider === 'openai') {
      return this.embedOpenAI(text, config);
    }

    throw new Error(`Unsupported cloud provider: ${config.provider}`);
  }

  private async embedOpenAI(text: string, config: { apiKey: string; model: string }): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const config = getConfig().embeddings.cloud;

    if (config.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((item: any) => item.embedding);
    }

    throw new Error(`Unsupported cloud provider: ${config.provider}`);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
