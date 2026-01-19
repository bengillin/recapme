import type { DiffResult, NodeChange, ChangeType } from '../types';

// Internal representation with path as string for easier processing
export interface ProcessedChange {
  type: ChangeType;
  nodeId: string;
  name: string;
  nodeType: string;
  path: string;
  details?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'page' | 'section' | 'component-set' | 'component' | 'element';
  changes: {
    added: ProcessedChange[];
    removed: ProcessedChange[];
    modified: ProcessedChange[];
  };
  children: Map<string, FileNode>;
  stats: {
    totalChanges: number;
    added: number;
    removed: number;
    modified: number;
  };
}

export interface ComponentGroup {
  name: string;
  setPath: string;
  variants: {
    name: string;
    change: ChangeType;
    properties: Record<string, string>;
  }[];
  stats: {
    added: number;
    removed: number;
    modified: number;
  };
}

/**
 * Convert NodeChange to ProcessedChange with path as string
 */
function processNodeChange(change: NodeChange): ProcessedChange {
  return {
    type: change.type,
    nodeId: change.nodeId,
    name: change.nodeName,
    nodeType: change.nodeType,
    path: Array.isArray(change.path) ? change.path.join(' / ') : String(change.path),
    details: change.details,
  };
}

export interface StructuredDiff {
  fileTree: FileNode;
  componentGroups: ComponentGroup[];
  pageStats: {
    name: string;
    path: string;
    changes: number;
    breakdown: { added: number; removed: number; modified: number };
  }[];
}

/**
 * Parse a Figma path into segments
 * Handles both string and array inputs
 */
function parsePath(path: string | string[]): string[] {
  if (Array.isArray(path)) {
    return path.filter(Boolean);
  }
  return path.split(' / ').filter(Boolean);
}

/**
 * Extract component variant properties from name
 * e.g., "Type=Primary, State=Default, Icon=True" -> { Type: "Primary", State: "Default", Icon: "True" }
 */
function parseVariantProps(name: string): Record<string, string> {
  const props: Record<string, string> = {};
  const matches = name.matchAll(/(\w+)=([^,]+)/g);
  for (const match of matches) {
    props[match[1]] = match[2].trim();
  }
  return props;
}

/**
 * Determine if a name looks like a component variant
 */
function isVariantName(name: string): boolean {
  return /\w+=\w+/.test(name);
}

/**
 * Build a tree structure from the diff results
 */
export function buildFileTree(diff: DiffResult): FileNode {
  const root: FileNode = {
    name: 'Document',
    path: 'Document',
    type: 'page',
    changes: { added: [], removed: [], modified: [] },
    children: new Map(),
    stats: { totalChanges: 0, added: 0, removed: 0, modified: 0 },
  };

  const processChange = (nodeChange: NodeChange) => {
    const processed = processNodeChange(nodeChange);
    const segments = parsePath(processed.path);
    
    // Map change types to our categories
    let changeCategory: 'added' | 'removed' | 'modified' = 'modified';
    if (nodeChange.type === 'added') changeCategory = 'added';
    else if (nodeChange.type === 'removed') changeCategory = 'removed';
    
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const fullPath = segments.slice(0, i + 1).join(' / ');

      if (!current.children.has(segment)) {
        // Determine node type
        let type: FileNode['type'] = 'element';
        if (i === 0) type = 'page';
        else if (i === 1) type = 'section';
        else if (nodeChange.nodeType === 'COMPONENT_SET') type = 'component-set';
        else if (nodeChange.nodeType === 'COMPONENT' || isVariantName(segment)) type = 'component';

        current.children.set(segment, {
          name: segment,
          path: fullPath,
          type,
          changes: { added: [], removed: [], modified: [] },
          children: new Map(),
          stats: { totalChanges: 0, added: 0, removed: 0, modified: 0 },
        });
      }

      const node = current.children.get(segment)!;

      if (isLast) {
        node.changes[changeCategory].push(processed);
        node.stats[changeCategory]++;
        node.stats.totalChanges++;
      }

      // Propagate stats up
      current.stats[changeCategory]++;
      current.stats.totalChanges++;

      current = node;
    }
  };

  // Process all node changes
  if (diff.nodeChanges && Array.isArray(diff.nodeChanges)) {
    diff.nodeChanges.forEach(processChange);
  }

  return root;
}

/**
 * Group changes by component sets
 */
