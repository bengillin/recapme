/**
 * Figma Generator
 * Creates Figma nodes from a design schema
 */

import type { DesignSchema, ScreenSchema, DesignNode, GenerationResult } from '../types';

// Default font to use - Inter is widely available
const DEFAULT_FONT: FontName = { family: 'Inter', style: 'Regular' };
const BOLD_FONT: FontName = { family: 'Inter', style: 'Semi Bold' };

/**
 * Load fonts needed for text nodes
 */
async function loadFonts(): Promise<void> {
  await Promise.all([
    figma.loadFontAsync(DEFAULT_FONT),
    figma.loadFontAsync(BOLD_FONT),
  ]);
}

/**
 * Parse a dimension value (number, "fill", or "hug")
 */
function parseDimension(value: number | 'fill' | 'hug' | undefined): {
  mode: 'FIXED' | 'FILL' | 'HUG';
  size?: number;
} {
  if (value === 'fill') {
    return { mode: 'FILL' };
  }
  if (value === 'hug' || value === undefined) {
    return { mode: 'HUG' };
  }
  return { mode: 'FIXED', size: value };
}

/**
 * Apply dimension to a frame
 */
function applyDimension(
  frame: FrameNode,
  axis: 'width' | 'height',
  value: number | 'fill' | 'hug' | undefined
): void {
  const parsed = parseDimension(value);

  if (axis === 'width') {
    if (parsed.mode === 'FILL') {
      frame.layoutSizingHorizontal = 'FILL';
    } else if (parsed.mode === 'HUG') {
      frame.layoutSizingHorizontal = 'HUG';
    } else if (parsed.size !== undefined) {
      frame.layoutSizingHorizontal = 'FIXED';
      frame.resize(parsed.size, frame.height);
    }
  } else {
    if (parsed.mode === 'FILL') {
      frame.layoutSizingVertical = 'FILL';
    } else if (parsed.mode === 'HUG') {
      frame.layoutSizingVertical = 'HUG';
    } else if (parsed.size !== undefined) {
      frame.layoutSizingVertical = 'FIXED';
      frame.resize(frame.width, parsed.size);
    }
  }
}

/**
 * Create a frame from a design node
 */
function createFrame(node: DesignNode): FrameNode {
  const frame = figma.createFrame();
  frame.name = 'Frame';

  // Set auto-layout
  frame.layoutMode = node.layout === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';

  // Set padding
  if (node.padding !== undefined) {
    frame.paddingTop = node.padding;
    frame.paddingBottom = node.padding;
    frame.paddingLeft = node.padding;
    frame.paddingRight = node.padding;
  }

  // Set gap
  if (node.gap !== undefined) {
    frame.itemSpacing = node.gap;
  }

  // Set dimensions
  applyDimension(frame, 'width', node.width);
  applyDimension(frame, 'height', node.height);

  // Set background
  if (node.background) {
    // Simple hex color support
    const color = parseColor(node.background);
    if (color) {
      frame.fills = [{ type: 'SOLID', color }];
    }
  } else {
    // Default to transparent
    frame.fills = [];
  }

  return frame;
}

/**
 * Parse a hex color string to RGB
 */
function parseColor(hex: string): RGB | null {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return { r, g, b };
    }
  }

  return null;
}

/**
 * Create a text node from a design node
 */
function createText(node: DesignNode): TextNode {
  const text = figma.createText();
  text.characters = node.text || 'Text';

  // Apply font weight
  if (node.fontWeight && node.fontWeight >= 600) {
    text.fontName = BOLD_FONT;
  } else {
    text.fontName = DEFAULT_FONT;
  }

  // Apply font size
  if (node.fontSize) {
    text.fontSize = node.fontSize;
  }

  // Apply text alignment
  if (node.textAlign) {
    text.textAlignHorizontal = node.textAlign.toUpperCase() as 'LEFT' | 'CENTER' | 'RIGHT';
  }

  return text;
}

/**
 * Generate a single design node
 */
