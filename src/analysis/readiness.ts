import type { FeatureGroup } from './semantic-grouper';
import type { FigmaNode, FigmaFileResponse } from '../types';

export interface ReadinessAssessment {
  featureName: string;
  overall: number;
  components: ComponentReadiness[];
  issues: string[];
  recommendations: string[];
}

export interface ComponentReadiness {
  overall: number;
  hasAllStates: boolean;
  hasResponsive: boolean;
  usesTokens: boolean;
  hasAnnotations: boolean;
  hasPrototype: boolean;
  issues: string[];
}

// Required states for interactive components
const REQUIRED_STATES = ['Default', 'Hover', 'Disabled'];
const RECOMMENDED_STATES = ['Active', 'Focus', 'Loading', 'Error', 'Selected'];

// Responsive breakpoint indicators
const RESPONSIVE_INDICATORS = [
  'mobile', 'tablet', 'desktop', 
  'sm', 'md', 'lg', 'xl',
  'small', 'medium', 'large',
  '320', '768', '1024', '1440',
];

/**
 * Parse state values from variant names
 */
function extractStates(variants: string[]): string[] {
  const states = new Set<string>();
  
  for (const variant of variants) {
    const stateMatch = variant.match(/State=([^,]+)/i);
    if (stateMatch) {
      states.add(stateMatch[1].trim());
    }
  }
  
  return Array.from(states);
}

/**
 * Check if feature has responsive variants
 */
function hasResponsiveVariants(variants: string[], nodePaths: string[]): boolean {
  const allText = [...variants, ...nodePaths].join(' ').toLowerCase();
  
  return RESPONSIVE_INDICATORS.some(indicator => 
    allText.includes(indicator.toLowerCase())
  );
}

/**
 * Check if fills/strokes use design system styles (not raw hex colors)
 */
function checksTokenUsage(node: FigmaNode): { usesTokens: boolean; issues: string[] } {
  const issues: string[] = [];
  let usesTokens = true;

  // Check fills
  if (node.fills) {
    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && fill.color) {
        // Raw colors without style reference are an issue
        // In Figma API, styled fills would have additional metadata
        // For now, we flag fills that don't reference variables
        if (!fill.boundVariables) {
          // This is a simplification - in practice you'd check for style references
          usesTokens = false;
        }
      }
    }
  }

  return { usesTokens, issues };
}

/**
 * Calculate readiness for a single component/feature
 */
export function assessComponentReadiness(
  feature: FeatureGroup,
  figmaFile?: FigmaFileResponse
): ComponentReadiness {
  const issues: string[] = [];
  let score = 0;
  const maxScore = 100;

  // 1. Check for required states (30 points)
  const states = extractStates(feature.variants);
  const hasRequiredStates = REQUIRED_STATES.every(state => 
    states.some(s => s.toLowerCase() === state.toLowerCase())
  );
  
  if (hasRequiredStates) {
    score += 30;
  } else {
    const missingRequired = REQUIRED_STATES.filter(state => 
      !states.some(s => s.toLowerCase() === state.toLowerCase())
    );
    if (missingRequired.length > 0) {
      issues.push(`Missing required states: ${missingRequired.join(', ')}`);
    }
    // Partial credit
    const foundRequired = REQUIRED_STATES.length - missingRequired.length;
    score += (foundRequired / REQUIRED_STATES.length) * 30;
  }

  // Bonus for recommended states
  const hasRecommendedStates = RECOMMENDED_STATES.filter(state =>
    states.some(s => s.toLowerCase() === state.toLowerCase())
  );
  if (hasRecommendedStates.length > 0) {
    score += Math.min(hasRecommendedStates.length * 2, 10); // Up to 10 bonus points
  }

  // 2. Check for responsive variants (20 points)
  const nodePaths = feature.nodeChanges.map(c => c.path.join(' '));
  const hasResponsive = hasResponsiveVariants(feature.variants, nodePaths);
  
  if (hasResponsive) {
    score += 20;
  } else {
    // Only flag as issue for major components
    if (feature.category === 'component-set' || feature.componentChanges.length > 5) {
      issues.push('No responsive variants detected');
    }
    // Small components might not need responsive variants
    if (feature.category !== 'component-set') {
      score += 10; // Partial credit
    }
  }

  // 3. Design token usage (20 points)
  // This is a simplified check - full implementation would analyze the actual node data
  const usesTokens = true; // Default to true since we can't deeply analyze without full node data
  if (usesTokens) {
    score += 20;
  }

  // 4. Annotations check (15 points)
  // Check if any text nodes contain annotation-like content
  const annotationKeywords = ['note:', 'spec:', 'dev:', 'handoff:', 'TODO', 'implementation'];
  const hasAnnotations = feature.nodeChanges.some(change => {
    if (change.nodeType === 'TEXT') {
      const nodeName = change.nodeName.toLowerCase();
      return annotationKeywords.some(keyword => 
        nodeName.includes(keyword.toLowerCase())
      );
    }
    return false;
  });

  if (hasAnnotations) {
    score += 15;
  } else {
    if (feature.category === 'component-set') {
      issues.push('Consider adding developer annotations');
    }
    // Don't penalize too heavily
    score += 5;
  }

  // 5. Prototype connections (15 points)
  // Can't fully check this without prototype data, assume partial
  const hasPrototype = false; // Would need prototype API data
  if (feature.componentChanges.length > 3) {
    // Interactive components likely have some prototype
    score += 8;
  }

  return {
    overall: Math.min(Math.round(score), 100),
    hasAllStates: hasRequiredStates,
    hasResponsive,
    usesTokens,
    hasAnnotations,
    hasPrototype,
    issues,
  };
}

