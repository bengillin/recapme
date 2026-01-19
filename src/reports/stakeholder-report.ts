import type { SemanticDiffResult, FeatureGroup } from '../analysis/semantic-grouper';
import type { LinearTicket } from '../integrations/linear';

export interface StakeholderReport {
  title: string;
  dateRange: {
    from: string;
    to: string;
  };
  summary: {
    featuresWorkedOn: number;
    ticketsProgressed: number;
    averageReadiness: number;
    status: 'on-track' | 'at-risk' | 'blocked';
  };
  features: StakeholderFeature[];
  highlights: string[];
  blockers: string[];
}

export interface StakeholderFeature {
  name: string;
  status: 'new' | 'in-progress' | 'ready' | 'blocked';
  readinessPercent: number;
  summary: string;
  linkedTicket?: {
    id: string;
    title: string;
    url: string;
  };
  keyChanges: string[];
}

/**
 * Format a date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Determine feature status based on changes
 */
function determineFeatureStatus(feature: FeatureGroup, readiness: number): 'new' | 'in-progress' | 'ready' | 'blocked' {
  if (feature.changeType === 'new') {
    return readiness >= 80 ? 'ready' : 'new';
  }
  if (readiness >= 90) {
    return 'ready';
  }
  return 'in-progress';
}

/**
 * Generate key changes summary for stakeholders
 */
function generateKeyChanges(feature: FeatureGroup): string[] {
  const changes: string[] = [];

  // Summarize what was done
  if (feature.changeType === 'new') {
    changes.push(`Created ${feature.name}`);
  }

  // Component variants
  if (feature.componentChanges.length > 0) {
    const addedComponents = feature.componentChanges.filter(c => c.type === 'added').length;
    if (addedComponents > 0) {
      changes.push(`${addedComponents} new component variant${addedComponents > 1 ? 's' : ''}`);
    }
  }

  // Highlights from semantic analysis
  changes.push(...feature.highlights);

  // Modifications
  if (feature.changes.modified > 0 && feature.changeType !== 'new') {
    changes.push(`Refined ${feature.changes.modified} element${feature.changes.modified > 1 ? 's' : ''}`);
  }

  return changes.slice(0, 4); // Limit to 4 key changes
}

/**
 * Calculate a simple readiness score (will be enhanced with readiness analyzer)
 */
function calculateSimpleReadiness(feature: FeatureGroup): number {
  // Base readiness
  let readiness = 50;

  // More variants = more complete
  if (feature.variants.length > 0) {
    readiness += Math.min(feature.variants.length * 5, 25);
  }

  // Check for common states
  const hasDefaultState = feature.variants.some(v => v.includes('State=Default'));
  const hasHoverState = feature.variants.some(v => v.includes('State=Hover'));
  const hasDisabledState = feature.variants.some(v => v.includes('State=Disabled'));

  if (hasDefaultState) readiness += 10;
  if (hasHoverState) readiness += 5;
  if (hasDisabledState) readiness += 5;

  // New features with many components are more complete
  if (feature.changeType === 'new' && feature.componentChanges.length >= 5) {
    readiness += 10;
  }

  return Math.min(readiness, 100);
}

/**
 * Generate a stakeholder-friendly report from semantic diff results
 */
export function generateStakeholderReport(
  semanticDiff: SemanticDiffResult,
  linkedTickets: Map<string, LinearTicket> = new Map()
): StakeholderReport {
  const features: StakeholderFeature[] = [];
  let totalReadiness = 0;

  for (const feature of semanticDiff.features) {
    // Skip very minor changes
    const totalChanges = feature.changes.added + feature.changes.modified + feature.changes.removed;
    if (totalChanges < 3 && feature.category === 'misc') {
      continue;
    }

    const readiness = calculateSimpleReadiness(feature);
    totalReadiness += readiness;

    // Try to find linked ticket
    const linkedTicket = linkedTickets.get(feature.name.toLowerCase());

    features.push({
      name: feature.name,
      status: determineFeatureStatus(feature, readiness),
      readinessPercent: readiness,
      summary: feature.description,
      linkedTicket: linkedTicket ? {
        id: linkedTicket.identifier,
        title: linkedTicket.title,
        url: linkedTicket.url,
      } : undefined,
      keyChanges: generateKeyChanges(feature),
    });
  }

  // Sort by status priority
  const statusPriority = { 'ready': 0, 'new': 1, 'in-progress': 2, 'blocked': 3 };
  features.sort((a, b) => statusPriority[a.status] - statusPriority[b.status]);

  // Generate highlights
  const highlights: string[] = [];
  const newFeatures = features.filter(f => f.status === 'new' || f.status === 'ready');
  if (newFeatures.length > 0) {
    highlights.push(`${newFeatures.length} new feature${newFeatures.length > 1 ? 's' : ''} created`);
  }
  const readyFeatures = features.filter(f => f.status === 'ready');
  if (readyFeatures.length > 0) {
    highlights.push(`${readyFeatures.length} feature${readyFeatures.length > 1 ? 's' : ''} ready for development`);
  }

  // Calculate averages
  const avgReadiness = features.length > 0 ? Math.round(totalReadiness / features.length) : 0;

  // Determine overall status
  let overallStatus: 'on-track' | 'at-risk' | 'blocked' = 'on-track';
  if (avgReadiness < 50) {
    overallStatus = 'at-risk';
  }
  const blockedCount = features.filter(f => f.status === 'blocked').length;
  if (blockedCount > features.length / 3) {
    overallStatus = 'blocked';
  }

  return {
    title: `Design Recap: ${semanticDiff.originalDiff.fileName}`,
    dateRange: {
      from: formatDate(semanticDiff.originalDiff.fromVersion.createdAt),
      to: formatDate(semanticDiff.originalDiff.toVersion.createdAt),
    },
    summary: {
      featuresWorkedOn: features.length,
      ticketsProgressed: linkedTickets.size,
      averageReadiness: avgReadiness,
      status: overallStatus,
    },
    features,
    highlights,
    blockers: [], // Will be populated by readiness analyzer
  };
}

