// Local vector icons: no platform-dependent emoji or icon-font downloads.
const paths = {
  '⚡': 'm13 2-9 12h7l-1 8 10-12h-7z',
  '🔘': 'M5 5h14v14H5z M9 12h6',
  '😊': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 9h.01 M16 9h.01 M8 14q4 5 8 0',
  '🔍': 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',
  '💬': 'M4 3h16v14H9l-5 4z M8 8h8 M8 12h5',
  '🛠️': 'M14 4a6 6 0 0 0-7 7L2 16l6 6 5-5a6 6 0 0 0 7-7l-4 4-4-4z',
  '💾': 'M3 3h15l3 3v15H3z M7 3v6h10V3 M7 21v-8h10v8',
  '🔊': 'M3 9h4l5-5v16l-5-5H3z M16 8q5 4 0 8 M19 4q8 8 0 16',
  '🤖': 'M5 7h14v13H5z M12 3v4 M2 11v5 M22 11v5 M8 12h.01 M16 12h.01 M9 16h6',
  '🛡️': 'M12 2 3 6v6q0 7 9 10 9-3 9-10V6z m-5 10 3 3 7-7',
  '🖼️': 'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M16 7h.01',
  '🔣': 'M4 5h6 M7 2v6 M4 18l6-8 M4 10l6 8 M14 5h7 M14 10h7 M14 16h7 M14 20h7',
  '📋': 'M9 4H4v18h16V4h-5 M9 2h6v4H9z M8 11h8 M8 16h8',
  '🧩': 'M3 3h6q-2 6 3 6t3-6h6v6q-6-2-6 3t6 3v6h-6q2-6-3-6t-3 6H3v-6q6 2 6-3t-6-3z',
  '⚖️': 'M12 3v18 M6 21h12 M3 7h18 M6 7l-4 8h8z M18 7l-4 8h8z',
  '🔄': 'M20 8a8 8 0 0 0-14-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M21 21v-5h-5',
  '↩️': 'M8 4 3 9l5 5 M3 9h12a6 6 0 0 1 0 12h-4',
  '🔢': 'M4 6h6 M7 3v6 M14 6h6 M4 15l6 6 M4 21l6-6 M14 16h6 M14 20h6',
  '🔤': 'M2 20 8 4l6 16 M4 15h8 M17 11h3q3 0 3 3v6 M23 15h-3q-4 0-4 3t4 2h3',
  '🏁': 'M5 22V3 M5 3h14l-3 4 3 4H5 M9 3v8 M13 3v8',
  '📩': 'M3 8h18v13H3z M3 10l9 6 9-6 M12 2v8 m-3-3 3 3 3-3',
  '👤': 'M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 22v-4a8 8 0 0 1 16 0v4',
  '👋': 'M8 12V5a2 2 0 0 1 4 0v6 M12 10V3a2 2 0 0 1 4 0v8 M16 12V6a2 2 0 0 1 4 0v10q0 7-7 7H9q-3 0-5-4l-3-5a2 2 0 0 1 3-2l4 4 M20 2l2 2',
  '⭐': 'm12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z',
  '🗣️': 'M4 21v-5a8 8 0 1 1 12-7l2 3h-3v4h-4v5 M20 6l2-2 M20 10h3 M20 14l2 2',
  '📺': 'M3 7h18v14H3z M8 2l4 5 4-5 M7 17h10',
  '📁': 'M2 5h7l3 3h10v13H2z',
  '🗑️': 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  '🌐': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2q-8 10 0 20 M12 2q8 10 0 20',
  '🔰': 'M3 3l9 5 9-5v12l-9 7-9-7z M12 8v14',
  '🎮': 'M7 6h10q3 0 4 4l2 7q1 5-3 4l-4-4H8l-4 4q-4 1-3-4l2-7q1-4 4-4z M5 11h6 M8 8v6 M16 10h.01 M19 13h.01',
  '🔇': 'M3 9h4l5-5v16l-5-5H3z M16 9l6 6 M16 15l6-6',
  '✨': 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z M4 2v4 M2 4h4 M20 18v4 M18 20h4',
  '📂': 'M2 18V5h7l3 3h10 M2 21l3-10h18l-3 10z',
  '❓': 'M9 7a3 3 0 1 1 5 2l-2 2v3 M12 18h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  '📦': 'm12 2 10 5v10l-10 5-10-5V7z M2 7l10 5 10-5 M12 12v10 M7 4.5l10 5',
  '🎲': 'M3 3h18v18H3z M7 7h.01 M17 7h.01 M12 12h.01 M7 17h.01 M17 17h.01',
  '⏳': 'M5 2h14 M5 22h14 M7 2v5l10 10v5 M17 2v5L7 17v5 M9 6h6 M9 19h6',
  '✏️': 'm15 3 6 6-12 12H3v-6z M12 6l6 6 M3 15l6 6',
  '📌': 'm14 2 8 8-5 1-4 4-1 4-7-7 4-1 4-4z M9 15l-7 7',
  '👍': 'M7 10v12H2V10z M7 10l5-8q3 0 2 5l-1 3h7q3 0 2 3l-2 7q0 2-3 2H7',
  '🧵': 'M6 3h12 M6 21h12 M8 3v18 M16 3v18 M8 7l8 4-8 4 8 4',
  '🐍': 'M12 2H8q-4 0-4 4v4h10v2H4q-2 0-2 4v2q0 4 4 4 M12 22h4q4 0 4-4v-4H10v-2h10q2 0 2-4V6q0-4-4-4 M9 5h.01 M15 19h.01',
  '🖨️': 'M6 8V2h12v6 M6 18H2V8h20v10h-4 M6 14h12v8H6z M18 11h.01',
  '🕒': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6h5',
  '⚠️': 'm12 2 11 20H1z M12 8v6 M12 18h.01',
  '🖱️': 'M12 2a6 6 0 0 0-6 6v8a6 6 0 0 0 12 0V8a6 6 0 0 0-6-6 M12 2v8 M6 10h12',
  '📝': 'M10 3H3v18h18v-7 M17 2l5 5-10 10H7v-5z M14 5l5 5',
  '👢': 'M6 2h9v12l7 4v4H2v-8h4z M2 18h20 M6 7h9',
  '🚫': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M5 5l14 14',
  '➕': 'M12 4v16 M4 12h16',
  '➖': 'M4 12h16',
  '🏷️': 'M2 2h9l11 11-9 9L2 11z M7 7h.01',
};

export const getIconPath = (name) => paths[name === '🔎' ? '🔍' : name] ||
  'M3 3h8v8H3z M13 13h8v8h-8z M13 3h8v8h-8z M3 13h8v8H3z';

export const createToolboxIcon = (name, documentRef = document) => {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '26', height: '26',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add('toolbox-svg-icon');
  const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', getIconPath(name));
  svg.appendChild(path);
  return svg;
};
