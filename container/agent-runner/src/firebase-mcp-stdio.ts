/**
 * Stdio MCP Server for Firebase/Google Cloud
 * Provides BigQuery, Firestore, and Cloud Storage access for NanoClaw agents.
 * Receives GOOGLE_APPLICATION_CREDENTIALS via environment variable.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FirebaseApi } from './firebase-api.js';

import fs from 'fs';
import path from 'path';

const credentialsValue = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentialsValue) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS not set');
  process.exit(1);
}

// Credentials may be a file path or inline JSON content.
// If it looks like JSON, write to a temp file so the Google SDKs can read it.
let credentialsPath: string;
if (credentialsValue.trim().startsWith('{')) {
  const tmpPath = '/tmp/gcp-credentials.json';
  fs.writeFileSync(tmpPath, credentialsValue);
  credentialsPath = tmpPath;
} else {
  credentialsPath = credentialsValue;
}

const firebase = new FirebaseApi(credentialsPath);

const server = new McpServer({
  name: 'firebase',
  version: '1.0.0',
});

server.tool(
  'test_connection',
  'Test the Google Cloud/Firebase connection and verify authentication.',
  {},
  async () => {
    const ok = await firebase.testConnection();
    return {
      content: [{ type: 'text' as const, text: ok ? 'Firebase/GCP connection successful.' : 'Firebase/GCP connection failed.' }],
      isError: !ok,
    };
  },
);

server.tool(
  'query_bigquery',
  'Run a SQL query against BigQuery (Firebase Analytics data is typically in BigQuery).',
  {
    query: z.string().describe('SQL query (e.g., "SELECT * FROM `project.dataset.table` WHERE date = CURRENT_DATE() LIMIT 10")'),
  },
  async (args) => {
    try {
      const result = await firebase.queryBigQuery(args.query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error querying BigQuery: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_firestore_doc',
  'Read a single document from Firestore by collection and document ID.',
  {
    collection: z.string().describe('Firestore collection name'),
    doc_id: z.string().describe('Document ID'),
  },
  async (args) => {
    try {
      const doc = await firebase.getFirestoreDoc(args.collection, args.doc_id);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(doc, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting Firestore doc: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'query_firestore',
  'Query a Firestore collection with optional filtering.',
  {
    collection: z.string().describe('Firestore collection name'),
    field: z.string().optional().describe('Field to filter on'),
    operator: z.enum(['==', '<', '<=', '>', '>=', '!=', 'array-contains']).optional().describe('Comparison operator'),
    value: z.any().optional().describe('Value to compare against'),
    limit: z.number().optional().default(10).describe('Max results to return (default 10)'),
  },
  async (args) => {
    try {
      const docs = await firebase.queryFirestore(
        args.collection,
        args.field,
        args.operator,
        args.value,
        args.limit,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(docs, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error querying Firestore: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_storage_file',
  'Get a file from Google Cloud Storage (for images, crash logs, etc).',
  {
    bucket: z.string().describe('Storage bucket name'),
    file_path: z.string().describe('Path to file within bucket'),
  },
  async (args) => {
    try {
      const { content, metadata } = await firebase.getStorageFile(args.bucket, args.file_path);

      // For text files, include content; for binary, just metadata
      const isText = metadata.contentType?.startsWith('text/') || metadata.contentType?.includes('json');
      const result: any = { metadata };

      if (isText && content.length < 100000) { // Limit to 100KB for text
        result.content = content.toString('utf-8');
      } else {
        result.contentSizeBytes = content.length;
        result.note = 'Content too large or binary, use direct download';
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting storage file: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'list_storage_files',
  'List files in a Google Cloud Storage bucket with optional prefix filter.',
  {
    bucket: z.string().describe('Storage bucket name'),
    prefix: z.string().optional().describe('Optional prefix to filter files (e.g., "logs/", "images/2024/")'),
    max_results: z.number().optional().default(100).describe('Max files to return (default 100)'),
  },
  async (args) => {
    try {
      const files = await firebase.listStorageFiles(args.bucket, args.prefix, args.max_results);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing storage files: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
