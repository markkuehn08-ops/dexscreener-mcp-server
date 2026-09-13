#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { DexScreenerService } from './services/dexscreener.js';
import { DexScreenerMcpServer } from './server.js';

const PORT = Number(process.env.PORT) || 8080;

const sseTransports = new Map<string, SSEServerTransport>();
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer() {
  const dexService = new DexScreenerService();
  return new DexScreenerMcpServer(dexService).getServer();
}

function writeJsonError(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message,
      },
      id: null,
    }),
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody);
}

async function handleStreamableRequest(req: IncomingMessage, res: ServerResponse) {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
  let transport = sessionId ? streamableTransports.get(sessionId) : undefined;
  let parsedBody: unknown;

  if (!transport) {
    if (req.method !== 'POST') {
      writeJsonError(res, 400, 'Bad Request: No valid session ID provided');
      return;
    }

    try {
      parsedBody = await readJsonBody(req);
    } catch {
      writeJsonError(res, 400, 'Bad Request: Invalid JSON body');
      return;
    }

    if (!isInitializeRequest(parsedBody)) {
      writeJsonError(res, 400, 'Bad Request: Initial request must be initialize');
      return;
    }

    const server = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        streamableTransports.set(newSessionId, transport!);
      },
    });

    transport.onclose = () => {
      if (transport?.sessionId) {
        streamableTransports.delete(transport.sessionId);
      }
    };

    transport.onerror = (error) => {
      console.error('[MCP Error] streamable HTTP transport', error);
    };

    await server.connect(transport);
  }

  await transport.handleRequest(req, res, parsedBody);
}

export function createHttpServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if ((req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE') && url.pathname === '/mcp') {
      try {
        await handleStreamableRequest(req, res);
      } catch (error) {
        console.error('[MCP Error] failed to handle streamable HTTP request', error);
        if (!res.headersSent) {
          writeJsonError(res, 500, 'Internal server error');
        }
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sse') {
      const server = createMcpServer();
      const transport = new SSEServerTransport('/messages', res);

      sseTransports.set(transport.sessionId, transport);
      res.on('close', () => sseTransports.delete(transport.sessionId));

      try {
        await server.connect(transport);
      } catch (error) {
        console.error('[MCP Error] failed to establish SSE session', error);
        sseTransports.delete(transport.sessionId);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? sseTransports.get(sessionId) : undefined;

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
}

const httpServer = createHttpServer();

httpServer.listen(PORT, () => {
  console.error(`DexScreener MCP server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