/**
 * Generate HTML for stakeholder view
 */
export function generateStakeholderHTML(report: StakeholderReport): string {
  const statusColors: Record<string, string> = {
    'ready': 'var(--color-success)',
    'new': 'var(--brand-primary)',
    'in-progress': 'var(--text-secondary)',
    'blocked': 'var(--color-danger)',
  };

  const statusLabels: Record<string, string> = {
    'ready': 'Ready for Dev',
    'new': 'New',
    'in-progress': 'In Progress',
    'blocked': 'Blocked',
  };

  let html = `
    <div class="stakeholder-report">
      <div class="report-header">
        <h2>${report.title}</h2>
        <div class="date-range">${report.dateRange.from} → ${report.dateRange.to}</div>
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <span class="card-value">${report.summary.featuresWorkedOn}</span>
          <span class="card-label">Features</span>
        </div>
        <div class="summary-card">
          <span class="card-value">${report.summary.averageReadiness}%</span>
          <span class="card-label">Avg Readiness</span>
        </div>
        <div class="summary-card status-${report.summary.status}">
          <span class="card-value">${report.summary.status.replace('-', ' ')}</span>
          <span class="card-label">Status</span>
        </div>
      </div>

      ${report.highlights.length > 0 ? `
        <div class="highlights">
          <h3>Highlights</h3>
          <ul>
            ${report.highlights.map(h => `<li>${h}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="features-list">
        <h3>Features</h3>
        ${report.features.map(feature => `
          <div class="feature-card">
            <div class="feature-header">
              <span class="feature-name">${feature.name}</span>
              <span class="feature-status" style="color: ${statusColors[feature.status]}">${statusLabels[feature.status]}</span>
            </div>
            <div class="feature-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${feature.readinessPercent}%; background: ${statusColors[feature.status]}"></div>
              </div>
              <span class="progress-text">${feature.readinessPercent}%</span>
            </div>
            <p class="feature-summary">${feature.summary}</p>
            ${feature.linkedTicket ? `
              <a class="linked-ticket" href="${feature.linkedTicket.url}" target="_blank">
                ${feature.linkedTicket.id}: ${feature.linkedTicket.title}
              </a>
            ` : ''}
            ${feature.keyChanges.length > 0 ? `
              <ul class="key-changes">
                ${feature.keyChanges.map(c => `<li>${c}</li>`).join('')}
              </ul>
            ` : ''}
          </div>
        `).join('')}
      </div>

      ${report.blockers.length > 0 ? `
        <div class="blockers">
          <h3>Blockers</h3>
          <ul>
            ${report.blockers.map(b => `<li>${b}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  return html;
}

/**
 * Generate Markdown for stakeholder report
 */
export function generateStakeholderMarkdown(report: StakeholderReport): string {
  const statusEmoji: Record<string, string> = {
    'ready': '✅',
    'new': '🆕',
    'in-progress': '🔄',
    'blocked': '🚫',
  };

  let md = `# ${report.title}\n\n`;
  md += `**Period:** ${report.dateRange.from} → ${report.dateRange.to}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Features Worked On | ${report.summary.featuresWorkedOn} |\n`;
  md += `| Average Readiness | ${report.summary.averageReadiness}% |\n`;
  md += `| Overall Status | ${report.summary.status} |\n\n`;

  if (report.highlights.length > 0) {
    md += `## Highlights\n\n`;
    report.highlights.forEach(h => {
      md += `- ${h}\n`;
    });
    md += '\n';
  }

  md += `## Features\n\n`;
  for (const feature of report.features) {
    md += `### ${statusEmoji[feature.status]} ${feature.name}\n\n`;
    md += `**Status:** ${feature.status} | **Readiness:** ${feature.readinessPercent}%\n\n`;
    md += `${feature.summary}\n\n`;
    
    if (feature.linkedTicket) {
      md += `**Ticket:** [${feature.linkedTicket.id}](${feature.linkedTicket.url}) - ${feature.linkedTicket.title}\n\n`;
    }

    if (feature.keyChanges.length > 0) {
      md += `**Changes:**\n`;
      feature.keyChanges.forEach(c => {
        md += `- ${c}\n`;
      });
      md += '\n';
    }
  }

  if (report.blockers.length > 0) {
    md += `## Blockers\n\n`;
    report.blockers.forEach(b => {
      md += `- ${b}\n`;
    });
  }

  md += `\n---\n*Generated by RecapMe on ${new Date().toLocaleDateString()}*\n`;

  return md;
}
