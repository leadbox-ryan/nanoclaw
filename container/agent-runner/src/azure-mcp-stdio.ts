/**
 * Stdio MCP Server for Azure Application Insights
 * Provides log querying and metrics access for NanoClaw agents.
 * Receives Azure credentials via environment variables.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AzureApi } from './azure-api.js';

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  console.error('Azure credentials not set (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)');
  process.exit(1);
}

const azure = new AzureApi(tenantId, clientId, clientSecret);

const server = new McpServer({
  name: 'azure',
  version: '1.0.0',
});

server.tool(
  'test_connection',
  'Test the Azure connection and verify authentication.',
  {},
  async () => {
    const ok = await azure.testConnection();
    return {
      content: [{ type: 'text' as const, text: ok ? 'Azure connection successful.' : 'Azure connection failed.' }],
      isError: !ok,
    };
  },
);

server.tool(
  'list_app_insights',
  'List all Application Insights resources accessible with current credentials. Use this to discover which App Insights are available before querying logs.',
  {},
  async () => {
    try {
      const resources = await azure.listAppInsights();
      if (resources.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No Application Insights resources found.' }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resources, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing App Insights: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'query_logs',
  'Run a KQL (Kusto Query Language) query against Application Insights logs.',
  {
    workspace_id: z.string().describe('Application Insights workspace/app ID (use list_app_insights to find available IDs)'),
    query: z.string().describe('KQL query (e.g., "traces | where timestamp > ago(1h) | take 10")'),
    timespan: z.string().optional().describe('ISO 8601 duration (e.g., "PT1H" for 1 hour, "PT24H" for 24 hours), defaults to PT1H'),
  },
  async (args) => {
    try {
      const result = await azure.queryLogs(args.workspace_id, args.query, args.timespan);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error querying logs: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_recent_errors',
  'Get recent exceptions/errors from Application Insights.',
  {
    workspace_id: z.string().describe('Application Insights workspace/app ID'),
    hours: z.number().optional().default(24).describe('Number of hours to look back (default 24)'),
  },
  async (args) => {
    try {
      const errors = await azure.getRecentErrors(args.workspace_id, args.hours);
      if (errors.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No errors found in the specified timeframe.' }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(errors, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting recent errors: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'search_logs',
  'Search Application Insights logs for specific text across all log types.',
  {
    workspace_id: z.string().describe('Application Insights workspace/app ID'),
    search_text: z.string().describe('Text to search for in logs'),
    hours: z.number().optional().default(24).describe('Number of hours to look back (default 24)'),
  },
  async (args) => {
    try {
      const results = await azure.searchLogs(args.workspace_id, args.search_text, args.hours);
      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No logs found matching "${args.search_text}".` }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error searching logs: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
