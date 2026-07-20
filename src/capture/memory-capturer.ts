import { stripSecrets } from './privacy-filter.js';
import type {
  PromptContext,
  ResponseContext,
  SessionContext,
  SessionHooks,
  ToolContext,
  ToolResult,
} from './hooks.js';
import type { MemoryStore } from '../core/memory-store.js';

export interface MemoryCapturerOptions {
  bankId: string;
  memoryStore: MemoryStore;
  redactSecrets?: boolean;
  captureTools?: boolean;
  capturePrompts?: boolean;
}

export interface CaptureFilter {
  reject?(stage: 'tool' | 'prompt' | 'response', text: string): boolean;
}

/**
 * Translates agent lifecycle events into memories. Every
 * captured memory passes through stripSecrets() before being
 * written, so the privacy filter pipeline is mandatory.
 */
export class MemoryCapturer implements SessionHooks {
  private readonly bankId: string;
  private readonly memoryStore: MemoryStore;
  private readonly redactSecrets: boolean;
  private readonly captureTools: boolean;
  private readonly capturePrompts: boolean;
  private readonly filter: CaptureFilter | undefined;
  private workingBuffer: string[] = [];

  constructor(options: MemoryCapturerOptions, filter?: CaptureFilter) {
    this.bankId = options.bankId;
    this.memoryStore = options.memoryStore;
    this.redactSecrets = options.redactSecrets ?? true;
    this.captureTools = options.captureTools ?? true;
    this.capturePrompts = options.capturePrompts ?? false;
    this.filter = filter;
  }

  async onSessionStart(context: SessionContext): Promise<void> {
    this.workingBuffer = [];
    await this.memoryStore.create({
      bankId: this.bankId,
      type: 'experience_fact',
      content: `Session ${context.sessionId} started at ${context.startedAt.toISOString()}`,
      metadata: { tags: ['session'], source: 'auto-capture', sessionId: context.sessionId },
    });
  }

  async onSessionEnd(context: SessionContext): Promise<void> {
    await this.memoryStore.create({
      bankId: this.bankId,
      type: 'experience_fact',
      content: `Session ${context.sessionId} ended at ${new Date().toISOString()}`,
      metadata: { tags: ['session'], source: 'auto-capture', sessionId: context.sessionId },
    });
    this.workingBuffer = [];
  }

  async onPostToolUse(context: ToolContext, result: ToolResult): Promise<void> {
    if (!this.captureTools) return;
    const raw =
      `${context.toolName}(${truncate(JSON.stringify(context.args ?? {}))}) → ` +
      (result.summary ?? (result.success ? 'ok' : 'failed'));
    if (this.filter?.reject?.('tool', raw)) return;
    const cleaned = this.redactSecrets ? stripSecrets(raw) : raw;
    if (cleaned.trim().length === 0) return;
    await this.memoryStore.create({
      bankId: this.bankId,
      type: 'experience_fact',
      content: cleaned,
      metadata: {
        tags: ['tool_use', context.toolName],
        source: 'auto-capture',
        sessionId: context.sessionId,
      },
    });
    this.workingBuffer.push(cleaned);
  }

  async onUserPrompt(context: PromptContext): Promise<void> {
    if (!this.capturePrompts) return;
    if (this.filter?.reject?.('prompt', context.text)) return;
    const cleaned = this.redactSecrets ? stripSecrets(context.text) : context.text;
    if (cleaned.trim().length === 0) return;
    await this.memoryStore.create({
      bankId: this.bankId,
      type: 'experience_fact',
      content: `User prompt: ${truncate(cleaned, 1000)}`,
      metadata: { tags: ['prompt'], source: 'auto-capture', sessionId: context.sessionId },
    });
  }

  async onAgentResponse(context: ResponseContext): Promise<void> {
    if (this.filter?.reject?.('response', context.text)) return;
    const cleaned = this.redactSecrets ? stripSecrets(context.text) : context.text;
    if (cleaned.trim().length === 0) return;
    await this.memoryStore.create({
      bankId: this.bankId,
      type: 'experience_fact',
      content: `Agent reply: ${truncate(cleaned, 1000)}`,
      metadata: { tags: ['response'], source: 'auto-capture', sessionId: context.sessionId },
    });
  }

  getWorkingBuffer(): readonly string[] {
    return [...this.workingBuffer];
  }

  async clearWorkingBuffer(): Promise<void> {
    this.workingBuffer = [];
  }
}

function truncate(text: string, max = 2000): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}
