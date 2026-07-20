import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryCapturer } from '../../src/capture/memory-capturer.ts';
import { MemoryStore } from '../../src/core/memory-store.ts';
import { BankManager } from '../../src/core/bank-manager.ts';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';

describe('MemoryCapturer (with privacy filter)', () => {
  let storage: SQLiteStorage;
  let memoryStore: MemoryStore;
  let capturer: MemoryCapturer;
  let bankId: string;

  beforeEach(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    const bankManager = new BankManager({ storage });
    memoryStore = new MemoryStore({ storage });
    const bank = await bankManager.create({ name: 'b', level: 'global' });
    bankId = bank.id;
    capturer = new MemoryCapturer({
      bankId,
      memoryStore,
      redactSecrets: true,
      captureTools: true,
      capturePrompts: true,
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  it('captures session lifecycle', async () => {
    await capturer.onSessionStart({
      bankId,
      sessionId: 'sess-1',
      startedAt: new Date(),
    });
    await capturer.onSessionEnd({
      bankId,
      sessionId: 'sess-1',
      startedAt: new Date(Date.now() - 5000),
    });
    const all = await memoryStore.listByBank(bankId);
    const sessionEvents = all.filter((m) => m.metadata.tags?.includes('session'));
    expect(sessionEvents).toHaveLength(2);
  });

  it('captures tool use and populates working buffer', async () => {
    await capturer.onPostToolUse(
      { sessionId: 'sess-1', toolName: 'web_search' },
      { success: true, summary: 'Results returned' }
    );
    const all = await memoryStore.listByBank(bankId);
    const toolMemories = all.filter((m) => m.metadata.tags?.includes('tool_use'));
    expect(toolMemories).toHaveLength(1);
    expect(toolMemories[0].content).toContain('web_search');
    expect(capturer.getWorkingBuffer()).toHaveLength(1);
  });

  it('redacts secrets before storing', async () => {
    await capturer.onPostToolUse(
      { sessionId: 'sess-1', toolName: 'deploy' },
      { success: true, summary: 'deploying with secret=sk-abc123def456ghi789jkl012mno345pqr' }
    );
    const all = await memoryStore.listByBank(bankId);
    const mem = all.find((m) => m.metadata.tags?.includes('tool_use'));
    expect(mem).toBeDefined();
    expect(mem?.content).not.toContain('sk-abc');
    expect(mem?.content).toContain('[REDACTED]');
  });

  it('does not capture tools when captureTools=false', async () => {
    const quiet = new MemoryCapturer({
      bankId,
      memoryStore,
      captureTools: false,
    });
    await quiet.onPostToolUse(
      { sessionId: 'sess-1', toolName: 'noop' },
      { success: true }
    );
    const all = await memoryStore.listByBank(bankId);
    expect(all.filter((m) => m.metadata.tags?.includes('tool_use'))).toHaveLength(0);
  });

  it('does not capture prompts when capturePrompts=false (default)', async () => {
    const quiet = new MemoryCapturer({
      bankId,
      memoryStore,
    });
    await quiet.onUserPrompt({
      sessionId: 'sess-1',
      text: 'hello world',
    });
    const all = await memoryStore.listByBank(bankId);
    expect(all.filter((m) => m.metadata.tags?.includes('prompt'))).toHaveLength(0);
  });

  it('capturePrompts=true records user prompts', async () => {
    const loud = new MemoryCapturer({
      bankId,
      memoryStore,
      capturePrompts: true,
    });
    await loud.onUserPrompt({ sessionId: 'sess-1', text: 'hello world' });
    const all = await memoryStore.listByBank(bankId);
    expect(all.filter((m) => m.metadata.tags?.includes('prompt'))).toHaveLength(1);
  });
});
