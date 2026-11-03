figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

/* domain:start */
const TYPE_LABELS = ['Text', 'Sticky', 'Table', 'Connector', 'Section', 'Image', 'Frame', 'Group', 'Shape', 'Square', 'Drawing', 'Code', 'Stamp', 'Widget', 'Link', 'Other'];

const SHAPE_TYPES = ['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'SHAPE_WITH_TEXT', 'BOOLEAN_OPERATION'];

// A name prefix like "[Table] Pricing" overrides the detected type
const PREFIX_PATTERN = /^\[([A-Za-z]+)\]\s*/;

function readPrefix(name) {
  const match = name.match(PREFIX_PATTERN);
  if (!match) return null;
  const label = TYPE_LABELS.find((t) => t.toLowerCase() === match[1].toLowerCase());
  return label || null;
}

function stripPrefix(name) {
  return name.replace(PREFIX_PATTERN, '');
}

// Guess a type label for a layer so the user can review it in the UI
function detectType(node) {
  const fromName = readPrefix(node.name);
  if (fromName) return fromName;
  if (node.type === 'TEXT') return 'Text';
  if (node.type === 'STICKY') return 'Sticky';
  if (node.type === 'TABLE') return 'Table';
  if (node.type === 'CONNECTOR') return 'Connector';
  if (node.type === 'SECTION') return 'Section';
  if (hasImageFill(node)) return 'Image';
  if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)) return 'Frame';
  if (node.type === 'GROUP') return 'Group';
  if (['VECTOR', 'LINE'].includes(node.type)) return 'Drawing';
  if (node.type === 'CODE_BLOCK') return 'Code';
  if (node.type === 'STAMP') return 'Stamp';
  if (node.type === 'WIDGET') return 'Widget';
  if (['EMBED', 'LINK_UNFURL'].includes(node.type)) return 'Link';
  if (node.type === 'RECTANGLE' && isSquare(node)) return 'Square';
  if (SHAPE_TYPES.includes(node.type)) return 'Shape';
  return 'Other';
}

// Content that has no other place in a row: code text or link URL
function readExtra(node) {
  if (node.type === 'CODE_BLOCK') return node.code;
  if (node.type === 'LINK_UNFURL') return node.linkUnfurlData.url;
  if (node.type === 'EMBED') return node.embedData.srcUrl;
  return '';
}

// Figma has no square node; a RECTANGLE with equal sides is one
function isSquare(node) {
  return node.width > 0 && node.width === node.height;
}

function hasImageFill(node) {
  return 'fills' in node && Array.isArray(node.fills) && node.fills.some((f) => f.type === 'IMAGE' && f.visible !== false);
}

/* domain:end */

function makeFigmaUrl(node) {
  if (!figma.fileKey) return '';
  const kind = figma.editorType === 'figjam' ? 'board' : 'design';
  return `https://www.figma.com/${kind}/${figma.fileKey}?node-id=${node.id.replace(/:/g, '-')}`;
}

// Each run gets a number, so a slow older run cannot overwrite a newer selection
let selectionRun = 0;

async function sendSelection() {
  const run = ++selectionRun;
  const selected = figma.currentPage.selection;
  const selectedIds = new Set(selected.map((node) => node.id));
  const neighbors = await findNeighbors(selectedIds);
  if (run !== selectionRun) return;
  const nodes = [...selected, ...neighbors];
  const items = nodes.map((node) => ({
    id: node.id,
    name: stripPrefix(node.name),
    type: detectType(node),
    text: node.type === 'TEXT' ? node.characters : '',
    auto: !selectedIds.has(node.id),
  }));
  figma.ui.postMessage({ type: 'selection', items });
}

// Read a FigJam table into a 2D array of strings, row by row
function readTable(node) {
  const rows = [];
  for (let row = 0; row < node.numRows; row++) {
    const cells = [];
    for (let col = 0; col < node.numColumns; col++) {
      const cell = node.cellAt(row, col);
      const text = cell && (typeof cell.text === 'string' ? cell.text : cell.text && cell.text.characters);
      cells.push(text || '');
    }
    rows.push(cells);
  }
  return rows;
}

// Text inside a Group, in layer order, so the row keeps the details and not only the group name.
// Text is not only in TEXT layers: stickies, shapes with text and tables hold it too.
function readGroupText(node) {
  const lines = [];
  const types = {};
  for (const child of node.findAll(() => true)) {
    types[child.type] = (types[child.type] || 0) + 1;
    let value = '';
    if (child.type === 'TEXT') value = child.characters;
    else if (child.type === 'TABLE') value = readTable(child).map((row) => row.join(' | ')).join('\n');
    else if (child.text && typeof child.text.characters === 'string') value = child.text.characters;
    if (value.trim()) lines.push(value.trim());
  }
  const found = Object.entries(types).map(([type, count]) => `${type} ${count}`).join(', ');
  return { lines, info: found || 'ไม่มี layer ข้างใน' };
}

