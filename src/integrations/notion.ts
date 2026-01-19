/**
 * Notion API Integration
 * Creates recap pages in Notion and parses product specs
 */

import type { ProductSpec, ScreenSpec } from '../types';

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

// ============================================
// Product Spec Parsing
// ============================================

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

interface RichTextItem {
  plain_text: string;
  href?: string | null;
}

/**
 * Extract plain text from Notion rich text array
 */
function extractPlainText(richText: RichTextItem[] | undefined): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map(item => item.plain_text || '').join('');
}

/**
 * Extract page ID from a Notion URL
 */
export function extractNotionPageId(url: string): string | null {
  // Handle various Notion URL formats:
  // https://www.notion.so/Page-Name-abc123def456...
  // https://www.notion.so/workspace/abc123def456...
  // https://notion.so/abc123def456...
  // abc123def456 (just the ID)

  // Clean up the URL
  const cleaned = url.trim();

  // If it's already a valid ID format (32 hex chars with or without dashes)
  const idPattern = /^[a-f0-9]{32}$/i;
  const idWithDashesPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  if (idPattern.test(cleaned) || idWithDashesPattern.test(cleaned)) {
    return cleaned.replace(/-/g, '');
  }

  // Extract from URL - the ID is the last 32 hex chars (possibly with dashes)
  const urlMatch = cleaned.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\?|$)/i);
  if (urlMatch) {
    return urlMatch[1].replace(/-/g, '');
  }

  // Try extracting from the end of the URL path (page name format)
  const pathMatch = cleaned.match(/([a-f0-9]{32})$/i);
  if (pathMatch) {
    return pathMatch[1];
  }

  return null;
}

/**
 * Fetch all blocks from a Notion page
 */
