import type { SemanticDiffResult, FeatureGroup } from '../analysis/semantic-grouper';
import type { ReadinessAssessment, ComponentReadiness } from '../analysis/readiness';

export interface EngineerReport {
  title: string;
  dateRange: {
    from: string;
    to: string;
  };
  readyForDev: EngineerFeature[];
  inProgress: EngineerFeature[];
  componentLibrary: ComponentSummary[];
  designTokens: TokenUsage;
  implementationNotes: string[];
}

export interface EngineerFeature {
  name: string;
  figmaUrl: string;
  path: string;
  readiness: ComponentReadiness;
  variants: VariantInfo[];
  missingItems: string[];
  implementationHints: string[];
}

export interface VariantInfo {
  name: string;
  properties: Record<string, string>;
}

export interface ComponentSummary {
  name: string;
  variantCount: number;
  properties: string[];
  states: string[];
  sizes: string[];
}

export interface TokenUsage {
  usesDesignTokens: boolean;
  customColors: number;
  customFonts: number;
  issues: string[];
}

/**
 * Parse variant properties from a component name
 */
function parseVariantProperties(name: string): Record<string, string> {
  const props: Record<string, string> = {};
  const matches = name.match(/([A-Za-z\s]+)=([^,]+)/g);
  if (matches) {
    for (const match of matches) {
      const [key, value] = match.split('=');
      props[key.trim()] = value.trim();
    }
  }
  return props;
}

/**
 * Extract unique property values from variants
 */
function extractPropertyValues(variants: string[]): { states: string[]; sizes: string[]; types: string[] } {
  const states = new Set<string>();
  const sizes = new Set<string>();
  const types = new Set<string>();

  for (const variant of variants) {
    const props = parseVariantProperties(variant);
    if (props['State']) states.add(props['State']);
    if (props['Size']) sizes.add(props['Size']);
    if (props['Type']) types.add(props['Type']);
  }

  return {
    states: Array.from(states),
    sizes: Array.from(sizes),
    types: Array.from(types),
  };
}

/**
 * Generate implementation hints for a feature
 */
function generateImplementationHints(feature: FeatureGroup): string[] {
  const hints: string[] = [];
  const { states, sizes, types } = extractPropertyValues(feature.variants);

  // Component structure hints
  if (feature.category === 'component-set' || feature.componentChanges.length > 5) {
    hints.push('Consider using a variant-based component approach');
  }

  // State management hints
  if (states.length > 0) {
    if (states.includes('Loading')) {
      hints.push('Implement loading state with spinner/skeleton');
    }
    if (states.includes('Disabled')) {
      hints.push('Handle disabled state with proper ARIA attributes');
    }
    if (states.includes('Error')) {
      hints.push('Include error state handling and messaging');
    }
  }

  // Size hints
  if (sizes.length > 1) {
    hints.push(`Support ${sizes.length} size variants: ${sizes.join(', ')}`);
  }

  // Type hints
  if (types.length > 1) {
    hints.push(`${types.length} visual variants: ${types.join(', ')}`);
  }

  // Icon hints
  if (feature.name.toLowerCase().includes('icon') || 
      feature.variants.some(v => v.includes('Icon='))) {
    hints.push('Uses icon system - ensure icon component integration');
  }

  return hints;
}

/**
 * Identify missing items for a feature
 */
function identifyMissingItems(feature: FeatureGroup): string[] {
  const missing: string[] = [];
  const { states, sizes } = extractPropertyValues(feature.variants);

  // Check for missing states
  const requiredStates = ['Default', 'Hover', 'Disabled'];
  const optionalStates = ['Active', 'Focus', 'Loading', 'Error'];

  for (const state of requiredStates) {
    if (!states.includes(state) && states.length > 0) {
      missing.push(`Missing required state: ${state}`);
    }
  }

  // Check for focus state (important for accessibility)
  if (states.length > 0 && !states.includes('Focus') && !states.includes('Active')) {
    missing.push('Consider adding Focus state for accessibility');
  }

  // Check for responsive variants
  const hasResponsive = feature.variants.some(v => 
    v.toLowerCase().includes('mobile') || 
    v.toLowerCase().includes('desktop') ||
    v.toLowerCase().includes('tablet')
  );
  if (!hasResponsive && feature.category === 'component-set') {
    missing.push('No responsive variants detected');
  }

  return missing;
}

/**
 * Create a default readiness assessment
 */
function createDefaultReadiness(feature: FeatureGroup): ComponentReadiness {
  const { states } = extractPropertyValues(feature.variants);
  
  return {
    overall: 60,
    hasAllStates: states.length >= 3,
    hasResponsive: false,
    usesTokens: false,
    hasAnnotations: false,
    hasPrototype: false,
    issues: identifyMissingItems(feature),
  };
}

