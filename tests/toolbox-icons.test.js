import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createToolboxIcon } from '../editor/toolbox-icons.js';

test('every core category uses a local decorative SVG, including an unknown-icon fallback', () => {
  const documentRef = { createElementNS(namespace, tag) {
    return { namespace, tag, attrs: {}, children: [], classList: { add() {} },
      setAttribute(key, value) { this.attrs[key] = value; }, appendChild(child) { this.children.push(child); } };
  } };
  const html = readFileSync(new URL('../editor/index.html', import.meta.url), 'utf8');
  const names = [...html.matchAll(/data-icon="([^"]+)"/g)].map(match => match[1]);
  assert.equal(names.length, 19);
  const paths = names.map(name => createToolboxIcon(name, documentRef).children[0].attrs.d);
  assert.equal(new Set(paths).size, 19);
  const svg = createToolboxIcon('<script>bad</script>', documentRef);
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attrs['aria-hidden'], 'true');
  assert.equal(svg.attrs.viewBox, '0 0 24 24');
  assert.equal(svg.children[0].tag, 'path');
  assert.doesNotMatch(svg.children[0].attrs.d, /script/);
});

test('replacement logo is a real vector without an embedded raster or external dependency', () => {
  const svg = readFileSync(new URL('../editor/assets/edbb-logo.svg', import.meta.url), 'utf8');
  assert.match(svg, /viewBox="0 0 100 100"/);
  assert.doesNotMatch(svg, /<image|base64|https?:\/\/(?!www\.w3\.org)/);
});
