import { EmbeddingProvider } from './embedder.js';
import { getConfig } from '../config/index.js';
import { EmbeddingError, ValidationError } from '../errors.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface CloudEmbedderOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CloudEmbedder implements EmbeddingProvider {
  private dimensions: number;
  private maxRetries: number;
  private baseDelayMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: CloudEmbedderOptions = {}) {
    this.dimensions = getConfig().embeddings.dimensions;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new ValidationError('Cannot embed empty text');
    }
    const config = getConfig().embeddings.cloud;

    if (config.provider === 'openai') {
      const result = await this.embedWithRetry(
        () => this.embedOpenAI(text, config),
        { maxRetries: this.maxRetries, baseDelayMs: this.baseDelayMs }
      );
      return result[0];
    }

    throw new EmbeddingError(`Unsupported cloud provider: ${config.provider}`);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts)) {
      throw new ValidationError('texts must be an array');
    }
    if (texts.length === 0) return [];
    for (const t of texts) {
      if (!t || t.trim().length === 0) {
        throw new ValidationError('Cannot embed empty text');
      }
    }

    const config = getConfig().embeddings.cloud;

    if (config.provider === 'openai') {
      return this.embedWithRetry(
        () => this.embedOpenAIBatch(texts, config),
        { maxRetries: this.maxRetries, baseDelayMs: this.baseDelayMs }
      );
    }

    throw new EmbeddingError(`Unsupported cloud provider: ${config.provider}`);
  }

  private async embedWithRetry<T>(
    op: () => Promise<T>,
    opts: RetryOptions
  ): Promise<T> {
    const { maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS } = opts;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await op();
      } catch (err) {
        lastError = err;
        if (err instanceof EmbeddingError && !RETRYABLE_STATUS.has(err.status ?? -1)) {
          throw err;
        }
        if (attempt === maxRetries) break;
        const backoff = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelayMs;
        await delay(backoff + jitter);
      }
    }

    if (lastError instanceof EmbeddingError) throw lastError;
    throw new EmbeddingError(
      `Embedding request failed after ${maxRetries + 1} attempts`,
      undefined,
      lastError
    );
  }

  private async embedOpenAI(
    text: string,
    config: { apiKey: string; model: string }
  ): Promise<number[][]> {
    const result = await this.callOpenAI([text], config);
    return result;
  }

  private async embedOpenAIBatch(
    texts: string[],
    config: { apiKey: string; model: string }
  ): Promise<number[][]> {
    return this.callOpenAI(texts, config);
  }

  private async callOpenAI(
    texts: string[],
    config: { apiKey: string; model: string }
  ): Promise<number[][]> {
    if (!config.apiKey) {
      throw new EmbeddingError('OpenAI apiKey is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new EmbeddingError(
          `OpenAI API error (${response.status}): ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`,
          response.status
        );
      }

      const data = await response.json();
      if (!data?.data || !Array.isArray(data.data)) {
        throw new EmbeddingError('OpenAI response missing data array');
      }
      return data.data.map((item: { embedding?: number[] }) => {
        if (!Array.isArray(item.embedding)) {
          throw new EmbeddingError('OpenAI response item missing embedding array');
        }
        return item.embedding;
      });
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      if ((err as { name?: string })?.name === 'AbortError') {
        throw new EmbeddingError(`OpenAI request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`);
      }
      throw new EmbeddingError(
        `OpenAI request failed: ${(err as Error).message}`,
        undefined,
        err
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
