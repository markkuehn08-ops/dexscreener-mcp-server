#!/usr/bin/env node
import http from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { DexScreenerService } from './services/dexscreener.js';
import { DexScreenerMcpServer } from './server.js';

const PORT = Number(process.env.PORT) || 8080;

// One SSE stream per client session; POSTs are routed back to the matching
// stream by sessionId (assigned by SSEServerTransport on connect).
const transports = new Map<string, SSEServerTransport>();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sse') {
    const dexService = new DexScreenerService();
    const mcpServer = new DexScreenerMcpServer(dexService);
    const transport = new SSEServerTransport('/messages', res);

    transports.set(transport.sessionId, transport);
    res.on('close', () => transports.delete(transport.sessionId));

    try {
      await mcpServer.getServer().connect(transport);
    } catch (error) {
      console.error('[MCP Error] failed to establish SSE session', error);
      transports.delete(transport.sessionId);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId');
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Unknown or missing sessionId');
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

httpServer.listen(PORT, () => {
  console.error(`DexScreener MCP server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
