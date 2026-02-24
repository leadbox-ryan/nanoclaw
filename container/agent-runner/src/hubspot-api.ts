/**
 * HubSpot API wrapper for the NanoClaw HubSpot MCP server.
 * Provides ticket reading, email fetching, and note creation.
 * V2: Added text search and owner name lookup
 */

import { Client } from '@hubspot/api-client';
import { convert as htmlToText } from 'html-to-text';

export interface HubSpotTicket {
  id: string;
  properties: Record<string, string | null>;
  associations?: Record<string, Array<{ id: string }>>;
}

export interface TicketEmail {
  id: string;
  subject?: string;
  from?: string;
  to?: string;
  text?: string;
  createdAt?: string;
}

export interface ListTicketsFilters {
  groups?: string[];
  statuses?: string[];
  priorities?: string[];
  owners?: string[];
  searchText?: string;
}

const TICKET_PROPERTIES = [
  'subject',
  'content',
  'group',
  'hs_ticket_priority',
  'hs_pipeline_stage',
  'createdate',
  'hubspot_owner_id',
];

const TICKET_DETAIL_PROPERTIES = [
  ...TICKET_PROPERTIES,
  'hs_ticket_category',
];

const EMAIL_PROPERTIES = [
  'hs_email_text',
  'hs_email_html',
  'hs_email_subject',
  'hs_email_from',
  'hs_email_to',
  'hs_timestamp',
  'hs_email_date',
  'hs_createdate',
];

export class HubSpotApi {
  private client: Client;
  private ownerCache: Array<{ id: string; email: string; firstName: string; lastName: string; fullName: string }> | null = null;

