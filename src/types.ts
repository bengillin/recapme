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
