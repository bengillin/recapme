import type { LinearTicket, extractFigmaFileKey } from '../integrations/linear';
import type { FeatureGroup, SemanticDiffResult } from './semantic-grouper';

export interface TicketMatch {
  feature: FeatureGroup;
  ticket: LinearTicket | null;
  matchConfidence: 'high' | 'medium' | 'low' | 'none';
  matchReason: string;
}

export interface MatchResult {
  matches: TicketMatch[];
  unmatchedFeatures: FeatureGroup[];
  unmatchedTickets: LinearTicket[];
  summary: {
    totalFeatures: number;
    matchedFeatures: number;
    matchPercentage: number;
  };
}

/**
 * Normalize text for comparison
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function similarity(a: string, b: string): number {
  const aNorm = normalize(a);
  const bNorm = normalize(b);

  if (aNorm === bNorm) return 1;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.8;

  // Word overlap
  const aWords = new Set(aNorm.split(' '));
  const bWords = new Set(bNorm.split(' '));
  
  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word) && word.length > 2) {
      overlap++;
    }
  }

  const maxWords = Math.max(aWords.size, bWords.size);
  return maxWords > 0 ? overlap / maxWords : 0;
}

/**
 * Check if a Figma file key matches any links in a ticket
 */
function ticketHasFigmaFile(ticket: LinearTicket, fileKey: string): boolean {
  return ticket.figmaLinks.some(link => {
    const linkFileKey = extractFileKeyFromUrl(link);
    return linkFileKey === fileKey;
  });
}

/**
 * Extract file key from Figma URL
 */
function extractFileKeyFromUrl(url: string): string | null {
  const match = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Match a single feature to tickets
 */
function findBestTicketMatch(
  feature: FeatureGroup,
  tickets: LinearTicket[],
  figmaFileKey?: string
): { ticket: LinearTicket | null; confidence: 'high' | 'medium' | 'low' | 'none'; reason: string } {
  if (tickets.length === 0) {
    return { ticket: null, confidence: 'none', reason: 'No tickets available' };
  }

  let bestMatch: LinearTicket | null = null;
  let bestScore = 0;
  let bestReason = '';

  for (const ticket of tickets) {
    let score = 0;
    let reason = '';

    // 1. Check for direct Figma file link (highest priority)
    if (figmaFileKey && ticketHasFigmaFile(ticket, figmaFileKey)) {
      score += 0.5;
      reason = 'Figma file linked in ticket';
    }

    // 2. Check title similarity
    const titleSim = similarity(feature.name, ticket.title);
    if (titleSim > 0.5) {
      score += titleSim * 0.3;
      reason = reason || `Title match: "${ticket.title}"`;
    }

    // 3. Check description for feature name
    if (ticket.description) {
      const descSim = similarity(feature.name, ticket.description);
      if (descSim > 0.3) {
        score += descSim * 0.2;
        reason = reason || 'Mentioned in description';
      }
    }

    // 4. Check labels
    for (const label of ticket.labels) {
      const labelSim = similarity(feature.name, label.name);
      if (labelSim > 0.6) {
        score += 0.2;
        reason = reason || `Label match: "${label.name}"`;
        break;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = ticket;
      bestReason = reason;
    }
  }

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low' | 'none';
  if (bestScore >= 0.7) {
    confidence = 'high';
  } else if (bestScore >= 0.4) {
    confidence = 'medium';
  } else if (bestScore > 0.1) {
    confidence = 'low';
  } else {
    confidence = 'none';
    bestMatch = null;
    bestReason = 'No matching ticket found';
  }

  return { ticket: bestMatch, confidence, reason: bestReason };
}

/**
 * Match all features to tickets
 */
export function matchFeaturesToTickets(
  semanticDiff: SemanticDiffResult,
  tickets: LinearTicket[],
  figmaFileKey?: string
): MatchResult {
  const matches: TicketMatch[] = [];
  const matchedTicketIds = new Set<string>();

  for (const feature of semanticDiff.features) {
    // Filter out already matched tickets for stricter matching
    const availableTickets = tickets.filter(t => !matchedTicketIds.has(t.id));
    
    const { ticket, confidence, reason } = findBestTicketMatch(
      feature,
      availableTickets,
      figmaFileKey
    );

    if (ticket && confidence !== 'none') {
      matchedTicketIds.add(ticket.id);
    }

    matches.push({
      feature,
      ticket,
      matchConfidence: confidence,
      matchReason: reason,
    });
  }

  // Find unmatched items
  const unmatchedFeatures = matches
    .filter(m => m.matchConfidence === 'none')
    .map(m => m.feature);

  const unmatchedTickets = tickets.filter(t => !matchedTicketIds.has(t.id));

  const matchedCount = matches.filter(m => m.matchConfidence !== 'none').length;

  return {
    matches,
    unmatchedFeatures,
    unmatchedTickets,
    summary: {
      totalFeatures: semanticDiff.features.length,
      matchedFeatures: matchedCount,
      matchPercentage: semanticDiff.features.length > 0 
        ? Math.round((matchedCount / semanticDiff.features.length) * 100)
        : 0,
    },
  };
}

/**
 * Get ticket status summary
 */
export function getTicketStatusSummary(matches: TicketMatch[]): {
  byStatus: Record<string, number>;
  byConfidence: Record<string, number>;
} {
  const byStatus: Record<string, number> = {};
  const byConfidence: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };

  for (const match of matches) {
    byConfidence[match.matchConfidence]++;

    if (match.ticket) {
      const status = match.ticket.state.name;
      byStatus[status] = (byStatus[status] || 0) + 1;
    }
  }

  return { byStatus, byConfidence };
}

/**
 * Group matches by ticket status
 */
export function groupMatchesByTicketStatus(matches: TicketMatch[]): Map<string, TicketMatch[]> {
  const groups = new Map<string, TicketMatch[]>();

  for (const match of matches) {
    const status = match.ticket?.state.name || 'Unlinked';
    if (!groups.has(status)) {
      groups.set(status, []);
    }
    groups.get(status)!.push(match);
  }

  return groups;
}

/**
 * Generate match summary for display
 */
export function generateMatchSummary(result: MatchResult): string[] {
  const lines: string[] = [];

  lines.push(`${result.summary.matchedFeatures}/${result.summary.totalFeatures} features linked to tickets`);

  if (result.unmatchedFeatures.length > 0) {
    lines.push(`${result.unmatchedFeatures.length} features without tickets:`);
    result.unmatchedFeatures.slice(0, 3).forEach(f => {
      lines.push(`  • ${f.name}`);
    });
    if (result.unmatchedFeatures.length > 3) {
      lines.push(`  ...and ${result.unmatchedFeatures.length - 3} more`);
    }
  }

  if (result.unmatchedTickets.length > 0) {
    lines.push(`${result.unmatchedTickets.length} tickets without design changes`);
  }

  return lines;
}