  constructor(apiKey: string) {
    this.client = new Client({ accessToken: apiKey });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.crm.tickets.basicApi.getPage(1);
      return true;
    } catch {
      return false;
    }
  }

  async listOwners(): Promise<Array<{ id: string; email: string; firstName: string; lastName: string; fullName: string }>> {
    if (this.ownerCache) {
      return this.ownerCache;
    }

    try {
      const response = await this.client.crm.owners.ownersApi.getPage(undefined, undefined, undefined);
      this.ownerCache = response.results.map((owner: any) => {
        const firstName = owner.firstName || '';
        const lastName = owner.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();
        return {
          id: owner.id,
          email: owner.email || '',
          firstName,
          lastName,
          fullName,
        };
      });
      return this.ownerCache;
    } catch {
      return [];
    }
  }

  async findOwnersByName(searchName: string): Promise<Array<{ id: string; email: string; fullName: string }>> {
    const owners = await this.listOwners();
    const lowerSearch = searchName.toLowerCase();

    return owners
      .filter(owner =>
        owner.fullName.toLowerCase().includes(lowerSearch) ||
        owner.firstName.toLowerCase().includes(lowerSearch) ||
        owner.lastName.toLowerCase().includes(lowerSearch) ||
        owner.email.toLowerCase().includes(lowerSearch)
      )
      .map(({ id, email, fullName }) => ({ id, email, fullName }));
  }

  async listTickets(filters?: ListTicketsFilters): Promise<HubSpotTicket[]> {
    const filterGroups: Array<{ propertyName: string; operator: string; values?: string[]; value?: string }> = [];

    if (filters?.groups?.length) {
      filterGroups.push({
        propertyName: 'group',
        operator: 'IN',
        values: filters.groups,
      });
    }

    if (filters?.statuses?.length) {
      filterGroups.push({
        propertyName: 'hs_pipeline_stage',
        operator: 'IN',
        values: filters.statuses,
      });
    }

    if (filters?.priorities?.length) {
      filterGroups.push({
        propertyName: 'hs_ticket_priority',
        operator: 'IN',
        values: filters.priorities,
      });
    }

    if (filters?.owners?.length) {
      filterGroups.push({
        propertyName: 'hubspot_owner_id',
        operator: 'IN',
        values: filters.owners,
      });
    }

    if (filters?.searchText) {
      filterGroups.push({
        propertyName: 'subject',
        operator: 'CONTAINS_TOKEN',
        value: filters.searchText,
      });
    }

    let results;

    if (filterGroups.length > 0) {
      const response = await this.client.crm.tickets.searchApi.doSearch({
        filterGroups: [{ filters: filterGroups }],
        properties: TICKET_PROPERTIES,
        limit: 100,
        sorts: [],
        after: '0',
      } as any);
      results = response.results;
    } else {
      const response = await this.client.crm.tickets.basicApi.getPage(
        100,
        undefined,
        TICKET_PROPERTIES,
        undefined,
        undefined,
        false,
      );
      results = response.results;
    }

    return results.map((ticket: any) => ({
      id: ticket.id,
      properties: ticket.properties,
    }));
  }

  async getTicketDetails(ticketId: string): Promise<HubSpotTicket> {
    const ticket = await this.client.crm.tickets.basicApi.getById(
      ticketId,
      TICKET_DETAIL_PROPERTIES,
      undefined,
      ['contacts', 'companies'],
      false,
    );

    return {
      id: ticket.id,
      properties: ticket.properties as any,
      associations: ticket.associations as any,
    };
  }

  async getTicketEmails(ticketId: string): Promise<TicketEmail[]> {
    const ticket = await this.client.crm.tickets.basicApi.getById(
      ticketId,
      ['subject'],
      undefined,
      ['emails'],
      false,
    );

    const emailIds = (ticket.associations as any)?.emails?.results?.map((e: any) => e.id) || [];

    if (emailIds.length === 0) {
      return [];
    }

    const emails: TicketEmail[] = [];

    for (const emailId of emailIds) {
      const email = await this.getEmailContent(emailId);
      if (email) {
        emails.push(email);
      }
    }

    // Sort by date, oldest first
    emails.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateA - dateB;
    });

    return emails;
  }

  private async getEmailContent(emailId: string): Promise<TicketEmail | null> {
    try {
      const email = await this.client.crm.objects.emails.basicApi.getById(
        emailId,
        EMAIL_PROPERTIES,
        undefined,
        undefined,
        false,
      );

      const props = email.properties as any;

      // Get HTML or plain text content
      const rawContent = props.hs_email_html || props.hs_email_text || '';

      // Convert HTML to plain text for cleaner output
      let cleanText = rawContent;
      if (props.hs_email_html) {
        cleanText = htmlToText(props.hs_email_html, {
          wordwrap: 120,
          selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
          ],
        });

        // Clean up excessive whitespace and empty quoted lines
        cleanText = cleanText
          .split('\n')
          .filter((line: string) => {
            const strippedLine = line.replace(/>/g, '').trim();
            return strippedLine.length > 0;
          })
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }

      // Parse timestamp from multiple possible fields
      let createdAt: string;
      if (props.hs_email_date) {
        createdAt = new Date(parseInt(props.hs_email_date)).toISOString();
      } else if (props.hs_timestamp) {
        createdAt = new Date(parseInt(props.hs_timestamp)).toISOString();
      } else if (props.hs_createdate) {
        createdAt = new Date(props.hs_createdate).toISOString();
      } else if (email.createdAt) {
        createdAt = typeof email.createdAt === 'string' ? email.createdAt : email.createdAt.toISOString();
      } else {
        createdAt = new Date().toISOString();
      }

      return {
        id: email.id,
        text: cleanText,
        subject: props.hs_email_subject || undefined,
        from: props.hs_email_from || undefined,
        to: props.hs_email_to || undefined,
        createdAt,
      };
    } catch {
      return null;
    }
  }

  async addNoteToTicket(ticketId: string, noteBody: string): Promise<boolean> {
    try {
      await this.client.crm.objects.notes.basicApi.create({
        properties: {
          hs_timestamp: Date.now().toString(),
          hs_note_body: noteBody,
        },
        associations: [
          {
            to: { id: ticketId },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: 16,
              },
            ],
          },
        ],
      } as any);
      return true;
    } catch {
      return false;
    }
  }
}
