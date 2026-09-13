#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DexScreenerMcpServer } from './server.js';

async function main() {
  const { DexScreenerService } = await import('./services/dexscreener.js');
  const dexService = new DexScreenerService();
  const mcpServer = new DexScreenerMcpServer(dexService);
  const server = mcpServer.getServer();

  server.onerror = (error: Error) => console.error('[MCP Error]', error);
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DexScreener MCP server running on stdio');
}

main().catch(console.error);
