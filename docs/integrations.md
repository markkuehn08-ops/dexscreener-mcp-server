# Client Integrations

This repository exposes the DexScreener MCP server in two ways:

- **stdio** via `build/index.js` for local MCP clients
- **remote HTTP** via `build/http.js` for hosted or browser-reachable MCP clients

The remote server supports:

- `POST /mcp`, `GET /mcp`, `DELETE /mcp` for Streamable HTTP clients
- `GET /sse` and `POST /messages?sessionId=...` for legacy SSE clients
- `GET /healthz` for health checks

## Claude Desktop

Claude Desktop can run the server locally over stdio.

```bash
npm install
npm run build
npm run setup
```

The setup script updates Claude Desktop's macOS config to launch:

```json
{
  "mcpServers": {
    "dexscreener": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"]
    }
  }
}
```

If you are not on macOS, add the same server entry manually in your Claude Desktop MCP config.

## Gemini

Gemini CLI can run the server locally over stdio using the built artifact:

```json
{
  "mcpServers": {
    "dexscreener": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"]
    }
  }
}
```

For hosted Gemini integrations, deploy this repository first, then point Gemini at the public MCP endpoint:

- `https://<your-host>/mcp`

Use the remote deployment flow in [deploy.md](./deploy.md) when you need a shared endpoint instead of a local subprocess.

## ChatGPT / OpenAI

Hosted OpenAI MCP integrations require a publicly reachable MCP server. For this repository, deploy the HTTP entrypoint and register the public endpoint in your OpenAI or ChatGPT MCP configuration:

- `https://<your-host>/mcp`

Use [deploy.md](./deploy.md) to publish the server to Cloud Run. The local stdio entrypoint is still useful for local development and inspection, but hosted ChatGPT integrations need the remote endpoint.

## NotebookLM

NotebookLM is not a first-party MCP client, so this repository does not provide a direct NotebookLM connection flow.

If you want NotebookLM involved in the workflow, the practical options are:

- use NotebookLM alongside Claude, Gemini, or ChatGPT while those clients connect to this MCP server
- use a separate community-maintained NotebookLM bridge, then keep this DexScreener server as an independent MCP tool

This repository does not bundle or configure any unofficial NotebookLM bridge.
