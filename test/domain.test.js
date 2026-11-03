// Run with: npm test
// Loads only the regions marked "domain:start" / "domain:end" from the plugin files,
// so the pure logic is tested without opening Figma or calling Notion.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadDomain(file, exportNames) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const regions = [...source.matchAll(/\/\* domain:start \*\/([\s\S]*?)\/\* domain:end \*\//g)].map((m) => m[1]);
  const code = regions.join('\n') + `\n;({ ${exportNames.join(', ')} })`;
  return vm.runInNewContext(code, {});
}

const ui = loadDomain('ui.html', ['parseNotionId', 'plain', 'text', 'hashText', 'contentHash', 'diffRow', 'buildMermaid']);
const code = loadDomain('code.js', ['readPrefix', 'stripPrefix', 'detectType', 'readExtra', 'hasImageFill']);

// Helpers that build the same shape Notion returns for a row
const richText = (value) => [{ plain_text: value }];
const row = ({ id, name, type = 'Sticky', section = [], connected = [], status = 'To do', hash = '' }) => ({
  id,
  properties: {
    Name: { title: richText(name) },
    Type: { select: { name: type } },
    Status: { status: { name: status } },
    'Figma hash': { rich_text: richText(hash) },
    'In section': { relation: section.map((id) => ({ id })) },
    'Connected to': { relation: connected.map((id) => ({ id })) },
  },
});

test('parseNotionId reads the ID from a Notion URL with dashes and query string', () => {
  assert.equal(
    ui.parseNotionId('https://app.notion.com/p/c9704495-2249-457e-bae4-8a28d23fd259?v=65bb8fdf04594c71bb7c34cca429a4be&source=copy_link'),
    'c97044952249457ebae48a28d23fd259',
  );
  assert.equal(ui.parseNotionId('no id here'), null);
});

test('contentHash changes when content changes but not when only the name changes', () => {
  const base = { name: 'A', text: 'hello', extra: '', table: null, rawType: 'TEXT' };
  assert.equal(ui.contentHash(base), ui.contentHash({ ...base, name: 'B' }));
  assert.notEqual(ui.contentHash(base), ui.contentHash({ ...base, text: 'bye' }));
});

test('diffRow reports name, type, restored status and content changes', () => {
  const page = row({ id: 'p1', name: 'Old', type: 'Sticky', status: 'Removed', hash: 'stale' });
  const item = { name: 'New', type: 'Table', text: '', extra: '', table: null, rawType: 'TABLE' };
  // Copy out of the vm realm so deepEqual compares plain arrays
  const changes = [...ui.diffRow(page, item)];
  assert.deepEqual(changes, [
    'Name: "Old" → "New"',
    'Type: Sticky → Table',
    'กลับมาใน Figma',
    'เนื้อหาเปลี่ยน',
  ]);
});

test('diffRow returns nothing when the row already matches the layer', () => {
  const item = { name: 'Same', type: 'Text', text: 'x', extra: '', table: null, rawType: 'TEXT' };
  const page = row({ id: 'p1', name: 'Same', type: 'Text', hash: ui.contentHash(item) });
  assert.deepEqual([...ui.diffRow(page, item)], []);
});

test('buildMermaid puts members inside their Section subgraph', () => {
  const rows = [
    row({ id: 's1', name: 'Auth', type: 'Section' }),
    row({ id: 'a', name: 'Login', section: ['s1'] }),
    row({ id: 'b', name: 'Logout', section: ['s1'], connected: ['a'] }),
  ];
  const out = ui.buildMermaid(rows);
  assert.match(out, /subgraph s0\["Auth"\]/);
  assert.match(out, /n1\["\[Sticky\] Login"\]/);
  assert.match(out, /n2 --> n1/);
  assert.match(out, /^  end$/m);
});

test('buildMermaid shows an empty Section as a plain node, not an empty subgraph', () => {
  const out = ui.buildMermaid([row({ id: 's1', name: 'Empty', type: 'Section' })]);
  assert.doesNotMatch(out, /subgraph/);
  assert.match(out, /s0\["Empty"\]/);
});

test('buildMermaid keeps quotes and brackets out of labels', () => {
  const out = ui.buildMermaid([row({ id: 'a', name: 'say "hi" [now]', type: 'Text' })]);
  assert.match(out, /\[Text\] say 'hi' 'now'/);
});

test('buildMermaid hides Removed layers and their connections', () => {
  const rows = [
    row({ id: 'a', name: 'Kept' }),
    row({ id: 'b', name: 'Gone', status: 'Removed', connected: ['a'] }),
    row({ id: 'c', name: 'Also kept', connected: ['b'] }),
  ];
  const out = ui.buildMermaid(rows);
  assert.doesNotMatch(out, /Gone/);
  assert.doesNotMatch(out, /-->/);
  assert.match(out, /Kept/);
});

test('buildMermaid cuts long labels and uses a top-to-bottom layout', () => {
  const long = 'x'.repeat(100);
  const out = ui.buildMermaid([row({ id: 'a', name: long })]);
  assert.match(out, /^flowchart TB$/m);
  assert.ok(!out.includes(long));
  assert.match(out, /x{40}…/);
});

test('buildMermaid links to a Section node as a subgraph reference', () => {
  const rows = [
    row({ id: 's1', name: 'Auth', type: 'Section' }),
    row({ id: 'a', name: 'Login', connected: ['s1'] }),
  ];
  assert.match(ui.buildMermaid(rows), /n1 --> s0/);
});

test('readPrefix finds a [Type] prefix case-insensitively and ignores unknown ones', () => {
  assert.equal(code.readPrefix('[table] Pricing'), 'Table');
  assert.equal(code.readPrefix('[IMAGE] Hero'), 'Image');
  assert.equal(code.readPrefix('[unknown] X'), null);
  assert.equal(code.readPrefix('Plain'), null);
});

test('stripPrefix removes the prefix from the name', () => {
  assert.equal(code.stripPrefix('[Table] Pricing'), 'Pricing');
  assert.equal(code.stripPrefix('Plain'), 'Plain');
});

test('detectType maps FigJam node types and falls back to Other', () => {
  const node = (type, name = 'x') => ({ type, name, fills: [] });
  assert.equal(code.detectType(node('STICKY')), 'Sticky');
  assert.equal(code.detectType(node('TABLE')), 'Table');
  assert.equal(code.detectType(node('VECTOR')), 'Drawing');
  assert.equal(code.detectType(node('CODE_BLOCK')), 'Code');
  assert.equal(code.detectType(node('RECTANGLE')), 'Shape');
  assert.equal(code.detectType(node('MYSTERY')), 'Other');
});

test('detectType reports Square for a rectangle with equal sides', () => {
  assert.equal(code.detectType({ type: 'RECTANGLE', name: 'box', fills: [], width: 80, height: 80 }), 'Square');
  assert.equal(code.detectType({ type: 'RECTANGLE', name: 'box', fills: [], width: 80, height: 40 }), 'Shape');
  assert.equal(code.detectType({ type: 'ELLIPSE', name: 'dot', fills: [], width: 80, height: 80 }), 'Shape');
});

test('detectType prefers a name prefix over the node type', () => {
  assert.equal(code.detectType({ type: 'RECTANGLE', name: '[Table] grid', fills: [] }), 'Table');
});

test('detectType reports Image when a shape has an image fill', () => {
  const node = { type: 'RECTANGLE', name: 'hero', fills: [{ type: 'IMAGE', visible: true }] };
  assert.equal(code.detectType(node), 'Image');
});
