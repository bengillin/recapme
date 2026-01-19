import type { DiffResult, NodeChange, ComponentChange, StyleChange, ChangeType } from '../types';

/**
 * Represents a feature-level grouping of changes
 */
export interface FeatureGroup {
  name: string;
  description: string;
  category: FeatureCategory;
  changeType: 'new' | 'updated' | 'removed';
  changes: {
    added: number;
    modified: number;
    removed: number;
  };
  variants: string[];
  highlights: string[];
  nodeChanges: NodeChange[];
  componentChanges: ComponentChange[];
  path: string;
}

export type FeatureCategory = 
  | 'component'
  | 'component-set'
  | 'page-section'
  | 'style'
  | 'icon'
  | 'layout'
  | 'misc';

export interface SemanticDiffResult {
  features: FeatureGroup[];
  summary: {
    featuresWorkedOn: number;
    newFeatures: number;
    updatedFeatures: number;
    removedFeatures: number;
    totalChanges: number;
  };
  ungroupedChanges: NodeChange[];
  styleChanges: StyleChange[];
  originalDiff: DiffResult;
}

// Noise patterns - things to filter out or de-emphasize
const NOISE_PATTERNS = [
  /^Vector$/i,
  /^Rectangle \d+$/i,
  /^Ellipse \d+$/i,
  /^Line \d+$/i,
  /^Frame \d+$/i,
  /^Group \d+$/i,
  /^image$/i,
  /^Intersect$/i,
  /^Union$/i,
  /^Subtract$/i,
];

