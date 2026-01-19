/**
 * Design System Indexer
 * Catalogs components and styles from a Figma design system file
 */

import { fetchFileComponents, fetchFileStyles, fetchFileMetadata } from '../api';
import type { DesignSystemIndex, IndexedComponent, DesignSystemComponent } from '../types';

/**
 * Parse variant properties from component name
 * e.g., "Button/Size=Large, State=Default" -> { Size: "Large", State: "Default" }
 */
function parseVariantFromName(name: string): Record<string, string> | null {
  const variants: Record<string, string> = {};

  // Check for variant format: ComponentName/Property=Value, Property=Value
  const slashIndex = name.indexOf('/');
  if (slashIndex === -1) return null;

  const variantPart = name.substring(slashIndex + 1);
  const pairs = variantPart.split(', ');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      variants[key.trim()] = value.trim();
    }
  }

  return Object.keys(variants).length > 0 ? variants : null;
}

/**
 * Extract base component name from a variant name
 * e.g., "Button/Size=Large, State=Default" -> "Button"
 */
function getBaseName(name: string): string {
  const slashIndex = name.indexOf('/');
  return slashIndex !== -1 ? name.substring(0, slashIndex) : name;
}

/**
 * Group components by their base name and extract all variant options
 */
function groupComponentVariants(components: DesignSystemComponent[]): IndexedComponent[] {
  const componentMap = new Map<string, {
    key: string;
    description: string;
    variants: Map<string, Set<string>>;
    defaultVariant?: Record<string, string>;
  }>();

  for (const comp of components) {
    const baseName = getBaseName(comp.name);
    const variantProps = parseVariantFromName(comp.name);

    if (!componentMap.has(baseName)) {
      componentMap.set(baseName, {
        key: comp.key,
        description: comp.description,
        variants: new Map(),
        defaultVariant: variantProps || undefined,
      });
    }

    const entry = componentMap.get(baseName)!;

    // Collect all variant options
    if (variantProps) {
      for (const [prop, value] of Object.entries(variantProps)) {
        if (!entry.variants.has(prop)) {
          entry.variants.set(prop, new Set());
        }
        entry.variants.get(prop)!.add(value);
      }
    }
  }

  // Convert to IndexedComponent array
  const indexed: IndexedComponent[] = [];

  for (const [name, data] of componentMap) {
    const variants: Record<string, string[]> = {};
    for (const [prop, values] of data.variants) {
      variants[prop] = Array.from(values).sort();
    }

    indexed.push({
      key: data.key,
      name,
      description: data.description,
      variants,
      defaultVariant: data.defaultVariant,
    });
  }

  return indexed.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Index a design system file and return structured component/style data
 */
export async function indexDesignSystem(
  fileKey: string,
  token: string
): Promise<DesignSystemIndex> {
  // Fetch all data in parallel
  const [components, styles, metadata] = await Promise.all([
    fetchFileComponents(fileKey, token),
    fetchFileStyles(fileKey, token),
    fetchFileMetadata(fileKey, token),
  ]);

  // Group components by base name and extract variants
  const indexedComponents = groupComponentVariants(components);

  return {
    fileKey,
    fileName: metadata.name,
    lastIndexed: new Date().toISOString(),
    components: indexedComponents,
    styles,
  };
}

/**
 * Generate a summary of the design system for use in prompts
 */
export function summarizeDesignSystem(index: DesignSystemIndex): string {
  const lines: string[] = [];

  lines.push(`Design System: ${index.fileName}`);
  lines.push(`Components: ${index.components.length}`);
  lines.push('');

  // List components with their variants
  lines.push('## Available Components');
  lines.push('');

  for (const comp of index.components) {
    const variantInfo = Object.entries(comp.variants)
      .map(([prop, values]) => `${prop}: [${values.join(', ')}]`)
      .join('; ');

    if (variantInfo) {
      lines.push(`- **${comp.name}** (key: ${comp.key})`);
      lines.push(`  Variants: ${variantInfo}`);
      if (comp.description) {
        lines.push(`  Description: ${comp.description}`);
      }
    } else {
      lines.push(`- **${comp.name}** (key: ${comp.key})`);
      if (comp.description) {
        lines.push(`  Description: ${comp.description}`);
      }
    }
  }

  lines.push('');

  // List styles
  if (index.styles.colors.length > 0) {
    lines.push('## Color Styles');
    lines.push(index.styles.colors.join(', '));
    lines.push('');
  }

  if (index.styles.typography.length > 0) {
    lines.push('## Typography Styles');
    lines.push(index.styles.typography.join(', '));
    lines.push('');
  }

  if (index.styles.effects.length > 0) {
    lines.push('## Effect Styles');
    lines.push(index.styles.effects.join(', '));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Find a component by name (case-insensitive partial match)
 */
export function findComponent(
  index: DesignSystemIndex,
  searchName: string
): IndexedComponent | undefined {
  const lowerSearch = searchName.toLowerCase();

  // Try exact match first
  const exact = index.components.find(
    c => c.name.toLowerCase() === lowerSearch
  );
  if (exact) return exact;

  // Try partial match
  return index.components.find(
    c => c.name.toLowerCase().includes(lowerSearch)
  );
}

/**
 * Validate that a design schema only references existing components
 */
export function validateSchemaComponents(
  index: DesignSystemIndex,
  componentKeys: string[]
): { valid: boolean; missing: string[] } {
  const availableKeys = new Set(index.components.map(c => c.key));
  const missing = componentKeys.filter(key => !availableKeys.has(key));

  return {
    valid: missing.length === 0,
    missing,
  };
}
