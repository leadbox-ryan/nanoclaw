/**
 * Stdio MCP Server for HubSpot
 * Provides NanoClaw agents with ticket reading, email fetching, and note creation.
 * Receives HUBSPOT_API_KEY via environment variable (from NanoClaw secrets pipeline).
 * V2: Added text search and owner name lookup
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HubSpotApi } from './hubspot-api.js';

const apiKey = process.env.HUBSPOT_API_KEY;
if (!apiKey) {
  console.error('HUBSPOT_API_KEY not set');
  process.exit(1);
}

const hubspot = new HubSpotApi(apiKey);

const server = new McpServer({
  name: 'hubspot',
  version: '2.0.0',
});

server.tool(
  'test_connection',
  'Test the HubSpot API connection. Verifies the API key works and has the right permissions.',
  {},
  async () => {
    const ok = await hubspot.testConnection();
    return {
      content: [{ type: 'text' as const, text: ok ? 'HubSpot connection successful.' : 'HubSpot connection failed.' }],
      isError: !ok,
    };
  },
);

server.tool(
  'list_owners',
  'List all HubSpot owners (users) with their IDs, names, and emails. Use this to find owner IDs for filtering tickets.',
  {},
  async () => {
    try {
      const owners = await hubspot.listOwners();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(owners, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing owners: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'find_owners_by_name',
  'Search for HubSpot owners by name or email. Returns matching owners with their IDs. Use this to find owner IDs when you know a name like "Ryan J".',
  {
    search_name: z.string().describe('Name or email to search for (e.g., "Ryan", "Ryan J", "ryan@example.com")'),
  },
  async (args) => {
    try {
      const owners = await hubspot.findOwnersByName(args.search_name);
      if (owners.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No owners found matching "${args.search_name}".` }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(owners, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error searching owners: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'list_tickets',
  'List/search HubSpot tickets with optional filters. Returns ticket ID, subject, group, priority, status, owner, and creation date. Supports text search in subject.',
  {
    groups: z.array(z.string()).optional().describe('Filter by group names (e.g., ["Mobile", "Front-end"])'),
    statuses: z.array(z.string()).optional().describe('Filter by pipeline stage IDs'),
    priorities: z.array(z.string()).optional().describe('Filter by priority levels (e.g., ["HIGH", "MEDIUM"])'),
    owners: z.array(z.string()).optional().describe('Filter by owner IDs (use find_owners_by_name to get IDs from names)'),
    search_text: z.string().optional().describe('Search for text in ticket subject (e.g., "Vehicles Syncing")'),
    limit: z.number().optional().default(100).describe('Max tickets to return (default 100)'),
  },
  async (args) => {
    try {
      const tickets = await hubspot.listTickets({
        groups: args.groups,
        statuses: args.statuses,
        priorities: args.priorities,
        owners: args.owners,
        searchText: args.search_text,
      });
      const limited = tickets.slice(0, args.limit ?? 100);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(limited, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing tickets: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_ticket_details',
  'Get full details for a specific HubSpot ticket including subject, content, group, priority, status, category, owner, and associated contacts/companies.',
  {
    ticket_id: z.string().describe('The HubSpot ticket ID'),
  },
  async (args) => {
    try {
      const ticket = await hubspot.getTicketDetails(args.ticket_id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(ticket, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting ticket ${args.ticket_id}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_ticket_emails',
  'Get the full email conversation thread for a ticket. Returns all associated emails with subject, from, to, date, and cleaned plain-text body (HTML stripped). Sorted oldest first.',
  {
    ticket_id: z.string().describe('The HubSpot ticket ID'),
  },
  async (args) => {
    try {
      const emails = await hubspot.getTicketEmails(args.ticket_id);
      if (emails.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No emails found for this ticket.' }] };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(emails, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting emails for ticket ${args.ticket_id}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'add_note',
  'Add an internal note to a HubSpot ticket. Use for recording findings, status updates, or analysis results.',
  {
    ticket_id: z.string().describe('The HubSpot ticket ID'),
    note: z.string().describe('The note body text (supports HTML)'),
  },
  async (args) => {
    try {
      const ok = await hubspot.addNoteToTicket(args.ticket_id, args.note);
      return {
        content: [{ type: 'text' as const, text: ok ? `Note added to ticket ${args.ticket_id}.` : `Failed to add note to ticket ${args.ticket_id}.` }],
        isError: !ok,
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error adding note to ticket ${args.ticket_id}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
