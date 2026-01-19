/**
 * Linear API Integration
 * Fetches tickets and extracts Figma links
 */

const LINEAR_API_URL = 'https://api.linear.app/graphql';

export interface LinearTicket {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: {
    name: string;
    type: string;
  };
  assignee: {
    name: string;
    email: string;
  } | null;
  labels: Array<{
    name: string;
    color: string;
  }>;
  url: string;
  createdAt: string;
  updatedAt: string;
  figmaLinks: string[];
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearProject {
  id: string;
  name: string;
  url: string;
}

export class LinearAPIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'LinearAPIError';
  }
}

/**
 * Execute a GraphQL query against Linear API
 */
async function linearQuery<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new LinearAPIError('Invalid Linear API key', 401);
    }
    throw new LinearAPIError(`Linear API error: ${response.statusText}`, response.status);
  }

  const result = await response.json();
  
  if (result.errors) {
    throw new LinearAPIError(result.errors[0]?.message || 'GraphQL error');
  }

  return result.data;
}

/**
 * Extract Figma URLs from text content
 */
export function extractFigmaLinks(text: string | null): string[] {
  if (!text) return [];
  
  const figmaPatterns = [
    /https:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/[^\s)]*)?/g,
    /https:\/\/(?:www\.)?figma\.com\/proto\/([a-zA-Z0-9]+)(?:\/[^\s)]*)?/g,
  ];

  const links: string[] = [];
  
  for (const pattern of figmaPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      links.push(match[0]);
    }
  }

  return [...new Set(links)]; // Deduplicate
}

/**
 * Extract file key from a Figma URL
 */
export function extractFigmaFileKey(url: string): string | null {
  const match = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch teams the user has access to
 */
export async function fetchTeams(apiKey: string): Promise<LinearTeam[]> {
  const query = `
    query Teams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `;

  const data = await linearQuery<{ teams: { nodes: LinearTeam[] } }>(apiKey, query);
  return data.teams.nodes;
}

/**
 * Fetch projects for a team
 */
export async function fetchProjects(apiKey: string, teamId: string): Promise<LinearProject[]> {
  const query = `
    query Projects($teamId: String!) {
      team(id: $teamId) {
        projects {
          nodes {
            id
            name
            url
          }
        }
      }
    }
  `;

  const data = await linearQuery<{ team: { projects: { nodes: LinearProject[] } } }>(
    apiKey, 
    query, 
    { teamId }
  );
  return data.team.projects.nodes;
}

/**
 * Fetch tickets from a team within a date range
 */
export async function fetchTickets(
  apiKey: string,
  teamId: string,
  startDate: Date,
  endDate: Date,
  projectId?: string
): Promise<LinearTicket[]> {
  const query = `
    query Issues($teamId: String!, $startDate: DateTime!, $endDate: DateTime!, $projectId: String) {
      issues(
        filter: {
          team: { id: { eq: $teamId } }
          updatedAt: { gte: $startDate, lte: $endDate }
          project: { id: { eq: $projectId } }
        }
        first: 100
      ) {
        nodes {
          id
          identifier
          title
          description
          url
          createdAt
          updatedAt
          state {
            name
            type
          }
          assignee {
            name
            email
          }
          labels {
            nodes {
              name
              color
            }
          }
          attachments {
            nodes {
              url
              title
            }
          }
          comments {
            nodes {
              body
            }
          }
        }
      }
    }
  `;

  interface LinearIssueNode {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    url: string;
    createdAt: string;
    updatedAt: string;
    state: { name: string; type: string };
    assignee: { name: string; email: string } | null;
    labels: { nodes: Array<{ name: string; color: string }> };
    attachments: { nodes: Array<{ url: string; title: string }> };
    comments: { nodes: Array<{ body: string }> };
  }

  const data = await linearQuery<{ issues: { nodes: LinearIssueNode[] } }>(
    apiKey,
    query,
    {
      teamId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      projectId: projectId || null,
    }
  );

  // Process tickets and extract Figma links
  return data.issues.nodes.map(issue => {
    // Collect all text that might contain Figma links
    const textToSearch = [
      issue.description,
      ...issue.attachments.nodes.map(a => a.url),
      ...issue.comments.nodes.map(c => c.body),
    ].filter(Boolean).join('\n');

    // Also check attachments directly
    const attachmentLinks = issue.attachments.nodes
      .filter(a => a.url.includes('figma.com'))
      .map(a => a.url);

    const figmaLinks = [
      ...extractFigmaLinks(textToSearch),
      ...attachmentLinks,
    ];

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state,
      assignee: issue.assignee,
      labels: issue.labels.nodes,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      figmaLinks: [...new Set(figmaLinks)],
    };
  });
}

/**
 * Find tickets that link to a specific Figma file
 */
export function findTicketsForFigmaFile(
  tickets: LinearTicket[],
  figmaFileKey: string
): LinearTicket[] {
  return tickets.filter(ticket =>
    ticket.figmaLinks.some(link => extractFigmaFileKey(link) === figmaFileKey)
  );
}

/**
 * Create a mapping of feature names to tickets (fuzzy match)
 */
export function matchTicketsToFeatures(
  tickets: LinearTicket[],
  featureNames: string[]
): Map<string, LinearTicket> {
  const mapping = new Map<string, LinearTicket>();

  for (const featureName of featureNames) {
    const normalizedFeature = featureName.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const ticket of tickets) {
      const normalizedTitle = ticket.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Check if feature name appears in ticket title or vice versa
      if (normalizedTitle.includes(normalizedFeature) || 
          normalizedFeature.includes(normalizedTitle)) {
        mapping.set(featureName.toLowerCase(), ticket);
        break;
      }

      // Check labels
      for (const label of ticket.labels) {
        const normalizedLabel = label.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedLabel.includes(normalizedFeature) || 
            normalizedFeature.includes(normalizedLabel)) {
          mapping.set(featureName.toLowerCase(), ticket);
          break;
        }
      }
    }
  }

  return mapping;
}

/**
 * Validate Linear API key
 */
export async function validateLinearKey(apiKey: string): Promise<boolean> {
  try {
    const query = `query Viewer { viewer { id } }`;
    await linearQuery(apiKey, query);
    return true;
  } catch {
    return false;
  }
}
