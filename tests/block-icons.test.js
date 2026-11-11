import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createBlockIcon, getBlockIconSource } from '../editor/blocks/icons.js';
import { getIconPath } from '../editor/toolbox-icons.js';

test('block icons are independent native image fields containing local SVG vectors', () => {
  class FieldImage {
    constructor(src, width, height, alt) { Object.assign(this, { src, width, height, alt }); }
  }
  const first = createBlockIcon('🏁', '#ffffff', { FieldImage });
  const second = createBlockIcon('🏁', '#ffffff', { FieldImage });
  assert.notEqual(first, second, 'fields cannot be shared between blocks');
  assert.equal(first.src, second.src);
  assert.equal(first.width, 20); assert.equal(first.height, 20);
  assert.equal(first.alt, '', 'decorations must not duplicate or pollute collapsed block labels');
  assert.match(first.src, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(first.src.split(',')[1]);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="#ffffff"/);
  assert.doesNotMatch(svg, /<image|<script|base64|href=/);
});

test('all 64 built-in decorative emoji positions have specific vector icons', () => {
  const directory = new URL('../editor/blocks/', import.meta.url);
  const sources = readdirSync(directory).filter(name => name.endsWith('.js'))
    .map(name => readFileSync(new URL(name, directory), 'utf8'));
  const icons = sources.flatMap(source => [...source.matchAll(/createBlockIcon\('([^']+)'/g)].map(match => match[1]));
  assert.equal(icons.length, 64);
  for (const icon of icons) assert.notEqual(getIconPath(icon), getIconPath('unknown'), icon);
  for (const source of sources) assert.doesNotMatch(source, /\.appendField\('\p{Extended_Pictographic}/u);
});

test('contrast colors are safe and user reaction emoji remain data, not icons', () => {
  assert.match(decodeURIComponent(getBlockIconSource('⚠️', '#475569')), /stroke="#475569"/);
  const unsafe = decodeURIComponent(getBlockIconSource('<script>bad</script>', '"><script/>'));
  assert.match(unsafe, /stroke="#ffffff"/);
  assert.doesNotMatch(unsafe, /<script/);
  const messages = readFileSync(new URL('../editor/blocks/messages.js', import.meta.url), 'utf8');
  assert.match(messages, /valueToCode\(block, 'EMOJI'[\s\S]*?'"👍"'/);
});

test('disabled-plugin search labels use SVG sources instead of treating emoji as image URLs', () => {
  const source = readFileSync(new URL('../editor/block-search.js', import.meta.url), 'utf8');
  assert.match(source, /fieldIcon\.textContent = getBlockIconSource\(statusIcon, '#475569'\)/);
});
