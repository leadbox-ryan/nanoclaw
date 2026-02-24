/**
 * Stdio MCP Server for GitHub
 * Provides repo access, code search, and issue creation for NanoClaw agents.
 * Receives GITHUB_TOKEN via environment variable.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GitHubApi } from './github-api.js';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN not set');
  process.exit(1);
}

const github = new GitHubApi(token);

const server = new McpServer({
  name: 'github',
  version: '1.0.0',
});

server.tool(
  'test_connection',
  'Test the GitHub API connection and verify authentication.',
  {},
  async () => {
    const ok = await github.testConnection();
    return {
      content: [{ type: 'text' as const, text: ok ? 'GitHub connection successful.' : 'GitHub connection failed.' }],
      isError: !ok,
    };
  },
);

server.tool(
  'list_repos',
  'List all repositories accessible with the current token, sorted by recent activity.',
  {},
  async () => {
    try {
      const repos = await github.listRepos();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(repos, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing repos: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'read_file',
  'Read the contents of a file from a GitHub repository.',
  {
    owner: z.string().describe('Repository owner (user or org)'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path within the repository'),
    ref: z.string().optional().describe('Git ref (branch/tag/commit), defaults to default branch'),
  },
  async (args) => {
    try {
      const file = await github.readFile(args.owner, args.repo, args.path, args.ref);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(file, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading file: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'search_code',
  'Search for code across GitHub repositories. Returns matching files and code snippets.',
  {
    query: z.string().describe('Search query (e.g., "function handleError", "class UserModel")'),
    owner: z.string().optional().describe('Limit search to specific owner/org'),
    repo: z.string().optional().describe('Limit search to specific repository (requires owner)'),
  },
  async (args) => {
    try {
      const results = await github.searchCode(args.query, args.owner, args.repo);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error searching code: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'list_commits',
  'List recent commits for a repository or specific file.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().optional().describe('Optional: filter commits to specific file/directory'),
    limit: z.number().optional().default(10).describe('Number of commits to return (default 10)'),
  },
  async (args) => {
    try {
      const commits = await github.listCommits(args.owner, args.repo, args.path, args.limit);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(commits, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error listing commits: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'create_issue',
  'Create a new GitHub issue in a repository.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('Issue title'),
    body: z.string().describe('Issue body (markdown supported)'),
    labels: z.array(z.string()).optional().describe('Optional labels to apply'),
  },
  async (args) => {
    try {
      const issue = await github.createIssue(args.owner, args.repo, args.title, args.body, args.labels);
      return {
        content: [{ type: 'text' as const, text: `Issue created: #${issue.number}\nURL: ${issue.url}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error creating issue: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_repo_info',
  'Get metadata and information about a repository.',
  {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
  },
  async (args) => {
    try {
      const info = await github.getRepoInfo(args.owner, args.repo);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error getting repo info: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
