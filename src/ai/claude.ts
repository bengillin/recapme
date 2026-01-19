/**
 * Claude API Integration
 * Interprets product specs and generates design schemas
 */

import type { DesignSchema, DesignSystemIndex, ProductSpec } from '../types';
import { summarizeDesignSystem } from '../design-system/indexer';
import { summarizeProductSpec } from '../integrations/notion';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Call the Claude API
 */
async function callClaude(
  apiKey: string,
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new ClaudeAPIError('Invalid Anthropic API key', 401);
    }
    if (response.status === 429) {
      throw new ClaudeAPIError('Rate limited. Please try again later.', 429);
    }
    const errorData = await response.json().catch(() => ({}));
    throw new ClaudeAPIError(
      errorData.error?.message || `API error: ${response.statusText}`,
      response.status
    );
  }

  const data: ClaudeResponse = await response.json();

  if (!data.content || data.content.length === 0) {
    throw new ClaudeAPIError('Empty response from Claude');
  }

  return data.content[0].text;
}

/**
 * Validate an Anthropic API key
 */
export async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    // Make a minimal request to verify the key
    await callClaude(
      apiKey,
      [{ role: 'user', content: 'Hello' }],
      'Respond with just "ok".',
      10
    );
    return true;
  } catch (error) {
    if (error instanceof ClaudeAPIError && error.status === 401) {
      return false;
    }
    // Other errors (rate limit, etc.) still mean the key is valid
    return true;
  }
}

/**
 * Generate the system prompt for design generation
 */
function buildSystemPrompt(): string {
  return `You are an expert UI designer. Your task is to generate a structured design schema based on a product specification and available design system components.

IMPORTANT RULES:
1. Only use components that exist in the provided design system
2. Use the exact component keys provided
3. Set appropriate variant properties based on the context
4. Use auto-layout (vertical/horizontal) for all frames
5. Choose appropriate sizing (width, height as numbers, "fill", or "hug")
6. Standard mobile width is 390px, desktop is 1440px
7. Use reasonable padding (16-24px) and gaps (8-16px)

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this structure:
{
  "screens": [
    {
      "name": "Screen Name",
      "width": 390,
      "height": 844,
      "layout": "vertical",
      "padding": 16,
      "gap": 16,
      "children": [
        {
          "type": "component",
          "componentKey": "exact_key_from_design_system",
          "componentName": "Button",
          "variantProperties": { "Size": "lg", "Type": "primary" }
        },
        {
          "type": "frame",
          "layout": "horizontal",
          "gap": 8,
          "children": [...]
        },
        {
          "type": "text",
          "text": "Heading",
          "fontSize": 24,
          "fontWeight": 600
        }
      ]
    }
  ]
}

NODE TYPES:
- "component": References a design system component by its key
- "frame": A container with auto-layout
- "text": Simple text element

For components, you MUST include:
- componentKey: The exact key from the design system
- componentName: The component name (for reference)
- variantProperties: Object with variant settings if the component has variants

For frames, you can include:
- layout: "vertical" or "horizontal"
- width/height: number, "fill", or "hug"
- padding: number (all sides)
- gap: number (spacing between children)
- children: array of child nodes

For text, you can include:
- text: The text content
- fontSize: number
- fontWeight: number (400, 500, 600, 700)
- textAlign: "left", "center", or "right"`;
}

/**
 * Generate a design schema from a product spec using Claude
 */
export async function generateDesignSchema(
  apiKey: string,
  spec: ProductSpec,
  designSystem: DesignSystemIndex
): Promise<DesignSchema> {
  const systemPrompt = buildSystemPrompt();

  const designSystemSummary = summarizeDesignSystem(designSystem);
  const specSummary = summarizeProductSpec(spec);

  const userMessage = `Generate a design schema for the following product specification using the available design system components.

DESIGN SYSTEM:
${designSystemSummary}

PRODUCT SPECIFICATION:
${specSummary}

Generate a JSON design schema that implements ALL the screens mentioned in the specification. Use the design system components appropriately. If a required component doesn't exist in the design system, use a frame with text as a placeholder.

Return ONLY the JSON object, no explanation or markdown.`;

  const response = await callClaude(
    apiKey,
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  // Parse the JSON response
  try {
    // Try to extract JSON from the response (in case there's extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const schema = JSON.parse(jsonMatch[0]) as DesignSchema;

    // Validate basic structure
    if (!schema.screens || !Array.isArray(schema.screens)) {
      throw new Error('Invalid schema: missing screens array');
    }

    return schema;
  } catch (error) {
    throw new ClaudeAPIError(
      `Failed to parse design schema: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate that a design schema only references existing components
 */
export function validateSchema(
  schema: DesignSchema,
  designSystem: DesignSystemIndex
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const availableKeys = new Set(designSystem.components.map(c => c.key));

  function validateNode(node: { type: string; componentKey?: string; children?: unknown[] }, path: string) {
    if (node.type === 'component' && node.componentKey) {
      if (!availableKeys.has(node.componentKey)) {
        errors.push(`Component "${node.componentKey}" at ${path} not found in design system`);
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        validateNode(child as { type: string; componentKey?: string; children?: unknown[] }, `${path}.children[${index}]`);
      });
    }
  }

  for (let i = 0; i < schema.screens.length; i++) {
    const screen = schema.screens[i];
    for (let j = 0; j < screen.children.length; j++) {
      validateNode(screen.children[j], `screens[${i}].children[${j}]`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Map component names to keys (for when Claude returns names instead of keys)
 */
export function mapComponentNamesToKeys(
  schema: DesignSchema,
  designSystem: DesignSystemIndex
): DesignSchema {
  const nameToKey = new Map<string, string>();
  for (const comp of designSystem.components) {
    nameToKey.set(comp.name.toLowerCase(), comp.key);
  }

  function mapNode(node: { type: string; componentKey?: string; componentName?: string; children?: unknown[] }): void {
    if (node.type === 'component' && node.componentName && !node.componentKey) {
      const key = nameToKey.get(node.componentName.toLowerCase());
      if (key) {
        node.componentKey = key;
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => {
        mapNode(child as { type: string; componentKey?: string; componentName?: string; children?: unknown[] });
      });
    }
  }

  // Create a deep copy and map
  const mapped = JSON.parse(JSON.stringify(schema)) as DesignSchema;

  for (const screen of mapped.screens) {
    for (const child of screen.children) {
      mapNode(child);
    }
  }

  return mapped;
}
