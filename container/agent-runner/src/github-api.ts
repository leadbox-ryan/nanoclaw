/**
 * GitHub API wrapper for the NanoClaw GitHub MCP server.
 * Provides repo access, code search, and issue creation.
 */

import { Octokit } from '@octokit/rest';

export interface RepoFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

export interface SearchResult {
  path: string;
  repository: string;
  matches: Array<{ line: number; text: string }>;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export class GitHubApi {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.octokit.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
  }

  async readFile(owner: string, repo: string, path: string, ref?: string): Promise<RepoFile> {
    const response = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    const file = response.data as any;

    if (file.type !== 'file') {
      throw new Error(`Path ${path} is not a file`);
    }

    let content = '';
    if (file.content && file.encoding === 'base64') {
      content = Buffer.from(file.content, 'base64').toString('utf-8');
    }

    return {
      name: file.name,
      path: file.path,
      sha: file.sha,
      size: file.size,
      content,
      encoding: file.encoding,
    };
  }

  async searchCode(query: string, owner?: string, repo?: string): Promise<SearchResult[]> {
    let fullQuery = query;
    if (owner && repo) {
      fullQuery = `${query} repo:${owner}/${repo}`;
    } else if (owner) {
      fullQuery = `${query} user:${owner}`;
    }

    const response = await this.octokit.search.code({
      q: fullQuery,
      per_page: 20,
    });

    return response.data.items.map((item: any) => ({
      path: item.path,
      repository: item.repository.full_name,
      matches: item.text_matches?.map((match: any) => ({
        line: 0, // GitHub doesn't provide line numbers in search
        text: match.fragment,
      })) || [],
    }));
  }

  async listCommits(owner: string, repo: string, path?: string, limit: number = 10): Promise<Commit[]> {
    const response = await this.octokit.repos.listCommits({
      owner,
      repo,
      path,
      per_page: limit,
    });

    return response.data.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: commit.commit.author.date,
      url: commit.html_url,
    }));
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<{ number: number; url: string }> {
    const response = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
    });

    return {
      number: response.data.number,
      url: response.data.html_url,
    };
  }

  async getRepoInfo(owner: string, repo: string): Promise<any> {
    const response = await this.octokit.repos.get({
      owner,
      repo,
    });

    return {
      name: response.data.name,
      full_name: response.data.full_name,
      description: response.data.description,
      language: response.data.language,
      default_branch: response.data.default_branch,
      url: response.data.html_url,
    };
  }

  async listRepos(): Promise<Array<{ name: string; fullName: string; language: string | null }>> {
    const response = await this.octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
    });

    return response.data.map((repo: any) => ({
      name: repo.name,
      fullName: repo.full_name,
      language: repo.language,
    }));
  }
}