const NOISE_NODE_TYPES = ['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'REGULAR_POLYGON', 'STAR', 'SLICE'];

/**
 * Check if a node name is noise (generic/auto-generated)
 */
function isNoiseName(name: string): boolean {
  return NOISE_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Check if a node type is typically noise
 */
function isNoiseType(nodeType: string): boolean {
  return NOISE_NODE_TYPES.includes(nodeType);
}

/**
 * Extract the top-level feature name from a path
 * Path is like ["Document", "Button", "Button", "Buttons", "Type=Primary..."]
 * We want to find the meaningful top-level grouping
 */
function extractFeatureName(path: string[]): { name: string; fullPath: string } {
  // Skip Document and look for the first meaningful frame/component
  const meaningfulPath = path.filter(p => p !== 'Document' && !isNoiseName(p));
  
  if (meaningfulPath.length === 0) {
    return { name: 'Ungrouped', fullPath: path.join(' > ') };
  }
  
  // Return the first meaningful element as the feature name
  return {
    name: meaningfulPath[0],
    fullPath: meaningfulPath.slice(0, 3).join(' > '),
  };
}

/**
 * Detect if a component name represents a variant (has properties like State=, Type=)
 */
function isVariantName(name: string): boolean {
  return /[A-Za-z]+=/.test(name);
}

/**
 * Extract variant properties from a component name
 * e.g., "Type=Primary, State=Default" -> ["Type=Primary", "State=Default"]
 */
function extractVariantProperties(name: string): string[] {
  const matches = name.match(/[A-Za-z]+=[\w\s]+/g);
  return matches || [];
}

/**
 * Determine the category of a feature based on its changes
 */
function categorizeFeature(
  name: string,
  nodeChanges: NodeChange[],
  componentChanges: ComponentChange[]
): FeatureCategory {
  // Check if it's a component set
  const hasComponentSetChanges = nodeChanges.some(c => c.nodeType === 'COMPONENT_SET');
  if (hasComponentSetChanges || componentChanges.length > 5) {
    return 'component-set';
  }

  // Check if it's icons
  if (name.toLowerCase().includes('icon') || name.toLowerCase().includes('icons')) {
    return 'icon';
  }

  // Check if it has component changes
  if (componentChanges.length > 0 || nodeChanges.some(c => c.nodeType === 'COMPONENT')) {
    return 'component';
  }

  // Check if it's a style
  if (name.toLowerCase().includes('style') || name.toLowerCase().includes('color')) {
    return 'style';
  }

  // Default
  return nodeChanges.length > 10 ? 'page-section' : 'misc';
}

/**
 * Generate a human-readable description of changes
 */
function generateDescription(
  name: string,
  changeType: 'new' | 'updated' | 'removed',
  changes: { added: number; modified: number; removed: number },
  variants: string[],
  componentChanges: ComponentChange[]
): string {
  const parts: string[] = [];

  if (changeType === 'new') {
    if (componentChanges.length > 0) {
      parts.push(`New component with ${componentChanges.length} variant${componentChanges.length > 1 ? 's' : ''}`);
    } else {
      parts.push(`New ${name.toLowerCase()} added`);
    }
  } else if (changeType === 'removed') {
    parts.push(`${name} removed`);
  } else {
    if (changes.added > 0 && changes.modified > 0) {
      parts.push(`Added ${changes.added} elements, modified ${changes.modified}`);
    } else if (changes.added > 0) {
      parts.push(`Added ${changes.added} element${changes.added > 1 ? 's' : ''}`);
    } else if (changes.modified > 0) {
      parts.push(`Modified ${changes.modified} element${changes.modified > 1 ? 's' : ''}`);
    }
  }

  // Add variant info if significant
  if (variants.length > 3) {
    const uniqueProps = new Set<string>();
    variants.forEach(v => {
      const props = extractVariantProperties(v);
      props.forEach(p => {
        const propName = p.split('=')[0];
        uniqueProps.add(propName);
      });
    });
    if (uniqueProps.size > 0) {
      parts.push(`Variants: ${Array.from(uniqueProps).join(', ')}`);
    }
  }

  return parts.join('. ') || 'Changes made';
}

/**
 * Extract key highlights from the changes
 */
function extractHighlights(
  nodeChanges: NodeChange[],
  componentChanges: ComponentChange[]
): string[] {
  const highlights: string[] = [];

  // Look for state variants added
  const stateVariants = componentChanges
    .filter(c => c.type === 'added' && isVariantName(c.componentName))
    .map(c => {
      const props = extractVariantProperties(c.componentName);
      return props.find(p => p.startsWith('State='))?.split('=')[1];
    })
    .filter((s): s is string => !!s);

  if (stateVariants.length > 0) {
    const uniqueStates = [...new Set(stateVariants)];
    if (uniqueStates.length <= 5) {
      highlights.push(`States: ${uniqueStates.join(', ')}`);
    } else {
      highlights.push(`${uniqueStates.length} state variants`);
    }
  }

  // Look for size variants
  const sizeVariants = componentChanges
    .filter(c => c.type === 'added')
    .map(c => {
      const props = extractVariantProperties(c.componentName);
      return props.find(p => p.startsWith('Size='))?.split('=')[1];
    })
    .filter((s): s is string => !!s);

  if (sizeVariants.length > 0) {
    const uniqueSizes = [...new Set(sizeVariants)];
    highlights.push(`Sizes: ${uniqueSizes.join(', ')}`);
  }

  // Look for type variants
  const typeVariants = componentChanges
    .filter(c => c.type === 'added')
    .map(c => {
      const props = extractVariantProperties(c.componentName);
      return props.find(p => p.startsWith('Type='))?.split('=')[1];
    })
    .filter((s): s is string => !!s);

  if (typeVariants.length > 0) {
    const uniqueTypes = [...new Set(typeVariants)];
    if (uniqueTypes.length <= 5) {
      highlights.push(`Types: ${uniqueTypes.join(', ')}`);
    } else {
      highlights.push(`${uniqueTypes.length} type variants`);
    }
  }

  return highlights.slice(0, 5); // Limit highlights
}

/**
 * Group raw diff changes into semantic feature groups
 */
export function groupChangesSemanticaly(diff: DiffResult): SemanticDiffResult {
  const featureMap = new Map<string, {
    nodeChanges: NodeChange[];
    componentChanges: ComponentChange[];
    paths: Set<string>;
  }>();

  const ungroupedChanges: NodeChange[] = [];

  // Group node changes by feature
  for (const change of diff.nodeChanges) {
    // Skip pure noise
    if (isNoiseName(change.nodeName) && isNoiseType(change.nodeType)) {
      continue;
    }

    const { name } = extractFeatureName(change.path);
    
    if (name === 'Ungrouped' || isNoiseName(name)) {
      ungroupedChanges.push(change);
      continue;
    }

    if (!featureMap.has(name)) {
      featureMap.set(name, {
        nodeChanges: [],
        componentChanges: [],
        paths: new Set(),
      });
    }

    const feature = featureMap.get(name)!;
    feature.nodeChanges.push(change);
    feature.paths.add(change.path.slice(0, 3).join(' > '));
  }

  // Group component changes by feature
  for (const change of diff.componentChanges) {
    // Try to find matching feature from node changes
    const componentPath = change.componentName.split('/');
    const featureName = componentPath[0] || change.componentName;
    
    // Also check if component name matches any existing feature
    let matchedFeature: string | null = null;
    
    for (const [name] of featureMap) {
      if (featureName.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(featureName.toLowerCase())) {
        matchedFeature = name;
        break;
      }
    }

    const targetFeature = matchedFeature || featureName;

    if (!featureMap.has(targetFeature)) {
      featureMap.set(targetFeature, {
        nodeChanges: [],
        componentChanges: [],
        paths: new Set(),
      });
    }

    featureMap.get(targetFeature)!.componentChanges.push(change);
  }

  // Convert to FeatureGroup array
  const features: FeatureGroup[] = [];

  for (const [name, data] of featureMap) {
    const { nodeChanges, componentChanges, paths } = data;

    // Skip very small groups (likely noise)
    if (nodeChanges.length === 0 && componentChanges.length === 0) {
      continue;
    }

    // Calculate change counts
    const changes = {
      added: nodeChanges.filter(c => c.type === 'added').length + 
             componentChanges.filter(c => c.type === 'added').length,
      modified: nodeChanges.filter(c => c.type === 'modified' || c.type === 'renamed').length +
                componentChanges.filter(c => c.type === 'modified').length,
      removed: nodeChanges.filter(c => c.type === 'removed').length +
               componentChanges.filter(c => c.type === 'removed').length,
    };

    // Determine overall change type
    let changeType: 'new' | 'updated' | 'removed';
    if (changes.removed > changes.added && changes.removed > changes.modified) {
      changeType = 'removed';
    } else if (changes.added > changes.modified && changes.added > 0) {
      // Check if it's mostly new
      const newComponents = componentChanges.filter(c => c.type === 'added');
      changeType = newComponents.length > componentChanges.length / 2 ? 'new' : 'updated';
    } else {
      changeType = 'updated';
    }

    // Get variants
    const variants = componentChanges
      .filter(c => isVariantName(c.componentName))
      .map(c => c.componentName);

    features.push({
      name,
      description: generateDescription(name, changeType, changes, variants, componentChanges),
      category: categorizeFeature(name, nodeChanges, componentChanges),
      changeType,
      changes,
      variants,
      highlights: extractHighlights(nodeChanges, componentChanges),
      nodeChanges,
      componentChanges,
      path: Array.from(paths)[0] || name,
    });
  }

  // Sort features: new first, then by total changes
  features.sort((a, b) => {
    if (a.changeType === 'new' && b.changeType !== 'new') return -1;
    if (b.changeType === 'new' && a.changeType !== 'new') return 1;
    const aTotal = a.changes.added + a.changes.modified + a.changes.removed;
    const bTotal = b.changes.added + b.changes.modified + b.changes.removed;
    return bTotal - aTotal;
  });

  return {
    features,
    summary: {
      featuresWorkedOn: features.length,
      newFeatures: features.filter(f => f.changeType === 'new').length,
      updatedFeatures: features.filter(f => f.changeType === 'updated').length,
      removedFeatures: features.filter(f => f.changeType === 'removed').length,
      totalChanges: diff.summary.totalChanges,
    },
    ungroupedChanges,
    styleChanges: diff.styleChanges,
    originalDiff: diff,
  };
}

/**
 * Get a simplified summary for quick display
 */
export function getSimpleSummary(result: SemanticDiffResult): string[] {
  const lines: string[] = [];

  lines.push(`${result.summary.featuresWorkedOn} features worked on`);
  
  if (result.summary.newFeatures > 0) {
    lines.push(`${result.summary.newFeatures} new feature${result.summary.newFeatures > 1 ? 's' : ''}`);
  }
  
  if (result.summary.updatedFeatures > 0) {
    lines.push(`${result.summary.updatedFeatures} updated`);
  }

  // Top 3 features
  const topFeatures = result.features.slice(0, 3);
  for (const feature of topFeatures) {
    const changeCount = feature.changes.added + feature.changes.modified;
    lines.push(`• ${feature.name}: ${feature.description}`);
  }

  if (result.features.length > 3) {
    lines.push(`...and ${result.features.length - 3} more`);
  }

  return lines;
}
