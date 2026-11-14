import { getIconPath } from '../toolbox-icons.js';

const sources = new Map();

// Inline vectors also survive workspace SVG/thumbnail export without a network
// request. Named inputs and generator values are unaffected by this decoration.
export const getBlockIconSource = (icon, color = '#ffffff') => {
  const safeColor = /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(color) ? color : '#ffffff';
  const key = `${icon}:${safeColor}`;
  if (!sources.has(key)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${getIconPath(icon)}"/></svg>`;
    sources.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return sources.get(key);
};

export const createBlockIcon = (icon, color = '#ffffff', blockly = globalThis.Blockly) =>
  new blockly.FieldImage(getBlockIconSource(icon, color), 20, 20, '');
