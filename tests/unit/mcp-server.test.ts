import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SailMemMcpServer } from '../../src/mcp/server.ts';
import { SQLiteStorage } from '../../src/storage/sqlite.ts';

describe('SailMemMcpServer', () => {
  let server: SailMemMcpServer;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    storage = new SQLiteStorage({ path: ':memory:' });
    await storage.initialize();
    server = new SailMemMcpServer({ storage });
  });

  afterEach(async () => {
    if (server) await server.close();
    await storage.close();
  });

  it('exposes the McpServer instance via .mcp', () => {
    expect(server.mcp).toBeDefined();
    expect(server.mcp).toBeTruthy();
  });

  it('registers a useful set of tools', async () => {
    const tools = await server.mcp.server.listTools?.() ?? null;
    // listTools is a method on the underlying Server; fall back to internal storage if needed
    const internal: any = (server.mcp as any)._registeredTools;
    const registered = internal ? Object.keys(internal) : [];
    expect(registered).toContain('memory_save');
    expect(registered).toContain('memory_recall');
    expect(registered).toContain('memory_get');
    expect(registered).toContain('memory_delete');
    expect(registered).toContain('memory_list');
    expect(registered).toContain('bank_create');
    expect(registered).toContain('bank_list');
    expect(registered).toContain('bank_hierarchy');
    expect(registered).toContain('opinion_form');
    expect(registered).toContain('consolidate');
    expect(registered).toContain('graph_entities');
    expect(registered).toContain('stats');
  });
});
