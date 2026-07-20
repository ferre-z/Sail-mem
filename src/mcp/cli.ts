#!/usr/bin/env node
import { createMcpServer } from '../mcp/server.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  await server.connectStdio();

  const shutdown = async (signal: string) => {
    console.error(`sail-mem MCP server received ${signal}, shutting down`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal MCP server error:', err);
  process.exit(1);
});
