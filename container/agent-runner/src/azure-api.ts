/**
 * Azure Application Insights API wrapper for NanoClaw.
 * Provides log querying and metrics access.
 */

import { ClientSecretCredential } from '@azure/identity';
import { LogsQueryClient } from '@azure/monitor-query';
import { ResourceManagementClient } from '@azure/arm-resources';

export interface AppInsightsResource {
  name: string;
  id: string;
  resourceGroup: string;
  location: string;
}

export interface LogQueryResult {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
    rows: any[][];
  }>;
}

export class AzureApi {
  private credential: ClientSecretCredential;
  private subscriptionId?: string;

  constructor(tenantId: string, clientId: string, clientSecret: string) {
    this.credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.credential.getToken('https://management.azure.com/.default');
      return !!token;
    } catch {
      return false;
    }
  }

  private async getSubscriptionId(): Promise<string> {
    if (this.subscriptionId) return this.subscriptionId;

    // List subscriptions via REST API to avoid extra SDK dependency
    const token = await this.credential.getToken('https://management.azure.com/.default');
    const response = await fetch(
      'https://management.azure.com/subscriptions?api-version=2022-12-01',
      { headers: { Authorization: `Bearer ${token.token}` } },
    );

    if (!response.ok) {
      throw new Error(`Failed to list subscriptions: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { value: Array<{ subscriptionId: string }> };
    if (!data.value || data.value.length === 0) {
      throw new Error('No subscriptions found');
    }

    this.subscriptionId = data.value[0].subscriptionId;
    return this.subscriptionId;
  }

  async listAppInsights(): Promise<AppInsightsResource[]> {
    try {
      const subId = await this.getSubscriptionId();

      const resourceClient = new ResourceManagementClient(
        this.credential,
        subId,
      );

      const resources: AppInsightsResource[] = [];

      for await (const resource of resourceClient.resources.list({
        filter: "resourceType eq 'Microsoft.Insights/components'"
      })) {
        if (resource.name && resource.id && resource.location) {
          const rgMatch = resource.id.match(/resourceGroups\/([^/]+)\//);
          const resourceGroup = rgMatch ? rgMatch[1] : 'unknown';

          resources.push({
            name: resource.name,
            id: resource.id,
            resourceGroup,
            location: resource.location,
          });
        }
      }

      return resources;
    } catch (err) {
      console.error('Error listing App Insights:', err);
      return [];
    }
  }

  async queryLogs(
    workspaceId: string,
    query: string,
    timespan?: string,
  ): Promise<LogQueryResult> {
    const client = new LogsQueryClient(this.credential);

    const result = await client.queryWorkspace(
      workspaceId,
      query,
      { duration: timespan || 'PT1H' }
    );

    if (result.status === 'Success') {
      return {
        tables: result.tables.map(table => ({
          name: table.name,
          columns: table.columnDescriptors.map((col: any) => ({
            name: col.name || '',
            type: col.type || 'string',
          })),
          rows: table.rows as any[][],
        })),
      };
    } else {
      throw new Error(`Query failed: ${result.status}`);
    }
  }

  async getRecentErrors(
    workspaceId: string,
    hours: number = 24,
  ): Promise<any[]> {
    const query = `
      exceptions
      | where timestamp > ago(${hours}h)
      | project timestamp, type, outerMessage, problemId, severityLevel
      | order by timestamp desc
      | take 100
    `;

    const result = await this.queryLogs(workspaceId, query, `PT${hours}H`);

    if (result.tables.length === 0) return [];

    const table = result.tables[0];
    return table.rows.map(row => {
      const obj: any = {};
      table.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  }

  async searchLogs(
    workspaceId: string,
    searchText: string,
    hours: number = 24,
  ): Promise<any[]> {
    const query = `
      union traces, exceptions, requests
      | where timestamp > ago(${hours}h)
      | where * has "${searchText}"
      | project timestamp, message, severityLevel, itemType
      | order by timestamp desc
      | take 100
    `;

    const result = await this.queryLogs(workspaceId, query, `PT${hours}H`);

    if (result.tables.length === 0) return [];

    const table = result.tables[0];
    return table.rows.map(row => {
      const obj: any = {};
      table.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
  }
}