async function generateNode(
  node: DesignNode,
  parent: FrameNode,
  stats: { componentInstances: number; errors: string[]; warnings: string[] }
): Promise<void> {
  if (node.type === 'component') {
    // Import and instantiate a component
    if (!node.componentKey) {
      // Try to create a placeholder
      const placeholder = figma.createFrame();
      placeholder.name = node.componentName || 'Missing Component';
      placeholder.resize(200, 50);
      placeholder.fills = [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95 } }];
      placeholder.strokes = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
      placeholder.strokeWeight = 1;
      placeholder.cornerRadius = 4;

      // Add label text
      const label = figma.createText();
      label.characters = node.componentName || 'Component';
      label.fontSize = 12;
      placeholder.layoutMode = 'HORIZONTAL';
      placeholder.primaryAxisAlignItems = 'CENTER';
      placeholder.counterAxisAlignItems = 'CENTER';
      placeholder.paddingLeft = 12;
      placeholder.paddingRight = 12;
      placeholder.appendChild(label);

      parent.appendChild(placeholder);
      stats.warnings.push(`Component "${node.componentName}" missing key, created placeholder`);
      return;
    }

    try {
      const component = await figma.importComponentByKeyAsync(node.componentKey);
      const instance = component.createInstance();

      // Set variant properties if provided
      if (node.variantProperties && Object.keys(node.variantProperties).length > 0) {
        try {
          instance.setProperties(node.variantProperties);
        } catch (error) {
          stats.warnings.push(
            `Could not set variant properties for ${node.componentName}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      parent.appendChild(instance);
      stats.componentInstances++;
    } catch (error) {
      // Create a placeholder for failed imports
      const placeholder = figma.createFrame();
      placeholder.name = `[Error] ${node.componentName || node.componentKey}`;
      placeholder.resize(200, 50);
      placeholder.fills = [{ type: 'SOLID', color: { r: 1, g: 0.9, b: 0.9 } }];
      placeholder.cornerRadius = 4;

      const label = figma.createText();
      label.characters = `Error: ${node.componentName || 'Component'}`;
      label.fontSize = 11;
      label.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.2, b: 0.2 } }];
      placeholder.layoutMode = 'HORIZONTAL';
      placeholder.primaryAxisAlignItems = 'CENTER';
      placeholder.counterAxisAlignItems = 'CENTER';
      placeholder.paddingLeft = 12;
      placeholder.paddingRight = 12;
      placeholder.appendChild(label);

      parent.appendChild(placeholder);
      stats.errors.push(
        `Failed to import component "${node.componentKey}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  } else if (node.type === 'frame') {
    const frame = createFrame(node);
    frame.name = 'Container';
    parent.appendChild(frame);

    // Generate children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        await generateNode(child, frame, stats);
      }
    }
  } else if (node.type === 'text') {
    const text = createText(node);
    parent.appendChild(text);
  }
}

/**
 * Generate a screen from a screen schema
 */
async function generateScreen(
  screen: ScreenSchema,
  stats: { componentInstances: number; errors: string[]; warnings: string[] }
): Promise<FrameNode> {
  // Create the main frame
  const frame = figma.createFrame();
  frame.name = screen.name;
  frame.resize(screen.width, screen.height);

  // Set up auto-layout
  frame.layoutMode = screen.layout === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';

  // Set padding
  frame.paddingTop = screen.padding;
  frame.paddingBottom = screen.padding;
  frame.paddingLeft = screen.padding;
  frame.paddingRight = screen.padding;

  // Set gap
  frame.itemSpacing = screen.gap;

  // Set background
  if (screen.background) {
    const color = parseColor(screen.background);
    if (color) {
      frame.fills = [{ type: 'SOLID', color }];
    }
  } else {
    // Default white background
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  }

  // Generate children
  for (const child of screen.children) {
    await generateNode(child, frame, stats);
  }

  return frame;
}

/**
 * Generate a complete design from a schema
 */
export async function generateFromSchema(schema: DesignSchema): Promise<GenerationResult> {
  const stats = {
    componentInstances: 0,
    errors: [] as string[],
    warnings: [] as string[],
  };

  // Load fonts first
  await loadFonts();

  // Get current page
  const page = figma.currentPage;

  // Calculate starting position (to the right of existing content)
  let startX = 0;
  for (const node of page.children) {
    if (node.type !== 'SLICE') {
      const rightEdge = node.x + node.width;
      if (rightEdge > startX) {
        startX = rightEdge;
      }
    }
  }
  startX += 100; // Add some padding

  const frames: FrameNode[] = [];
  let currentX = startX;

  // Generate each screen
  for (const screen of schema.screens) {
    try {
      const frame = await generateScreen(screen, stats);
      frame.x = currentX;
      frame.y = 0;
      frames.push(frame);
      currentX += frame.width + 50; // Space between screens
    } catch (error) {
      stats.errors.push(
        `Failed to generate screen "${screen.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Select and zoom to the generated frames
  if (frames.length > 0) {
    figma.currentPage.selection = frames;
    figma.viewport.scrollAndZoomIntoView(frames);
  }

  return {
    success: stats.errors.length === 0,
    framesCreated: frames.length,
    componentInstances: stats.componentInstances,
    errors: stats.errors.length > 0 ? stats.errors : undefined,
    warnings: stats.warnings.length > 0 ? stats.warnings : undefined,
  };
}

/**
 * Generate a simple test frame to verify the generator works
 */
export async function generateTestFrame(): Promise<FrameNode> {
  await loadFonts();

  const frame = figma.createFrame();
  frame.name = 'Generated Test Frame';
  frame.resize(390, 200);
  frame.layoutMode = 'VERTICAL';
  frame.paddingTop = 16;
  frame.paddingBottom = 16;
  frame.paddingLeft = 16;
  frame.paddingRight = 16;
  frame.itemSpacing = 12;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

  const heading = figma.createText();
  heading.characters = 'Design Generator Test';
  heading.fontName = BOLD_FONT;
  heading.fontSize = 18;
  frame.appendChild(heading);

  const body = figma.createText();
  body.characters = 'If you can see this, the generator is working correctly.';
  body.fontName = DEFAULT_FONT;
  body.fontSize = 14;
  frame.appendChild(body);

  // Position it nicely on the canvas
  frame.x = 0;
  frame.y = 0;

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

  return frame;
}
