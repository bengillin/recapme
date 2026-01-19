/**
 * Notion API Integration
 * Creates recap pages in Notion
 */

const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionPage {
  id: string;
  url: string;
  title: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
}

export class NotionAPIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'NotionAPIError';
  }
}

/**
 * Make a request to the Notion API
 */
async function notionRequest<T>(
  token: string,
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown
): Promise<T> {
  const response = await fetch(`${NOTION_API_URL}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new NotionAPIError('Invalid Notion integration token', 401);
    }
    const error = await response.json().catch(() => ({}));
    throw new NotionAPIError(
      error.message || `Notion API error: ${response.statusText}`,
      response.status
    );
  }

  return response.json();
}

/**
 * Validate Notion integration token
 */
export async function validateNotionToken(token: string): Promise<boolean> {
  try {
    await notionRequest(token, '/users/me');
    return true;
  } catch {
    return false;
  }
}

/**
 * Search for accessible databases
 */
export async function searchDatabases(token: string): Promise<NotionDatabase[]> {
  interface NotionSearchResponse {
    results: Array<{
      id: string;
      url: string;
      title?: Array<{ plain_text: string }>;
    }>;
  }

  const response = await notionRequest<NotionSearchResponse>(
    token,
    '/search',
    'POST',
    {
      filter: { property: 'object', value: 'database' },
      page_size: 50,
    }
  );

  return response.results.map(db => ({
    id: db.id,
    title: db.title?.[0]?.plain_text || 'Untitled',
    url: db.url,
  }));
}

/**
 * Search for accessible pages
 */
export async function searchPages(token: string, query?: string): Promise<NotionPage[]> {
  interface NotionSearchResponse {
    results: Array<{
      id: string;
      url: string;
      properties?: {
        title?: {
          title?: Array<{ plain_text: string }>;
        };
        Name?: {
          title?: Array<{ plain_text: string }>;
        };
      };
    }>;
  }

  const response = await notionRequest<NotionSearchResponse>(
    token,
    '/search',
    'POST',
    {
      query: query || '',
      filter: { property: 'object', value: 'page' },
      page_size: 20,
    }
  );

  return response.results.map(page => ({
    id: page.id,
    url: page.url,
    title: page.properties?.title?.title?.[0]?.plain_text || 
           page.properties?.Name?.title?.[0]?.plain_text || 
           'Untitled',
  }));
}

/**
 * Create a rich text block
 */
function richText(content: string, bold = false, link?: string): object {
  const text: { content: string; link?: { url: string } } = { content };
  if (link) {
    text.link = { url: link };
  }
  return {
    type: 'text',
    text,
    annotations: { bold },
  };
}

/**
 * Create a heading block
 */
function heading(level: 1 | 2 | 3, content: string): object {
  return {
    object: 'block',
    type: `heading_${level}`,
    [`heading_${level}`]: {
      rich_text: [richText(content)],
    },
  };
}

/**
 * Create a paragraph block
 */
function paragraph(content: string): object {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [richText(content)],
    },
  };
}

/**
 * Create a bulleted list item
 */
function bulletItem(content: string): object {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [richText(content)],
    },
  };
}

/**
 * Create a callout block
 */
function callout(content: string, emoji: string): object {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [richText(content)],
      icon: { type: 'emoji', emoji },
    },
  };
}

/**
 * Create a divider block
 */
function divider(): object {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

/**
 * Create a table of contents block
 */
function tableOfContents(): object {
  return {
    object: 'block',
    type: 'table_of_contents',
    table_of_contents: {},
  };
}

export interface RecapPageContent {
  title: string;
  dateRange: { from: string; to: string };
  summary: {
    featuresWorkedOn: number;
    averageReadiness: number;
    status: string;
  };
  features: Array<{
    name: string;
    status: string;
    readiness: number;
    summary: string;
    ticketUrl?: string;
    ticketId?: string;
    changes: string[];
  }>;
  highlights: string[];
  blockers: string[];
  figmaFileUrl?: string;
}

/**
 * Create a recap page in Notion
 */
export async function createRecapPage(
  token: string,
  parentPageId: string,
  content: RecapPageContent
): Promise<NotionPage> {
  const blocks: object[] = [];

  // Summary callout
  const statusEmoji = content.summary.status === 'on-track' ? '✅' : 
                     content.summary.status === 'at-risk' ? '⚠️' : '🚫';
  blocks.push(callout(
    `${content.summary.featuresWorkedOn} features | ${content.summary.averageReadiness}% avg readiness | ${content.summary.status}`,
    statusEmoji
  ));

  blocks.push(divider());
  blocks.push(tableOfContents());

  // Highlights section
  if (content.highlights.length > 0) {
    blocks.push(heading(2, 'Highlights'));
    for (const highlight of content.highlights) {
      blocks.push(bulletItem(highlight));
    }
  }

  // Figma link
  if (content.figmaFileUrl) {
    blocks.push(heading(2, 'Design File'));
    blocks.push(paragraph(`View in Figma: ${content.figmaFileUrl}`));
  }

  // Features section
  blocks.push(heading(2, 'Features'));

  for (const feature of content.features) {
    const statusIcon = feature.status === 'ready' ? '✅' : 
                       feature.status === 'new' ? '🆕' : 
                       feature.status === 'in-progress' ? '🔄' : '⏸️';
    
    blocks.push(heading(3, `${statusIcon} ${feature.name}`));
    blocks.push(paragraph(`Status: ${feature.status} | Readiness: ${feature.readiness}%`));
    blocks.push(paragraph(feature.summary));

    if (feature.ticketUrl && feature.ticketId) {
      blocks.push(paragraph(`Linked ticket: ${feature.ticketId}`));
    }

    if (feature.changes.length > 0) {
      for (const change of feature.changes.slice(0, 4)) {
        blocks.push(bulletItem(change));
      }
    }
  }

  // Blockers section
  if (content.blockers.length > 0) {
    blocks.push(heading(2, 'Blockers'));
    for (const blocker of content.blockers) {
      blocks.push(callout(blocker, '🚫'));
    }
  }

  // Footer
  blocks.push(divider());
  blocks.push(paragraph(`Generated by RecapMe on ${new Date().toLocaleDateString()}`));

  // Create the page
  interface CreatePageResponse {
    id: string;
    url: string;
  }

  const response = await notionRequest<CreatePageResponse>(
    token,
    '/pages',
    'POST',
    {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [richText(content.title)],
        },
      },
      children: blocks,
    }
  );

  return {
    id: response.id,
    url: response.url,
    title: content.title,
  };
}

/**
 * Update an existing Notion page with new content
 */
export async function updateRecapPage(
  token: string,
  pageId: string,
  content: RecapPageContent
): Promise<void> {
  // First, archive existing blocks (Notion doesn't have a replace all)
  // For simplicity, we'll just append new content
  // In production, you'd want to delete old blocks first
  
  const blocks: object[] = [];
  
  blocks.push(divider());
  blocks.push(heading(2, `Update: ${new Date().toLocaleDateString()}`));
  blocks.push(paragraph(`${content.summary.featuresWorkedOn} features | ${content.summary.averageReadiness}% readiness`));

  await notionRequest(
    token,
    `/blocks/${pageId}/children`,
    'PATCH',
    { children: blocks }
  );
}

/**
 * Convert stakeholder report to Notion page content
 */
export function reportToNotionContent(
  report: {
    title: string;
    dateRange: { from: string; to: string };
    summary: { featuresWorkedOn: number; averageReadiness: number; status: string };
    features: Array<{
      name: string;
      status: string;
      readinessPercent: number;
      summary: string;
      linkedTicket?: { id: string; url: string };
      keyChanges: string[];
    }>;
    highlights: string[];
    blockers: string[];
  },
  figmaFileUrl?: string
): RecapPageContent {
  return {
    title: report.title,
    dateRange: report.dateRange,
    summary: {
      featuresWorkedOn: report.summary.featuresWorkedOn,
      averageReadiness: report.summary.averageReadiness,
      status: report.summary.status,
    },
    features: report.features.map(f => ({
      name: f.name,
      status: f.status,
      readiness: f.readinessPercent,
      summary: f.summary,
      ticketUrl: f.linkedTicket?.url,
      ticketId: f.linkedTicket?.id,
      changes: f.keyChanges,
    })),
    highlights: report.highlights,
    blockers: report.blockers,
    figmaFileUrl,
  };
}
