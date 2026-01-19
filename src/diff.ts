import type {
  FigmaFileResponse,
  FigmaNode,
  FigmaVersion,
  DiffResult,
  NodeChange,
  ComponentChange,
  StyleChange,
  ChangeType,
} from './types';

interface NodeMap {
  [id: string]: {
    node: FigmaNode;
    path: string[];
  };
}

/**
 * Flatten a Figma document tree into a map of node ID -> node info
 */
function flattenNodes(node: FigmaNode, path: string[] = []): NodeMap {
  const result: NodeMap = {};
  const currentPath = [...path, node.name];

  result[node.id] = { node, path: currentPath };

  if (node.children) {
    for (const child of node.children) {
      Object.assign(result, flattenNodes(child, currentPath));
    }
  }

  return result;
}

/**
 * Check if two values are deeply equal
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

/**
 * Get important properties to compare for a node
 */
function getComparableProperties(node: FigmaNode): Record<string, unknown> {
  const props: Record<string, unknown> = {
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  // Visual properties
  if (node.fills) props.fills = node.fills;
  if (node.strokes) props.strokes = node.strokes;
  if (node.strokeWeight !== undefined) props.strokeWeight = node.strokeWeight;
  if (node.cornerRadius !== undefined) props.cornerRadius = node.cornerRadius;
  if (node.effects) props.effects = node.effects;

  // Layout properties
  if (node.layoutMode) props.layoutMode = node.layoutMode;
  if (node.primaryAxisSizingMode) props.primaryAxisSizingMode = node.primaryAxisSizingMode;
  if (node.counterAxisSizingMode) props.counterAxisSizingMode = node.counterAxisSizingMode;
  if (node.paddingLeft !== undefined) props.paddingLeft = node.paddingLeft;
  if (node.paddingRight !== undefined) props.paddingRight = node.paddingRight;
  if (node.paddingTop !== undefined) props.paddingTop = node.paddingTop;
  if (node.paddingBottom !== undefined) props.paddingBottom = node.paddingBottom;
  if (node.itemSpacing !== undefined) props.itemSpacing = node.itemSpacing;

  // Text properties
  if (node.characters) props.characters = node.characters;
  if (node.style) props.style = node.style;

  // Component properties
  if (node.componentId) props.componentId = node.componentId;
  if (node.componentPropertyDefinitions) {
    props.componentPropertyDefinitions = node.componentPropertyDefinitions;
  }

  // Size (but not position, as position changes are often noise)
  if (node.absoluteBoundingBox) {
    props.size = {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  return props;
}

/**
 * Find what properties changed between two nodes
 */
function findPropertyChanges(
  oldNode: FigmaNode,
  newNode: FigmaNode
): { property: string; before: unknown; after: unknown }[] {
  const changes: { property: string; before: unknown; after: unknown }[] = [];

  const oldProps = getComparableProperties(oldNode);
  const newProps = getComparableProperties(newNode);

  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);

  for (const key of allKeys) {
    if (!deepEqual(oldProps[key], newProps[key])) {
      changes.push({
        property: key,
        before: oldProps[key],
        after: newProps[key],
      });
    }
  }

  return changes;
}

/**
 * Format property changes into a human-readable string
 */
function formatPropertyChanges(
  changes: { property: string; before: unknown; after: unknown }[]
): string {
  const descriptions: string[] = [];

  for (const change of changes) {
    if (change.property === 'name') {
      descriptions.push(`renamed from "${change.before}" to "${change.after}"`);
    } else if (change.property === 'visible') {
      descriptions.push(change.after ? 'made visible' : 'hidden');
    } else if (change.property === 'fills') {
      descriptions.push('fill changed');
    } else if (change.property === 'strokes') {
      descriptions.push('stroke changed');
    } else if (change.property === 'effects') {
      descriptions.push('effects changed');
    } else if (change.property === 'style') {
      descriptions.push('text style changed');
    } else if (change.property === 'characters') {
      descriptions.push('text content changed');
    } else if (change.property === 'size') {
      const before = change.before as { width: number; height: number };
      const after = change.after as { width: number; height: number };
      descriptions.push(
        `resized from ${Math.round(before.width)}x${Math.round(before.height)} to ${Math.round(after.width)}x${Math.round(after.height)}`
      );
    } else if (change.property === 'layoutMode') {
      descriptions.push(`layout changed to ${change.after || 'none'}`);
    } else if (change.property === 'itemSpacing') {
      descriptions.push(`spacing changed from ${change.before} to ${change.after}`);
    } else if (
      ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].includes(change.property)
    ) {
      descriptions.push('padding changed');
    } else if (change.property === 'cornerRadius') {
      descriptions.push(`corner radius changed from ${change.before} to ${change.after}`);
    } else if (change.property === 'strokeWeight') {
      descriptions.push(`stroke weight changed from ${change.before} to ${change.after}`);
    } else {
      descriptions.push(`${change.property} changed`);
    }
  }

  // Deduplicate
  return [...new Set(descriptions)].join(', ');
}

/**
 * Compare two Figma file snapshots and generate a diff
 */
export function diffFiles(
  oldFile: FigmaFileResponse,
  newFile: FigmaFileResponse,
  oldVersion: FigmaVersion,
  newVersion: FigmaVersion
): DiffResult {
  const nodeChanges: NodeChange[] = [];
  const componentChanges: ComponentChange[] = [];
  const styleChanges: StyleChange[] = [];

  // Flatten node trees
  const oldNodes = flattenNodes(oldFile.document);
  const newNodes = flattenNodes(newFile.document);

  const oldNodeIds = new Set(Object.keys(oldNodes));
  const newNodeIds = new Set(Object.keys(newNodes));

  // Find added nodes
  for (const id of newNodeIds) {
    if (!oldNodeIds.has(id)) {
      const { node, path } = newNodes[id];
      // Skip document and canvas nodes
      if (node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;

      nodeChanges.push({
        type: 'added',
        nodeId: id,
        nodeName: node.name,
        nodeType: node.type,
        path,
        details: `Added ${node.type.toLowerCase()}`,
      });
    }
  }

  // Find removed nodes
  for (const id of oldNodeIds) {
    if (!newNodeIds.has(id)) {
      const { node, path } = oldNodes[id];
      // Skip document and canvas nodes
      if (node.type === 'DOCUMENT' || node.type === 'CANVAS') continue;

      nodeChanges.push({
        type: 'removed',
        nodeId: id,
        nodeName: node.name,
        nodeType: node.type,
        path,
        details: `Removed ${node.type.toLowerCase()}`,
      });
    }
  }

  // Find modified nodes
  for (const id of oldNodeIds) {
    if (newNodeIds.has(id)) {
      const oldInfo = oldNodes[id];
      const newInfo = newNodes[id];

      // Skip document and canvas nodes
      if (oldInfo.node.type === 'DOCUMENT' || oldInfo.node.type === 'CANVAS') continue;

      const propChanges = findPropertyChanges(oldInfo.node, newInfo.node);

      if (propChanges.length > 0) {
        // Determine change type
        let changeType: ChangeType = 'modified';
        const nameChange = propChanges.find((c) => c.property === 'name');

        if (nameChange && propChanges.length === 1) {
          changeType = 'renamed';
        }

        // Check if path changed (moved)
        const pathChanged =
          oldInfo.path.slice(0, -1).join('/') !== newInfo.path.slice(0, -1).join('/');
        if (pathChanged && propChanges.length === 0) {
          changeType = 'moved';
        }

        nodeChanges.push({
          type: changeType,
          nodeId: id,
          nodeName: newInfo.node.name,
          nodeType: newInfo.node.type,
          path: newInfo.path,
          details: formatPropertyChanges(propChanges),
          before: getComparableProperties(oldInfo.node),
          after: getComparableProperties(newInfo.node),
        });
      }
    }
  }

  // Compare components
  const oldComponents = oldFile.components || {};
  const newComponents = newFile.components || {};
  const oldComponentKeys = new Set(Object.keys(oldComponents));
  const newComponentKeys = new Set(Object.keys(newComponents));

  for (const key of newComponentKeys) {
    if (!oldComponentKeys.has(key)) {
      componentChanges.push({
        type: 'added',
        componentKey: key,
        componentName: newComponents[key].name,
        details: 'New component created',
        after: newComponents[key],
      });
    }
  }

  for (const key of oldComponentKeys) {
    if (!newComponentKeys.has(key)) {
      componentChanges.push({
        type: 'removed',
        componentKey: key,
        componentName: oldComponents[key].name,
        details: 'Component deleted',
        before: oldComponents[key],
      });
    } else {
      const oldComp = oldComponents[key];
      const newComp = newComponents[key];
      if (!deepEqual(oldComp, newComp)) {
        const changes: string[] = [];
        if (oldComp.name !== newComp.name) changes.push('name changed');
        if (oldComp.description !== newComp.description) changes.push('description updated');

        componentChanges.push({
          type: 'modified',
          componentKey: key,
          componentName: newComp.name,
          details: changes.join(', ') || 'Component updated',
          before: oldComp,
          after: newComp,
        });
      }
    }
  }

  // Compare styles
  const oldStyles = oldFile.styles || {};
  const newStyles = newFile.styles || {};
  const oldStyleKeys = new Set(Object.keys(oldStyles));
  const newStyleKeys = new Set(Object.keys(newStyles));

  for (const key of newStyleKeys) {
    if (!oldStyleKeys.has(key)) {
      styleChanges.push({
        type: 'added',
        styleKey: key,
        styleName: newStyles[key].name,
        styleType: newStyles[key].styleType,
        details: `New ${newStyles[key].styleType.toLowerCase()} style`,
        after: newStyles[key],
      });
    }
  }

  for (const key of oldStyleKeys) {
    if (!newStyleKeys.has(key)) {
      styleChanges.push({
        type: 'removed',
        styleKey: key,
        styleName: oldStyles[key].name,
        styleType: oldStyles[key].styleType,
        details: 'Style deleted',
        before: oldStyles[key],
      });
    } else {
      const oldStyle = oldStyles[key];
      const newStyle = newStyles[key];
      if (!deepEqual(oldStyle, newStyle)) {
        styleChanges.push({
          type: 'modified',
          styleKey: key,
          styleName: newStyle.name,
          styleType: newStyle.styleType,
          details: 'Style updated',
          before: oldStyle,
          after: newStyle,
        });
      }
    }
  }

  // Calculate summary
  const summary = {
    totalChanges:
      nodeChanges.length + componentChanges.length + styleChanges.length,
    nodesAdded: nodeChanges.filter((c) => c.type === 'added').length,
    nodesRemoved: nodeChanges.filter((c) => c.type === 'removed').length,
    nodesModified: nodeChanges.filter((c) => c.type === 'modified').length,
    nodesRenamed: nodeChanges.filter((c) => c.type === 'renamed').length,
    nodesMoved: nodeChanges.filter((c) => c.type === 'moved').length,
    componentsChanged: componentChanges.length,
    stylesChanged: styleChanges.length,
  };

  return {
    summary,
    nodeChanges,
    componentChanges,
    styleChanges,
    fromVersion: {
      id: oldVersion.id,
      createdAt: oldVersion.created_at,
      label: oldVersion.label,
    },
    toVersion: {
      id: newVersion.id,
      createdAt: newVersion.created_at,
      label: newVersion.label,
    },
    fileName: newFile.name,
  };
}