export function groupByComponents(diff: DiffResult): ComponentGroup[] {
  const componentSets = new Map<string, ComponentGroup>();

  const processComponent = (nodeChange: NodeChange) => {
    // Only process components
    if (nodeChange.nodeType !== 'COMPONENT') return;

    const processed = processNodeChange(nodeChange);
    const segments = parsePath(processed.path);
    if (segments.length < 2) return;

    // Map change types to our categories
    let changeCategory: 'added' | 'removed' | 'modified' = 'modified';
    if (nodeChange.type === 'added') changeCategory = 'added';
    else if (nodeChange.type === 'removed') changeCategory = 'removed';

    // Find the component set (parent with multiple variants)
    // Usually the pattern is: Document / ComponentName / ComponentName / Variants / VariantName
    let setName = '';
    let setPath = '';

    // Look for a parent that could be a component set
    for (let i = segments.length - 2; i >= 0; i--) {
      const segment = segments[i];
      // Component sets often have the same name as their parent folder
      if (i > 0 && segments[i - 1] === segment) {
        setName = segment;
        setPath = segments.slice(0, i + 1).join(' / ');
        break;
      }
      // Or look for "Buttons", "Cards", etc. pattern
      if (/^[A-Z]/.test(segment) && !isVariantName(segment)) {
        setName = segment;
        setPath = segments.slice(0, i + 1).join(' / ');
      }
    }

    if (!setName) {
      // Fallback: use the second-to-last segment
      setName = segments[segments.length - 2] || segments[0];
      setPath = segments.slice(0, -1).join(' / ');
    }

    if (!componentSets.has(setPath)) {
      componentSets.set(setPath, {
        name: setName,
        setPath,
        variants: [],
        stats: { added: 0, removed: 0, modified: 0 },
      });
    }

    const group = componentSets.get(setPath)!;
    const variantName = processed.name;
    const props = parseVariantProps(variantName);

    group.variants.push({
      name: variantName,
      change: nodeChange.type,
      properties: props,
    });
    group.stats[changeCategory]++;
  };

  // Process all node changes
  if (diff.nodeChanges && Array.isArray(diff.nodeChanges)) {
    diff.nodeChanges.forEach(processComponent);
  }

  // Sort by number of changes
  return Array.from(componentSets.values())
    .filter(g => g.variants.length > 0)
    .sort((a, b) => {
      const totalA = a.stats.added + a.stats.removed + a.stats.modified;
      const totalB = b.stats.added + b.stats.removed + b.stats.modified;
      return totalB - totalA;
    });
}

/**
 * Get stats per top-level page/section
 */
export function getPageStats(tree: FileNode): StructuredDiff['pageStats'] {
  const stats: StructuredDiff['pageStats'] = [];

  // Get first level children (pages)
  for (const [name, node] of tree.children) {
    // Get second level (sections within pages)
    for (const [sectionName, sectionNode] of node.children) {
      stats.push({
        name: sectionName,
        path: sectionNode.path,
        changes: sectionNode.stats.totalChanges,
        breakdown: {
          added: sectionNode.stats.added,
          removed: sectionNode.stats.removed,
          modified: sectionNode.stats.modified,
        },
      });
    }
  }

  return stats.sort((a, b) => b.changes - a.changes);
}

/**
 * Create a structured diff with multiple views
 */
export function createStructuredDiff(diff: DiffResult): StructuredDiff {
  const fileTree = buildFileTree(diff);
  const componentGroups = groupByComponents(diff);
  const pageStats = getPageStats(fileTree);

  return {
    fileTree,
    componentGroups,
    pageStats,
  };
}

/**
 * Generate HTML for the file structure view
 */
export function generateStructureHTML(structured: StructuredDiff): string {
  let html = `
    <div class="structure-report">
      <div class="report-header">
        <h2>📁 File Structure</h2>
        <p class="subtitle">Changes organized by location in the document</p>
      </div>

      <div class="page-overview">
        <h3>Sections Changed</h3>
        <div class="page-cards">
  `;

  // Top sections by changes
  const topSections = structured.pageStats.slice(0, 10);
  for (const section of topSections) {
    const addedPct = section.breakdown.added / Math.max(section.changes, 1) * 100;
    const removedPct = section.breakdown.removed / Math.max(section.changes, 1) * 100;
    const modifiedPct = section.breakdown.modified / Math.max(section.changes, 1) * 100;

    html += `
      <div class="page-card">
        <div class="page-name">${escapeHtml(section.name)}</div>
        <div class="page-path">${escapeHtml(section.path)}</div>
        <div class="page-stats">
          <span class="stat-total">${section.changes} changes</span>
        </div>
        <div class="change-bar">
          <div class="bar-added" style="width: ${addedPct}%"></div>
          <div class="bar-modified" style="width: ${modifiedPct}%"></div>
          <div class="bar-removed" style="width: ${removedPct}%"></div>
        </div>
        <div class="change-legend">
          <span class="legend-added">+${section.breakdown.added}</span>
          <span class="legend-modified">~${section.breakdown.modified}</span>
          <span class="legend-removed">-${section.breakdown.removed}</span>
        </div>
      </div>
    `;
  }

  html += `
        </div>
      </div>

      <div class="tree-view">
        <h3>Document Tree</h3>
        ${renderTreeNode(structured.fileTree, 0)}
      </div>
    </div>
  `;

  return html;
}

