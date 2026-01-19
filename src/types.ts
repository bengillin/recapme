// Figma REST API Types

export interface FigmaVersion {
  id: string;
  created_at: string;
  label: string | null;
  description: string | null;
  user: {
    id: string;
    handle: string;
    img_url: string;
  };
}

export interface VersionsResponse {
  versions: FigmaVersion[];
  pagination: {
    prev_page?: string;
    next_page?: string;
  };
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  blendMode?: string;
  gradientStops?: Array<{ color: FigmaColor; position: number }>;
  [key: string]: unknown;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: Array<{
    type: string;
    visible?: boolean;
    color?: FigmaColor;
    offset?: { x: number; y: number };
    radius?: number;
    spread?: number;
    [key: string]: unknown;
  }>;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  constraints?: {
    vertical: string;
    horizontal: string;
  };
  layoutMode?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  characters?: string;
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: string;
    textAlignVertical?: string;
    letterSpacing?: number;
    lineHeightPx?: number;
    lineHeightPercent?: number;
    [key: string]: unknown;
  };
  componentId?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FigmaComponent {
  key: string;
  name: string;
  description: string;
  documentationLinks?: string[];
}

export interface FigmaStyle {
  key: string;
  name: string;
  styleType: string;
  description: string;
}

export interface FigmaFileResponse {
  name: string;
  lastModified: string;
  version: string;
  document: FigmaNode;
  components: Record<string, FigmaComponent>;
  componentSets: Record<string, { key: string; name: string; description: string }>;
  styles: Record<string, FigmaStyle>;
  schemaVersion: number;
}

// Diff Result Types

export type ChangeType = 'added' | 'removed' | 'modified' | 'renamed' | 'moved';

export interface NodeChange {
  type: ChangeType;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  path: string[];
  details?: string;
  before?: unknown;
  after?: unknown;
}

export interface ComponentChange {
  type: ChangeType;
  componentKey: string;
  componentName: string;
  details?: string;
  before?: Partial<FigmaComponent>;
  after?: Partial<FigmaComponent>;
}

export interface StyleChange {
  type: ChangeType;
  styleKey: string;
  styleName: string;
  styleType: string;
  details?: string;
  before?: Partial<FigmaStyle>;
  after?: Partial<FigmaStyle>;
}

export interface PropertyChange {
  property: string;
  before: unknown;
  after: unknown;
}

export interface DiffResult {
  summary: {
    totalChanges: number;
    nodesAdded: number;
    nodesRemoved: number;
    nodesModified: number;
    nodesRenamed: number;
    nodesMoved: number;
    componentsChanged: number;
    stylesChanged: number;
  };
  nodeChanges: NodeChange[];
  componentChanges: ComponentChange[];
  styleChanges: StyleChange[];
  fromVersion: {
    id: string;
    createdAt: string;
    label: string | null;
  };
  toVersion: {
    id: string;
    createdAt: string;
    label: string | null;
  };
  fileName: string;
}

// UI Message Types

export interface UIMessage {
  type: string;
  [key: string]: unknown;
}

export interface InitMessage extends UIMessage {
  type: 'init';
  fileKey: string;
  hasStoredToken: boolean;
}

export interface GenerateRecapMessage extends UIMessage {
  type: 'generate-recap';
  token: string;
  startDate: string;
  endDate: string;
}

export interface RecapResultMessage extends UIMessage {
  type: 'recap-result';
  result: DiffResult;
}

export interface ErrorMessage extends UIMessage {
  type: 'error';
  message: string;
}

export interface LoadingMessage extends UIMessage {
  type: 'loading';
  message: string;
}

export interface TokenSavedMessage extends UIMessage {
  type: 'token-saved';
}

// ============================================
// Design Generation Types
// ============================================

/**
 * Design system component metadata from Figma API
 */
export interface DesignSystemComponent {
  key: string;
  name: string;
  description: string;
  containingFrame?: {
    name: string;
    nodeId: string;
  };
}

/**
 * Component with variant information for design system index
 */
export interface IndexedComponent {
  key: string;
  name: string;
  description: string;
  variants: Record<string, string[]>;
  defaultVariant?: Record<string, string>;
}

/**
 * Complete design system index
 */
export interface DesignSystemIndex {
  fileKey: string;
  fileName: string;
  lastIndexed: string;
  components: IndexedComponent[];
  styles: {
    colors: string[];
    typography: string[];
    effects: string[];
  };
}

/**
 * Parsed product spec from Notion
 */
export interface ProductSpec {
  title: string;
  overview: string;
  screens: ScreenSpec[];
  requirements: string[];
  userStories: string[];
}

/**
 * Individual screen specification
 */
export interface ScreenSpec {
  name: string;
  description: string;
  elements: string[];
  flow?: string;
}

/**
 * Design schema generated by Claude
 */
export interface DesignSchema {
  screens: ScreenSchema[];
}

/**
 * Schema for a single screen
 */
export interface ScreenSchema {
  name: string;
  width: number;
  height: number;
  layout: 'vertical' | 'horizontal' | 'grid';
  padding: number;
  gap: number;
  background?: string;
  children: DesignNode[];
}

/**
 * Individual design node in the schema
 */
export interface DesignNode {
  type: 'component' | 'frame' | 'text';
  componentKey?: string;
  componentName?: string;
  variantProperties?: Record<string, string>;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  layout?: 'vertical' | 'horizontal';
  width?: number | 'fill' | 'hug';
  height?: number | 'fill' | 'hug';
  padding?: number;
  gap?: number;
  background?: string;
  children?: DesignNode[];
}

/**
 * Generation result from the plugin
 */
export interface GenerationResult {
  success: boolean;
  framesCreated: number;
  componentInstances: number;
  errors?: string[];
  warnings?: string[];
}