export async function fetchPageBlocks(
  token: string,
  pageId: string
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const endpoint = cursor
      ? `/blocks/${pageId}/children?start_cursor=${cursor}&page_size=100`
      : `/blocks/${pageId}/children?page_size=100`;

    const response = await notionRequest<{
      results: NotionBlock[];
      has_more: boolean;
      next_cursor?: string;
    }>(token, endpoint);

    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

/**
 * Fetch page title and properties
 */
export async function fetchPageInfo(
  token: string,
  pageId: string
): Promise<{ title: string; properties: Record<string, unknown> }> {
  interface PageResponse {
    properties: {
      title?: { title?: RichTextItem[] };
      Name?: { title?: RichTextItem[] };
      [key: string]: unknown;
    };
  }

  const response = await notionRequest<PageResponse>(token, `/pages/${pageId}`);

  const title =
    extractPlainText(response.properties?.title?.title) ||
    extractPlainText(response.properties?.Name?.title) ||
    'Untitled';

  return {
    title,
    properties: response.properties,
  };
}

/**
 * Parse Notion blocks into a ProductSpec
 */
export async function parseProductSpec(
  token: string,
  pageId: string
): Promise<ProductSpec> {
  const [pageInfo, blocks] = await Promise.all([
    fetchPageInfo(token, pageId),
    fetchPageBlocks(token, pageId),
  ]);

  const spec: ProductSpec = {
    title: pageInfo.title,
    overview: '',
    screens: [],
    requirements: [],
    userStories: [],
  };

  let currentSection: 'overview' | 'screens' | 'requirements' | 'stories' | 'other' = 'overview';
  let currentScreen: ScreenSpec | null = null;
  const overviewParts: string[] = [];

  for (const block of blocks) {
    const blockType = block.type;

    // Handle headings - they determine the current section
    if (blockType === 'heading_1' || blockType === 'heading_2') {
      const headingData = block[blockType] as { rich_text?: RichTextItem[] };
      const headingText = extractPlainText(headingData?.rich_text).toLowerCase();

      // Save any pending screen
      if (currentScreen) {
        spec.screens.push(currentScreen);
        currentScreen = null;
      }

      // Determine section from heading
      if (headingText.includes('overview') || headingText.includes('summary') || headingText.includes('description')) {
        currentSection = 'overview';
      } else if (headingText.includes('screen') || headingText.includes('page') || headingText.includes('view') || headingText.includes('ui')) {
        currentSection = 'screens';
      } else if (headingText.includes('requirement') || headingText.includes('spec') || headingText.includes('feature')) {
        currentSection = 'requirements';
      } else if (headingText.includes('user stor') || headingText.includes('use case')) {
        currentSection = 'stories';
      } else {
        currentSection = 'other';
      }
      continue;
    }

    // Handle heading_3 - could be screen names within screens section
    if (blockType === 'heading_3' && currentSection === 'screens') {
      // Save previous screen
      if (currentScreen) {
        spec.screens.push(currentScreen);
      }

      const headingData = block.heading_3 as { rich_text?: RichTextItem[] };
      const screenName = extractPlainText(headingData?.rich_text);

      currentScreen = {
        name: screenName,
        description: '',
        elements: [],
      };
      continue;
    }

    // Handle paragraphs
    if (blockType === 'paragraph') {
      const paraData = block.paragraph as { rich_text?: RichTextItem[] };
      const text = extractPlainText(paraData?.rich_text);
      if (!text) continue;

      if (currentSection === 'overview') {
        overviewParts.push(text);
      } else if (currentSection === 'screens' && currentScreen) {
        // If no description yet, use as description
        if (!currentScreen.description) {
          currentScreen.description = text;
        }
      }
    }

    // Handle bulleted lists
    if (blockType === 'bulleted_list_item') {
      const listData = block.bulleted_list_item as { rich_text?: RichTextItem[] };
      const text = extractPlainText(listData?.rich_text);
      if (!text) continue;

      if (currentSection === 'requirements') {
        spec.requirements.push(text);
      } else if (currentSection === 'stories') {
        spec.userStories.push(text);
      } else if (currentSection === 'screens' && currentScreen) {
        currentScreen.elements.push(text);
      } else if (currentSection === 'overview') {
        overviewParts.push(`- ${text}`);
      }
    }

    // Handle numbered lists similarly
    if (blockType === 'numbered_list_item') {
      const listData = block.numbered_list_item as { rich_text?: RichTextItem[] };
      const text = extractPlainText(listData?.rich_text);
      if (!text) continue;

      if (currentSection === 'requirements') {
        spec.requirements.push(text);
      } else if (currentSection === 'stories') {
        spec.userStories.push(text);
      } else if (currentSection === 'screens' && currentScreen) {
        currentScreen.elements.push(text);
      }
    }

    // Handle to-do items as requirements
    if (blockType === 'to_do') {
      const todoData = block.to_do as { rich_text?: RichTextItem[]; checked?: boolean };
      const text = extractPlainText(todoData?.rich_text);
      if (!text) continue;

      if (currentSection === 'requirements' || currentSection === 'screens') {
        spec.requirements.push(text);
      }
    }

    // Handle callouts as important notes
    if (blockType === 'callout') {
      const calloutData = block.callout as { rich_text?: RichTextItem[] };
      const text = extractPlainText(calloutData?.rich_text);
      if (text && currentSection === 'screens' && currentScreen) {
        currentScreen.flow = text;
      }
    }
  }

  // Save any pending screen
  if (currentScreen) {
    spec.screens.push(currentScreen);
  }

  // Compile overview
  spec.overview = overviewParts.join('\n\n');

  return spec;
}

/**
 * Generate a summary of a ProductSpec for AI consumption
 */
export function summarizeProductSpec(spec: ProductSpec): string {
  const lines: string[] = [];

  lines.push(`# ${spec.title}`);
  lines.push('');

  if (spec.overview) {
    lines.push('## Overview');
    lines.push(spec.overview);
    lines.push('');
  }

  if (spec.screens.length > 0) {
    lines.push('## Screens');
    for (const screen of spec.screens) {
      lines.push(`### ${screen.name}`);
      if (screen.description) {
        lines.push(screen.description);
      }
      if (screen.elements.length > 0) {
        lines.push('Elements:');
        for (const elem of screen.elements) {
          lines.push(`- ${elem}`);
        }
      }
      if (screen.flow) {
        lines.push(`Flow: ${screen.flow}`);
      }
      lines.push('');
    }
  }

  if (spec.requirements.length > 0) {
    lines.push('## Requirements');
    for (const req of spec.requirements) {
      lines.push(`- ${req}`);
    }
    lines.push('');
  }

  if (spec.userStories.length > 0) {
    lines.push('## User Stories');
    for (const story of spec.userStories) {
      lines.push(`- ${story}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
