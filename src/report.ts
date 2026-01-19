import type { DiffResult, NodeChange, ComponentChange, StyleChange } from './types';

/**
 * Format a date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Group node changes by their type
 */
function groupNodesByType(changes: NodeChange[]): Record<string, NodeChange[]> {
  const groups: Record<string, NodeChange[]> = {};
  
  for (const change of changes) {
    const type = change.nodeType;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(change);
  }
  
  return groups;
}

/**
 * Get a human-readable name for node types
 */
function getNodeTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    FRAME: 'Frames',
    GROUP: 'Groups',
    COMPONENT: 'Components',
    COMPONENT_SET: 'Component Sets',
    INSTANCE: 'Instances',
    TEXT: 'Text Layers',
    RECTANGLE: 'Rectangles',
    ELLIPSE: 'Ellipses',
    LINE: 'Lines',
    VECTOR: 'Vectors',
    BOOLEAN_OPERATION: 'Boolean Operations',
    SECTION: 'Sections',
    SLICE: 'Slices',
    STAR: 'Stars',
    REGULAR_POLYGON: 'Polygons',
  };
  
  return typeNames[type] || type;
}

/**
 * Generate HTML for displaying results in the plugin UI
 */
export function generateUIHTML(result: DiffResult): string {
  const { summary, nodeChanges, componentChanges, styleChanges } = result;
  
  let html = `
    <div class="recap-header">
      <h2>${result.fileName}</h2>
      <div class="date-range">
        <span class="from-date">${formatDate(result.fromVersion.createdAt)}</span>
        <span class="arrow">→</span>
        <span class="to-date">${formatDate(result.toVersion.createdAt)}</span>
      </div>
      ${result.fromVersion.label ? `<div class="version-label">From: ${result.fromVersion.label}</div>` : ''}
      ${result.toVersion.label ? `<div class="version-label">To: ${result.toVersion.label}</div>` : ''}
    </div>
    
    <div class="summary-stats">
      <div class="stat">
        <span class="stat-value">${summary.totalChanges}</span>
        <span class="stat-label">Total Changes</span>
      </div>
      <div class="stat added">
        <span class="stat-value">${summary.nodesAdded}</span>
        <span class="stat-label">Added</span>
      </div>
      <div class="stat removed">
        <span class="stat-value">${summary.nodesRemoved}</span>
        <span class="stat-label">Removed</span>
      </div>
      <div class="stat modified">
        <span class="stat-value">${summary.nodesModified + summary.nodesRenamed}</span>
        <span class="stat-label">Modified</span>
      </div>
    </div>
  `;

  // Node changes by category
  const addedNodes = nodeChanges.filter(c => c.type === 'added');
  const removedNodes = nodeChanges.filter(c => c.type === 'removed');
  const modifiedNodes = nodeChanges.filter(c => c.type === 'modified' || c.type === 'renamed');

  if (addedNodes.length > 0) {
    html += generateNodeSection('Added Elements', addedNodes, 'added');
  }

  if (removedNodes.length > 0) {
    html += generateNodeSection('Removed Elements', removedNodes, 'removed');
  }

  if (modifiedNodes.length > 0) {
    html += generateNodeSection('Modified Elements', modifiedNodes, 'modified');
  }

  // Component changes
  if (componentChanges.length > 0) {
    html += `<div class="section">
      <h3 class="section-title">Component Changes</h3>
      <ul class="change-list">
        ${componentChanges.map(c => `
          <li class="change-item ${c.type}">
            <span class="change-badge ${c.type}">${c.type}</span>
            <span class="change-name">${escapeHtml(c.componentName)}</span>
            ${c.details ? `<span class="change-details">${escapeHtml(c.details)}</span>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  // Style changes
  if (styleChanges.length > 0) {
    html += `<div class="section">
      <h3 class="section-title">Style Changes</h3>
      <ul class="change-list">
        ${styleChanges.map(c => `
          <li class="change-item ${c.type}">
            <span class="change-badge ${c.type}">${c.type}</span>
            <span class="style-type">${c.styleType}</span>
            <span class="change-name">${escapeHtml(c.styleName)}</span>
            ${c.details ? `<span class="change-details">${escapeHtml(c.details)}</span>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>`;
  }

  if (summary.totalChanges === 0) {
    html += `
      <div class="no-changes">
        <p>No changes detected in this time period.</p>
        <p class="hint">Try expanding your date range or check if changes were made to this file.</p>
      </div>
    `;
  }

  return html;
}

function generateNodeSection(title: string, nodes: NodeChange[], changeClass: string): string {
  const grouped = groupNodesByType(nodes);
  
  let html = `<div class="section">
    <h3 class="section-title">${title} <span class="count">(${nodes.length})</span></h3>`;
  
  for (const [type, changes] of Object.entries(grouped)) {
    html += `
      <div class="type-group">
        <h4 class="type-title">${getNodeTypeName(type)} <span class="count">(${changes.length})</span></h4>
        <ul class="change-list">
          ${changes.slice(0, 50).map(c => `
            <li class="change-item ${changeClass}">
              <span class="change-name">${escapeHtml(c.nodeName)}</span>
              <span class="change-path">${escapeHtml(c.path.slice(0, -1).join(' / '))}</span>
              ${c.details ? `<span class="change-details">${escapeHtml(c.details)}</span>` : ''}
            </li>
          `).join('')}
          ${changes.length > 50 ? `<li class="more-items">...and ${changes.length - 50} more</li>` : ''}
        </ul>
      </div>
    `;
  }
  
  html += '</div>';
  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate a markdown report for export
 */
export function generateMarkdownReport(result: DiffResult): string {
  const { summary, nodeChanges, componentChanges, styleChanges } = result;
  
  let md = `# RecapMe Summary: ${result.fileName}\n\n`;
  md += `**Period:** ${formatDate(result.fromVersion.createdAt)} → ${formatDate(result.toVersion.createdAt)}\n\n`;
  
  if (result.fromVersion.label) {
    md += `**From Version:** ${result.fromVersion.label}\n`;
  }
  if (result.toVersion.label) {
    md += `**To Version:** ${result.toVersion.label}\n`;
  }
  md += '\n';

  // Summary
  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Changes | ${summary.totalChanges} |\n`;
  md += `| Elements Added | ${summary.nodesAdded} |\n`;
  md += `| Elements Removed | ${summary.nodesRemoved} |\n`;
  md += `| Elements Modified | ${summary.nodesModified} |\n`;
  md += `| Elements Renamed | ${summary.nodesRenamed} |\n`;
  md += `| Components Changed | ${summary.componentsChanged} |\n`;
  md += `| Styles Changed | ${summary.stylesChanged} |\n\n`;

  // Added elements
  const addedNodes = nodeChanges.filter(c => c.type === 'added');
  if (addedNodes.length > 0) {
    md += `## Added Elements (${addedNodes.length})\n\n`;
    md += generateMarkdownNodeTable(addedNodes);
  }

  // Removed elements
  const removedNodes = nodeChanges.filter(c => c.type === 'removed');
  if (removedNodes.length > 0) {
    md += `## Removed Elements (${removedNodes.length})\n\n`;
    md += generateMarkdownNodeTable(removedNodes);
  }

  // Modified elements
  const modifiedNodes = nodeChanges.filter(c => c.type === 'modified' || c.type === 'renamed');
  if (modifiedNodes.length > 0) {
    md += `## Modified Elements (${modifiedNodes.length})\n\n`;
    md += generateMarkdownNodeTable(modifiedNodes, true);
  }

  // Component changes
  if (componentChanges.length > 0) {
    md += `## Component Changes (${componentChanges.length})\n\n`;
    md += `| Status | Name | Details |\n`;
    md += `|--------|------|----------|\n`;
    for (const c of componentChanges) {
      md += `| ${c.type.toUpperCase()} | ${c.componentName} | ${c.details || '-'} |\n`;
    }
    md += '\n';
  }

  // Style changes
  if (styleChanges.length > 0) {
    md += `## Style Changes (${styleChanges.length})\n\n`;
    md += `| Status | Type | Name | Details |\n`;
    md += `|--------|------|------|----------|\n`;
    for (const c of styleChanges) {
      md += `| ${c.type.toUpperCase()} | ${c.styleType} | ${c.styleName} | ${c.details || '-'} |\n`;
    }
    md += '\n';
  }

  if (summary.totalChanges === 0) {
    md += `\n*No changes detected in this time period.*\n`;
  }

  md += `\n---\n*Generated by RecapMe on ${new Date().toLocaleDateString()}*\n`;

  return md;
}

function generateMarkdownNodeTable(nodes: NodeChange[], includeDetails: boolean = false): string {
  const grouped = groupNodesByType(nodes);
  let md = '';

  for (const [type, changes] of Object.entries(grouped)) {
    md += `### ${getNodeTypeName(type)} (${changes.length})\n\n`;
    
    if (includeDetails) {
      md += `| Name | Path | Changes |\n`;
      md += `|------|------|----------|\n`;
      for (const c of changes.slice(0, 100)) {
        const path = c.path.slice(0, -1).join(' > ');
        md += `| ${c.nodeName} | ${path || '-'} | ${c.details || '-'} |\n`;
      }
    } else {
      md += `| Name | Path |\n`;
      md += `|------|------|\n`;
      for (const c of changes.slice(0, 100)) {
        const path = c.path.slice(0, -1).join(' > ');
        md += `| ${c.nodeName} | ${path || '-'} |\n`;
      }
    }
    
    if (changes.length > 100) {
      md += `\n*...and ${changes.length - 100} more*\n`;
    }
    md += '\n';
  }

  return md;
}
