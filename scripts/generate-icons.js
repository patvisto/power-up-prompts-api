// Generates extension icons: round green background + yellow lightning bolt
// Run from backend/: node scripts/generate-icons.js

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../../extension/icons');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Green background + yellow lightning bolt
const GREEN  = [22, 163, 74, 255];   // #16a34a
const YELLOW = [250, 204, 21, 255];  // #facc15
const CLEAR  = [0, 0, 0, 0];

// Lightning bolt polygon defined in a 0–100 unit space (centred)
const BOLT_POINTS = [
  [62, 8],
  [28, 52],
  [50, 52],
  [36, 92],
  [72, 46],
  [50, 46],
];

function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function generateIcon(size) {
  const png = new PNG({ width: size, height: size, filterType: -1 });
  const cx = size / 2;
  const cy = size / 2;
  const r  = size / 2;

  // Scale bolt polygon from 0-100 space to pixel space
  const bolt = BOLT_POINTS.map(([x, y]) => [
    (x / 100) * size,
    (y / 100) * size,
  ]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx  = x + 0.5 - cx;
      const dy  = y + 0.5 - cy;

      if (dx * dx + dy * dy <= r * r) {
        // Inside circle — green background
        png.data[idx]     = GREEN[0];
        png.data[idx + 1] = GREEN[1];
        png.data[idx + 2] = GREEN[2];
        png.data[idx + 3] = GREEN[3];

        // Lightning bolt on top
        if (pointInPolygon(x + 0.5, y + 0.5, bolt)) {
          png.data[idx]     = YELLOW[0];
          png.data[idx + 1] = YELLOW[1];
          png.data[idx + 2] = YELLOW[2];
          png.data[idx + 3] = YELLOW[3];
        }
      } else {
        // Outside circle — transparent
        png.data[idx]     = CLEAR[0];
        png.data[idx + 1] = CLEAR[1];
        png.data[idx + 2] = CLEAR[2];
        png.data[idx + 3] = CLEAR[3];
      }
    }
  }

  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log(`Created icon${size}.png`);
}

[16, 48, 128].forEach(generateIcon);
console.log('All icons created in extension/icons/');