/**
 * Generate engineer-focused report
 */
export function generateEngineerReport(
  semanticDiff: SemanticDiffResult,
  readinessData: Map<string, ReadinessAssessment> = new Map(),
  fileKey?: string
): EngineerReport {
  const readyForDev: EngineerFeature[] = [];
  const inProgress: EngineerFeature[] = [];
  const componentLibrary: ComponentSummary[] = [];

  for (const feature of semanticDiff.features) {
    // Skip non-component features
    if (feature.category === 'misc' || feature.category === 'icon') {
      continue;
    }

    const assessment = readinessData.get(feature.name);
    // Extract component readiness from assessment, or use default
    const readiness: ComponentReadiness = assessment?.components[0] || createDefaultReadiness(feature);
    
    const variants = feature.variants.map(v => ({
      name: v,
      properties: parseVariantProperties(v),
    }));

    const figmaUrl = fileKey 
      ? `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(feature.nodeChanges[0]?.nodeId || '')}`
      : '';

    const engineerFeature: EngineerFeature = {
      name: feature.name,
      figmaUrl,
      path: feature.path,
      readiness,
      variants,
      missingItems: readiness.issues,
      implementationHints: generateImplementationHints(feature),
    };

    if (readiness.overall >= 80) {
      readyForDev.push(engineerFeature);
    } else {
      inProgress.push(engineerFeature);
    }

    // Add to component library summary
    if (feature.category === 'component' || feature.category === 'component-set') {
      const { states, sizes, types } = extractPropertyValues(feature.variants);
      componentLibrary.push({
        name: feature.name,
        variantCount: feature.variants.length,
        properties: types,
        states,
        sizes,
      });
    }
  }

  // Sort by readiness
  readyForDev.sort((a, b) => b.readiness.overall - a.readiness.overall);
  inProgress.sort((a, b) => b.readiness.overall - a.readiness.overall);

  // Generate implementation notes
  const implementationNotes: string[] = [];
  
  if (componentLibrary.length > 0) {
    implementationNotes.push(`${componentLibrary.length} component${componentLibrary.length > 1 ? 's' : ''} to implement`);
  }
  
  const totalVariants = componentLibrary.reduce((sum, c) => sum + c.variantCount, 0);
  if (totalVariants > 0) {
    implementationNotes.push(`${totalVariants} total variants across all components`);
  }

  if (readyForDev.length > 0) {
    implementationNotes.push(`${readyForDev.length} component${readyForDev.length > 1 ? 's' : ''} ready for immediate implementation`);
  }

  return {
    title: `Engineering Handoff: ${semanticDiff.originalDiff.fileName}`,
    dateRange: {
      from: new Date(semanticDiff.originalDiff.fromVersion.createdAt).toLocaleDateString(),
      to: new Date(semanticDiff.originalDiff.toVersion.createdAt).toLocaleDateString(),
    },
    readyForDev,
    inProgress,
    componentLibrary,
    designTokens: {
      usesDesignTokens: false, // Will be enhanced by readiness analyzer
      customColors: 0,
      customFonts: 0,
      issues: [],
    },
    implementationNotes,
  };
}

/**
 * Generate HTML for engineer view
 */