/**
 * Assess readiness for all features in a semantic diff
 */
export function assessAllFeatures(
  features: FeatureGroup[],
  figmaFile?: FigmaFileResponse
): Map<string, ReadinessAssessment> {
  const assessments = new Map<string, ReadinessAssessment>();

  for (const feature of features) {
    const componentReadiness = assessComponentReadiness(feature, figmaFile);
    
    const recommendations: string[] = [];
    
    // Generate recommendations based on issues
    if (!componentReadiness.hasAllStates) {
      recommendations.push('Add missing interaction states for complete component coverage');
    }
    if (!componentReadiness.hasResponsive && feature.category === 'component-set') {
      recommendations.push('Consider adding responsive variants for different screen sizes');
    }
    if (!componentReadiness.hasAnnotations) {
      recommendations.push('Add developer annotations to clarify implementation details');
    }
    if (!componentReadiness.hasPrototype && feature.variants.length > 5) {
      recommendations.push('Create a prototype to demonstrate interaction flows');
    }

    assessments.set(feature.name, {
      featureName: feature.name,
      overall: componentReadiness.overall,
      components: [componentReadiness],
      issues: componentReadiness.issues,
      recommendations,
    });
  }

  return assessments;
}

/**
 * Get overall readiness summary
 */
export function getReadinessSummary(assessments: Map<string, ReadinessAssessment>): {
  averageReadiness: number;
  readyCount: number;
  inProgressCount: number;
  needsWorkCount: number;
  topIssues: string[];
} {
  const values = Array.from(assessments.values());
  
  if (values.length === 0) {
    return {
      averageReadiness: 0,
      readyCount: 0,
      inProgressCount: 0,
      needsWorkCount: 0,
      topIssues: [],
    };
  }

  const total = values.reduce((sum, a) => sum + a.overall, 0);
  const averageReadiness = Math.round(total / values.length);

  const readyCount = values.filter(a => a.overall >= 80).length;
  const inProgressCount = values.filter(a => a.overall >= 50 && a.overall < 80).length;
  const needsWorkCount = values.filter(a => a.overall < 50).length;

  // Collect all issues and count frequency
  const issueCount = new Map<string, number>();
  for (const assessment of values) {
    for (const issue of assessment.issues) {
      issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
    }
  }

  // Get top 5 most common issues
  const topIssues = Array.from(issueCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue, count]) => `${issue} (${count} components)`);

  return {
    averageReadiness,
    readyCount,
    inProgressCount,
    needsWorkCount,
    topIssues,
  };
}

/**
 * Generate readiness badge/status
 */
export function getReadinessStatus(score: number): {
  status: 'ready' | 'almost' | 'in-progress' | 'needs-work';
  label: string;
  color: string;
} {
  if (score >= 90) {
    return { status: 'ready', label: 'Ready for Dev', color: '#4ade80' };
  }
  if (score >= 75) {
    return { status: 'almost', label: 'Almost Ready', color: '#fbbf24' };
  }
  if (score >= 50) {
    return { status: 'in-progress', label: 'In Progress', color: '#60a5fa' };
  }
  return { status: 'needs-work', label: 'Needs Work', color: '#f87171' };
}
