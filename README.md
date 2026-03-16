# openapi-mcpify

Turn any OpenAPI spec into a live MCP server — with built-in confirmation prompts for mutating operations.

## What it does

`openapi-mcpify` reads an OpenAPI 3.x spec, generates one MCP tool per route, and exposes them over stdio. When an AI agent tries to call a `POST`, `PUT`, or `DELETE` route, it triggers a MCP elicitation dialog asking the user to confirm before the HTTP request is actually sent.

```
OpenAPI spec  →  MCP tools  →  AI agent calls  →  (confirm if mutating)  →  HTTP request
```

---

## Usage (user)

### With bunx

```bash
bunx openapi-mcpify --spec ./openapi.json --url https://api.example.com
```

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `--spec` | yes | Path or URL to the OpenAPI 3.x spec (JSON or YAML) |
| `--url` | yes | Base URL of the target API |
| `--default-args` | no | JSON string injected into every tool call (useful for auth headers) |
| `--disable-methods` | no | Comma-separated HTTP methods to exclude (e.g. `post,delete`) |

### Examples

```bash
# Basic usage
dist/index.js --spec ./petstore.json --url https://petstore.example.com

# With an auth header injected by default
dist/index.js \
  --spec ./petstore.json \
  --url https://petstore.example.com \
  --default-args '{"headers": {"Authorization": "Bearer mytoken"}}'

# Read-only mode: disable all mutating methods
dist/index.js \
  --spec ./petstore.json \
  --url https://petstore.example.com \
  --disable-methods post,put,delete,patch
```

### Claude Desktop / MCP client config

Add this to your MCP client configuration (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "petstore": {
      "command": "dist/index.js",
      "args": [
        "--spec", "/path/to/openapi.json",
        "--url", "https://api.example.com",
        "--default-args", "{\"headers\":{\"Authorization\":\"Bearer mytoken\"}}"
      ]
    }
  }
}
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0

### Install

```bash
bun install
```

### Build

```bash
bun run build
```

The compiled output lands in `dist/`.

### Project structure

```
src/
  index.ts   — entry point, wires CLI args → OpenAPI → MCP server
  cli.ts     — argument parser
  swager.ts  — OpenAPI spec loader & route extractor
  tool.ts    — OpenAPI route → MCP tool + HTTP call + elicitation logic
```

### How tools are generated

Each route in the spec becomes one MCP tool named `{METHOD}_{path}` (e.g. `GET_pets__id_`). Its input schema is built from:

- **path parameters** → required fields
- **query parameters** → optional or required per spec
- **request body** (`application/json`) → `body` field
- **`headers`** → always optional, merged with `--default-args` headers

### Elicitation (confirmation dialog)

For `POST`, `PUT`, and `DELETE` routes, the server calls `server.elicitInput()` before executing the HTTP request. The client (e.g. Claude Desktop) displays a confirmation form showing the method, path, and parameters. The request is only sent if the user confirms.

---

## License

MIT