export function generateEngineerHTML(report: EngineerReport): string {
  let html = `
    <div class="engineer-report">
      <div class="report-header">
        <h2>${report.title}</h2>
        <div class="date-range">${report.dateRange.from} → ${report.dateRange.to}</div>
      </div>

      ${report.implementationNotes.length > 0 ? `
        <div class="impl-notes">
          <h3>Implementation Overview</h3>
          <ul>
            ${report.implementationNotes.map(n => `<li>${n}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${report.readyForDev.length > 0 ? `
        <div class="section ready-section">
          <h3>Ready for Development (${report.readyForDev.length})</h3>
          ${report.readyForDev.map(feature => generateFeatureCard(feature, true)).join('')}
        </div>
      ` : ''}

      ${report.inProgress.length > 0 ? `
        <div class="section progress-section">
          <h3>In Progress (${report.inProgress.length})</h3>
          ${report.inProgress.map(feature => generateFeatureCard(feature, false)).join('')}
        </div>
      ` : ''}

      ${report.componentLibrary.length > 0 ? `
        <div class="section library-section">
          <h3>Component Library</h3>
          <table class="component-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Variants</th>
                <th>States</th>
                <th>Sizes</th>
              </tr>
            </thead>
            <tbody>
              ${report.componentLibrary.map(c => `
                <tr>
                  <td>${c.name}</td>
                  <td>${c.variantCount}</td>
                  <td>${c.states.join(', ') || '-'}</td>
                  <td>${c.sizes.join(', ') || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;

  return html;
}

function generateFeatureCard(feature: EngineerFeature, isReady: boolean): string {
  return `
    <div class="feature-card ${isReady ? 'ready' : 'in-progress'}">
      <div class="feature-header">
        <span class="feature-name">${feature.name}</span>
        <span class="readiness-badge">${feature.readiness.overall}%</span>
      </div>
      <div class="feature-path">${feature.path}</div>
      
      ${feature.figmaUrl ? `
        <a class="figma-link" href="${feature.figmaUrl}" target="_blank">Open in Figma</a>
      ` : ''}

      ${feature.variants.length > 0 ? `
        <div class="variants-summary">
          <strong>${feature.variants.length} variants</strong>
        </div>
      ` : ''}

      ${feature.implementationHints.length > 0 ? `
        <div class="impl-hints">
          <strong>Implementation:</strong>
          <ul>
            ${feature.implementationHints.map(h => `<li>${h}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${feature.missingItems.length > 0 ? `
        <div class="missing-items">
          <strong>Missing:</strong>
          <ul>
            ${feature.missingItems.map(m => `<li>${m}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="readiness-checklist">
        <span class="${feature.readiness.hasAllStates ? 'check' : 'missing'}">States</span>
        <span class="${feature.readiness.hasResponsive ? 'check' : 'missing'}">Responsive</span>
        <span class="${feature.readiness.usesTokens ? 'check' : 'missing'}">Tokens</span>
        <span class="${feature.readiness.hasAnnotations ? 'check' : 'missing'}">Annotations</span>
      </div>
    </div>
  `;
}

/**
 * Generate Markdown for engineer report
 */
export function generateEngineerMarkdown(report: EngineerReport): string {
  let md = `# ${report.title}\n\n`;
  md += `**Period:** ${report.dateRange.from} → ${report.dateRange.to}\n\n`;

  if (report.implementationNotes.length > 0) {
    md += `## Overview\n\n`;
    report.implementationNotes.forEach(n => {
      md += `- ${n}\n`;
    });
    md += '\n';
  }

  if (report.readyForDev.length > 0) {
    md += `## Ready for Development\n\n`;
    for (const feature of report.readyForDev) {
      md += generateFeatureMarkdown(feature);
    }
  }

  if (report.inProgress.length > 0) {
    md += `## In Progress\n\n`;
    for (const feature of report.inProgress) {
      md += generateFeatureMarkdown(feature);
    }
  }

  if (report.componentLibrary.length > 0) {
    md += `## Component Library\n\n`;
    md += `| Component | Variants | States | Sizes |\n`;
    md += `|-----------|----------|--------|-------|\n`;
    for (const c of report.componentLibrary) {
      md += `| ${c.name} | ${c.variantCount} | ${c.states.join(', ') || '-'} | ${c.sizes.join(', ') || '-'} |\n`;
    }
    md += '\n';
  }

  md += `\n---\n*Generated by RecapMe on ${new Date().toLocaleDateString()}*\n`;

  return md;
}

function generateFeatureMarkdown(feature: EngineerFeature): string {
  let md = `### ${feature.name} (${feature.readiness.overall}% ready)\n\n`;
  
  md += `**Path:** ${feature.path}\n\n`;
  
  if (feature.figmaUrl) {
    md += `[Open in Figma](${feature.figmaUrl})\n\n`;
  }

  md += `**Readiness Checklist:**\n`;
  md += `- [${feature.readiness.hasAllStates ? 'x' : ' '}] All states designed\n`;
  md += `- [${feature.readiness.hasResponsive ? 'x' : ' '}] Responsive variants\n`;
  md += `- [${feature.readiness.usesTokens ? 'x' : ' '}] Uses design tokens\n`;
  md += `- [${feature.readiness.hasAnnotations ? 'x' : ' '}] Has annotations\n`;
  md += `- [${feature.readiness.hasPrototype ? 'x' : ' '}] Has prototype\n\n`;

  if (feature.implementationHints.length > 0) {
    md += `**Implementation Notes:**\n`;
    feature.implementationHints.forEach(h => {
      md += `- ${h}\n`;
    });
    md += '\n';
  }

  if (feature.missingItems.length > 0) {
    md += `**Missing:**\n`;
    feature.missingItems.forEach(m => {
      md += `- ${m}\n`;
    });
    md += '\n';
  }

  return md;
}
