import http from 'node:http';
import { createHttpServer } from '../http.js';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error('Server address unavailable'));
      }
    });
    server.on('error', reject);
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function initializeMessage(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };
}

async function runTest(name: string, fn: () => Promise<void>) {
  console.log(`\n🔍 Running test: ${name}`);
  try {
    await fn();
    console.log(`✅ ${name} passed`);
  } catch (error) {
    console.error(`❌ ${name} failed:`, error);
    throw error;
  }
}

async function runTests() {
  const originalToken = process.env.MCP_AUTH_TOKEN;

  await runTest('health endpoint is publicly accessible', async () => {
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/healthz');
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}: ${res.body}`);
      }
      if (res.body !== 'ok') {
        throw new Error(`Unexpected body: ${res.body}`);
      }
    } finally {
      await close(server);
    }
  });

  await runTest('mcp endpoint rejects requests without auth token', async () => {
    process.env.MCP_AUTH_TOKEN = 'secret-token';
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initializeMessage()),
      });
      if (res.status !== 401) {
        throw new Error(`Expected 401, got ${res.status}: ${res.body}`);
      }
      if (res.headers['www-authenticate'] !== 'Bearer') {
        throw new Error(`Expected WWW-Authenticate: Bearer, got ${res.headers['www-authenticate']}`);
      }
    } finally {
      await close(server);
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
  });

  await runTest('mcp endpoint rejects invalid auth token', async () => {
    process.env.MCP_AUTH_TOKEN = 'secret-token';
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: '******',
        },
        body: JSON.stringify(initializeMessage()),
      });
      if (res.status !== 401) {
        throw new Error(`Expected 401, got ${res.status}: ${res.body}`);
      }
    } finally {
      await close(server);
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
  });

  await runTest('sse endpoint rejects requests without auth token', async () => {
    process.env.MCP_AUTH_TOKEN = 'secret-token';
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/sse');
      if (res.status !== 401) {
        throw new Error(`Expected 401, got ${res.status}: ${res.body}`);
      }
    } finally {
      await close(server);
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
  });

  await runTest('messages endpoint rejects requests without auth token', async () => {
    process.env.MCP_AUTH_TOKEN = 'secret-token';
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/messages?sessionId=test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      if (res.status !== 401) {
        throw new Error(`Expected 401, got ${res.status}: ${res.body}`);
      }
    } finally {
      await close(server);
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
  });

  await runTest('auth token is not required when MCP_AUTH_TOKEN is unset', async () => {
    delete process.env.MCP_AUTH_TOKEN;
    const server = createHttpServer();
    const port = await listen(server);

    try {
      const res = await request(port, '/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(initializeMessage()),
      });
      if (res.status !== 200) {
        throw new Error(`Expected 200, got ${res.status}: ${res.body}`);
      }
    } finally {
      await close(server);
      process.env.MCP_AUTH_TOKEN = originalToken;
    }
  });
}

console.log('Starting HTTP auth tests...');
runTests()
  .then(() => console.log('All HTTP auth tests passed! 🎉'))
  .catch((error) => {
    console.error('HTTP auth tests failed:', error);
    process.exit(1);
  });