function renderTreeNode(node: FileNode, depth: number): string {
  if (depth > 4 || node.stats.totalChanges === 0) return '';

  const indent = depth * 16;
  const hasChildren = node.children.size > 0;
  const isExpanded = depth < 2;

  let icon = '📄';
  if (node.type === 'page') icon = '📑';
  else if (node.type === 'section') icon = '📁';
  else if (node.type === 'component-set') icon = '🧩';
  else if (node.type === 'component') icon = '⚙️';

  let html = `
    <div class="tree-node ${hasChildren ? 'has-children' : ''} ${isExpanded ? 'expanded' : ''}" style="padding-left: ${indent}px">
      <div class="tree-node-header">
        ${hasChildren ? '<span class="tree-toggle">▶</span>' : '<span class="tree-spacer"></span>'}
        <span class="tree-icon">${icon}</span>
        <span class="tree-name">${escapeHtml(node.name)}</span>
        <span class="tree-stats">
          ${node.stats.added > 0 ? `<span class="stat-added">+${node.stats.added}</span>` : ''}
          ${node.stats.modified > 0 ? `<span class="stat-modified">~${node.stats.modified}</span>` : ''}
          ${node.stats.removed > 0 ? `<span class="stat-removed">-${node.stats.removed}</span>` : ''}
        </span>
      </div>
  `;

  if (hasChildren) {
    html += `<div class="tree-children" style="${isExpanded ? '' : 'display: none'}">`;
    // Sort children by total changes
    const sortedChildren = Array.from(node.children.values())
      .sort((a, b) => b.stats.totalChanges - a.stats.totalChanges);
    
    for (const child of sortedChildren) {
      html += renderTreeNode(child, depth + 1);
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/**
 * Generate HTML for the component-focused view
 */
export function generateComponentViewHTML(structured: StructuredDiff): string {
  let html = `
    <div class="component-report">
      <div class="report-header">
        <h2>🧩 Components</h2>
        <p class="subtitle">${structured.componentGroups.length} component sets changed</p>
      </div>

      <div class="component-groups">
  `;

  for (const group of structured.componentGroups) {
    const totalVariants = group.variants.length;
    
    // Group variants by their properties
    const variantsByType = new Map<string, typeof group.variants>();
    for (const variant of group.variants) {
      const type = variant.properties['Type'] || variant.properties['State'] || 'Default';
      if (!variantsByType.has(type)) {
        variantsByType.set(type, []);
      }
      variantsByType.get(type)!.push(variant);
    }

    html += `
      <div class="component-group">
        <div class="component-header">
          <h4>${escapeHtml(group.name)}</h4>
          <div class="component-stats">
            ${group.stats.added > 0 ? `<span class="badge badge-added">+${group.stats.added} new</span>` : ''}
            ${group.stats.modified > 0 ? `<span class="badge badge-modified">${group.stats.modified} modified</span>` : ''}
            ${group.stats.removed > 0 ? `<span class="badge badge-removed">${group.stats.removed} removed</span>` : ''}
          </div>
        </div>
        <div class="component-path">${escapeHtml(group.setPath)}</div>
        
        <div class="variant-grid">
    `;

    // Show variants organized by type
    for (const [type, variants] of variantsByType) {
      if (variants.length > 6) {
        // Summarize if too many
        const addedCount = variants.filter(v => v.change === 'added').length;
        const modifiedCount = variants.filter(v => v.change === 'modified').length;
        const removedCount = variants.filter(v => v.change === 'removed').length;
        
        html += `
          <div class="variant-summary">
            <span class="variant-type">${escapeHtml(type)}</span>
            <span class="variant-count">${variants.length} variants</span>
            <span class="variant-breakdown">
              ${addedCount > 0 ? `<span class="added">+${addedCount}</span>` : ''}
              ${modifiedCount > 0 ? `<span class="modified">~${modifiedCount}</span>` : ''}
              ${removedCount > 0 ? `<span class="removed">-${removedCount}</span>` : ''}
            </span>
          </div>
        `;
      } else {
        for (const variant of variants) {
          html += `
            <div class="variant-item variant-${variant.change}">
              <span class="variant-name">${escapeHtml(variant.name)}</span>
              <span class="variant-change">${variant.change === 'added' ? '+' : variant.change === 'removed' ? '−' : '~'}</span>
            </div>
          `;
        }
      }
    }

    html += `
        </div>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generate a combined high-level markdown report for stakeholders
 */
export function generateStructureMarkdown(structured: StructuredDiff, fileName: string, dateRange: { from: string; to: string }): string {
  const totalChanges = structured.pageStats.reduce((sum, p) => sum + p.changes, 0);
  const totalAdded = structured.pageStats.reduce((sum, p) => sum + p.breakdown.added, 0);
  const totalModified = structured.pageStats.reduce((sum, p) => sum + p.breakdown.modified, 0);
  const totalRemoved = structured.pageStats.reduce((sum, p) => sum + p.breakdown.removed, 0);

  let md = `# Design Recap: ${fileName}\n\n`;
  md += `**Period:** ${dateRange.from} → ${dateRange.to}\n\n`;
  md += `---\n\n`;

  // Summary stats
  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Changes | ${totalChanges} |\n`;
  md += `| Added | +${totalAdded} |\n`;
  md += `| Modified | ~${totalModified} |\n`;
  md += `| Removed | -${totalRemoved} |\n`;
  md += `| Sections Updated | ${structured.pageStats.length} |\n`;
  md += `| Component Sets Changed | ${structured.componentGroups.length} |\n\n`;

  // Areas of work
  md += `## Areas of Work\n\n`;
  md += `The following sections had the most activity:\n\n`;

  const topSections = structured.pageStats.slice(0, 8);
  for (const section of topSections) {
    const statusIcon = section.breakdown.removed > section.breakdown.added ? '🔻' : 
                       section.breakdown.added > 10 ? '🆕' : '📝';
    md += `### ${statusIcon} ${section.name}\n\n`;
    md += `- **${section.changes}** changes (+${section.breakdown.added} / ~${section.breakdown.modified} / -${section.breakdown.removed})\n`;
    md += `- Location: \`${section.path}\`\n\n`;
  }

  // Component updates
  if (structured.componentGroups.length > 0) {
    md += `## Component Updates\n\n`;
    
    // Group by change type for summary
    const newComponents = structured.componentGroups.filter(g => g.stats.added > 0 && g.stats.removed === 0);
    const updatedComponents = structured.componentGroups.filter(g => g.stats.modified > 0);
    const removedComponents = structured.componentGroups.filter(g => g.stats.removed > 0 && g.stats.added === 0);

    if (newComponents.length > 0) {
      md += `### 🆕 New Components\n\n`;
      for (const comp of newComponents.slice(0, 10)) {
        md += `- **${comp.name}** - ${comp.stats.added} variant${comp.stats.added > 1 ? 's' : ''} added\n`;
      }
      if (newComponents.length > 10) {
        md += `- _...and ${newComponents.length - 10} more_\n`;
      }
      md += `\n`;
    }

    if (updatedComponents.length > 0) {
      md += `### 📝 Updated Components\n\n`;
      for (const comp of updatedComponents.slice(0, 10)) {
        md += `- **${comp.name}** - ${comp.stats.modified} variant${comp.stats.modified > 1 ? 's' : ''} modified\n`;
      }
      if (updatedComponents.length > 10) {
        md += `- _...and ${updatedComponents.length - 10} more_\n`;
      }
      md += `\n`;
    }

    if (removedComponents.length > 0) {
      md += `### 🗑️ Removed Components\n\n`;
      for (const comp of removedComponents.slice(0, 5)) {
        md += `- **${comp.name}** - ${comp.stats.removed} variant${comp.stats.removed > 1 ? 's' : ''} removed\n`;
      }
      md += `\n`;
    }
  }

  // Highlights section
  md += `## Highlights\n\n`;
  
  // Find notable patterns
  const biggestSection = structured.pageStats[0];
  if (biggestSection) {
    md += `- Most active area: **${biggestSection.name}** with ${biggestSection.changes} changes\n`;
  }

  const mostVariants = structured.componentGroups.sort((a, b) => b.variants.length - a.variants.length)[0];
  if (mostVariants && mostVariants.variants.length > 5) {
    md += `- Largest component update: **${mostVariants.name}** with ${mostVariants.variants.length} variants\n`;
  }

  if (totalAdded > totalRemoved * 2) {
    md += `- Net growth: Added ${totalAdded - totalRemoved} new elements\n`;
  } else if (totalRemoved > totalAdded) {
    md += `- Cleanup: Removed ${totalRemoved - totalAdded} elements\n`;
  }

  md += `\n---\n\n`;
  md += `_Generated by RecapMe_\n`;

  return md;
}