// Layers linked to the selection by a connector are added automatically,
// so their relations are not lost. Only one hop away.
async function findNeighbors(selectedIds) {
  const found = new Map();

  // The Section a selected layer sits in comes along, so its row can point to it
  for (const node of figma.currentPage.selection) {
    const parent = node.parent;
    if (parent && parent.type === 'SECTION' && !selectedIds.has(parent.id)) found.set(parent.id, parent);
  }

  // Direct children of a selected Section come along, except connectors (they become links)
  for (const section of figma.currentPage.selection.filter((node) => node.type === 'SECTION')) {
    for (const child of section.children) {
      if (selectedIds.has(child.id) || child.type === 'CONNECTOR') continue;
      found.set(child.id, child);
    }
  }

  // Only connectors attached to the selection are checked, never the whole page
  for (const selectedNode of figma.currentPage.selection) {
    for (const connector of selectedNode.attachedConnectors || []) {
      const from = connector.connectorStart && connector.connectorStart.endpointNodeId;
      const to = connector.connectorEnd && connector.connectorEnd.endpointNodeId;
      if (!from || !to) continue;
      const otherId = selectedIds.has(from) ? to : selectedIds.has(to) ? from : null;
      if (!otherId || selectedIds.has(otherId) || found.has(otherId)) continue;
      const node = await figma.getNodeByIdAsync(otherId);
      if (node) found.set(otherId, node);
    }
  }
  return [...found.values()];
}

// Connectors whose both ends are in the sent set become relations between rows
async function findLinks(itemIds) {
  const ids = new Set(itemIds);
  const seen = new Set();
  const links = [];
  for (const id of itemIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) continue;
    for (const connector of node.attachedConnectors || []) {
      if (seen.has(connector.id)) continue;
      seen.add(connector.id);
      const from = connector.connectorStart && connector.connectorStart.endpointNodeId;
      const to = connector.connectorEnd && connector.connectorEnd.endpointNodeId;
      if (ids.has(from) && ids.has(to)) {
        links.push({ from, to, label: connector.text ? connector.text.characters : '' });
      }
    }
  }
  return links;
}

// Selection changes can fire many times while dragging, so wait until they settle
let selectionTimer = null;
function scheduleSelection() {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(sendSelection, 150);
}

figma.on('selectionchange', scheduleSelection);

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'ready') {
    const settings = await figma.clientStorage.getAsync('settings');
    figma.ui.postMessage({ type: 'settings', settings: settings || {}, fileKey: figma.fileKey || 'local' });
    sendSelection();
    return;
  }

  if (msg.type === 'save-settings') {
    await figma.clientStorage.setAsync('settings', msg.settings);
    figma.notify('บันทึกการตั้งค่าแล้ว');
    return;
  }

  if (msg.type === 'prepare') {
    // Export PNG only for layers that will become images, so text-only sends stay fast
    const links = await findLinks(msg.items.map((item) => item.id));
    const items = [];
    for (const item of msg.items) {
      const node = await figma.getNodeByIdAsync(item.id);
      if (!node) continue;

      let image = null;
      if (['Image', 'Frame', 'Group', 'Drawing', 'Stamp', 'Widget'].includes(item.type)) {
        try {
          image = await node.exportAsync({ format: 'PNG' });
        } catch (err) {
          image = null;
        }
      }

      // Remember which Section the layer sits in, so the row can link to it
      const sectionId = node.parent && node.parent.type === 'SECTION' ? node.parent.id : null;

      const group = node.type === 'GROUP' ? readGroupText(node) : null;
      items.push({
        ...item,
        figmaUrl: makeFigmaUrl(node),
        image,
        sectionId,
        table: item.type === 'Table' ? readTable(node) : null,
        extra: readExtra(node),
        groupText: group ? group.lines : [],
        groupInfo: group ? group.info : '',
        rawType: node.type,
        // Stable key so the same layer updates its row instead of adding a new one
        key: `${figma.fileKey || 'local'}:${node.id}`,
      });
    }
    figma.ui.postMessage({ type: 'prepared', items, links });
    return;
  }

  // Report which of the given node IDs no longer exist in the file
  if (msg.type === 'check-nodes') {
    const missing = [];
    for (const id of msg.ids) {
      const node = await figma.getNodeByIdAsync(id);
      if (!node || node.removed) missing.push(id);
    }
    figma.ui.postMessage({ type: 'missing-nodes', ids: missing });
    return;
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
