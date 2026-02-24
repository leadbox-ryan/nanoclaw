# Agent Self-Update Guide

How to add, modify, or remove MCP servers and tools from inside the container.

## Architecture

Your MCP server source code lives at `/app/src/` inside the container. This directory is:

- **Writable** — you can create, edit, and delete files
- **Persistent** — changes survive across sessions (stored on host at `data/sessions/{group}/agent-runner-src/`)
- **Per-group** — each group gets its own copy; your changes don't affect other groups
- **Compiled on startup** — the container entrypoint runs `tsc` before starting, so changes take effect on your next session

The compiled output goes to `/tmp/dist/`. The MCP servers registered in `/app/src/index.ts` are what the Claude SDK actually loads.

## What You Can Do Yourself

### Add a new MCP server

1. **Write the API wrapper** to `/app/src/{service}-api.ts`:

```typescript
export class MyServiceApi {
  constructor(private token: string) {}
  async testConnection(): Promise<boolean> { /* ... */ }
  async doSomething(): Promise<any> { /* ... */ }
}
```

2. **Write the MCP stdio server** to `/app/src/{service}-mcp-stdio.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MyServiceApi } from './{service}-api.js';

const token = process.env.MY_SERVICE_TOKEN;
if (!token) { console.error('MY_SERVICE_TOKEN not set'); process.exit(1); }

const api = new MyServiceApi(token);
const server = new McpServer({ name: '{service}', version: '1.0.0' });

server.tool('test_connection', 'Test the connection.', {}, async () => {
  const ok = await api.testConnection();
  return {
    content: [{ type: 'text' as const, text: ok ? 'Connected.' : 'Failed.' }],
    isError: !ok,
  };
});

// Add more tools...

const transport = new StdioServerTransport();
await server.connect(transport);
```

3. **Register the MCP server** in `/app/src/index.ts`. Find the `mcpServers` object and add:

```typescript
...(containerInput.secrets?.MY_SERVICE_TOKEN && mcpPaths ? {
  myservice: {
    command: 'node',
    args: [mcpPaths.myservice],  // or path.join(__dirname, '{service}-mcp-stdio.js')
    env: {
      MY_SERVICE_TOKEN: containerInput.secrets.MY_SERVICE_TOKEN,
    },
  },
} : {}),
```

4. **Add the tool pattern** to the `allowedTools` array in the same file:

```typescript
...(containerInput.secrets?.MY_SERVICE_TOKEN ? ['mcp__myservice__*'] : []),
```

5. **Test before committing** — run this to verify your code compiles:

```bash
cd /app && npx tsc --noEmit
```

If it passes, your changes are valid TypeScript and will compile on next startup.

6. **Optional: smoke test** — compile and try starting the MCP server:

```bash
cd /app && npx tsc --outDir /tmp/test-dist 2>&1 >&2
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}},"id":1}' | MY_SERVICE_TOKEN=test node /tmp/test-dist/{service}-mcp-stdio.js
```

If it prints a JSON response without crashing, the server initializes correctly.

### Modify an existing MCP server

Edit the files directly at `/app/src/`. For example, to add a tool to the GitHub MCP:

1. Add the method to `/app/src/github-api.ts`
2. Add the tool registration to `/app/src/github-mcp-stdio.ts`
3. Run `cd /app && npx tsc --noEmit` to verify
4. Changes take effect next session

### Remove an MCP server

1. Delete the `-api.ts` and `-mcp-stdio.ts` files
2. Remove the `mcpServers` entry and `allowedTools` pattern from `/app/src/index.ts`
3. Run `cd /app && npx tsc --noEmit` to verify

## What Requires Host Changes

Some changes can't be done from inside the container. When you need these, write clear instructions to `/workspace/group/` and tell the user.

### New secrets / API keys

The host controls which secrets are passed to the container (in `src/container-runner.ts` `readSecrets()`). If you need a new secret that isn't already in the list, the host must add it.

**Currently available secrets:**
- `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`
- `HUBSPOT_API_KEY`
- `GITHUB_TOKEN`, `BITBUCKET_TOKEN`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `GOOGLE_APPLICATION_CREDENTIALS`

If a secret you need is already listed above but not set, ask the user to add it to their `.env` file. No host code change needed.

If a secret you need is NOT in the list above, write instructions for the host to add it to `readSecrets()` in `src/container-runner.ts`.

### New npm dependencies

The container image has a fixed set of npm packages. If your MCP server needs a package that isn't installed, it will fail at runtime with `Cannot find module`.

**Currently installed packages** (check `/app/package.json` for the full list):
- `@modelcontextprotocol/sdk`, `zod` (MCP framework)
- `@octokit/rest` (GitHub)
- `@azure/identity`, `@azure/monitor-query`, `@azure/arm-resources` (Azure)
- `@google-cloud/bigquery`, `@google-cloud/firestore`, `@google-cloud/storage` (Firebase/GCP)
- `@hubspot/api-client` (HubSpot)

If you need a new package, write instructions for the host to:
1. Add it to `container/agent-runner/package.json`
2. Run `npm install` in `container/agent-runner/`
3. Run `./container/build.sh` to rebuild the container image

### Container rebuild

After host-side changes (new deps, new secrets), the container must be rebuilt:

```bash
cd container/agent-runner && npm install
./container/build.sh
# Then restart the service
```

## Available MCP Servers

Current MCP servers registered in `/app/src/index.ts`:

| Server | Secret Key | Tools |
|--------|-----------|-------|
| `nanoclaw` | (always on) | send_message, schedule_task, list_tasks, etc. |
| `hubspot` | `HUBSPOT_API_KEY` | list_owners, find_owners_by_name, list_tickets, get_ticket_details, get_ticket_emails, add_note |
| `github` | `GITHUB_TOKEN` | test_connection, list_repos, read_file, search_code, list_commits, create_issue, get_repo_info |
| `azure` | `AZURE_CLIENT_ID` | test_connection, list_app_insights, query_logs, get_recent_errors, search_logs |
| `firebase` | `GOOGLE_APPLICATION_CREDENTIALS` | test_connection, query_bigquery, get_firestore_doc, query_firestore, get_storage_file, list_storage_files |

## File Layout

```
/app/src/                          ← writable, your MCP source
├── index.ts                       ← agent runner, registers MCP servers
├── ipc-mcp-stdio.ts               ← nanoclaw IPC tools
├── hubspot-api.ts                 ← HubSpot API wrapper
├── hubspot-mcp-stdio.ts           ← HubSpot MCP server
├── github-api.ts                  ← GitHub API wrapper
├── github-mcp-stdio.ts            ← GitHub MCP server
├── azure-api.ts                   ← Azure API wrapper
├── azure-mcp-stdio.ts             ← Azure MCP server
├── firebase-api.ts                ← Firebase/GCP API wrapper
└── firebase-mcp-stdio.ts          ← Firebase MCP server

/app/package.json                  ← read-only, npm deps (baked into image)
/app/node_modules/                 ← read-only, installed packages
/tmp/dist/                         ← compiled output (created on startup)
```

## Testing Checklist

Before considering a change complete:

- [ ] `cd /app && npx tsc --noEmit` passes (no type errors)
- [ ] New tools have descriptive names and descriptions
- [ ] Tool parameters use zod schemas with `.describe()` for each field
- [ ] Error handling wraps API calls in try/catch, returns `isError: true`
- [ ] Secret key is checked at startup (exit if missing)
- [ ] MCP server registered conditionally on secret presence
- [ ] Tool pattern added to `allowedTools`
- [ ] Tell the user: "Changes will take effect next session"
