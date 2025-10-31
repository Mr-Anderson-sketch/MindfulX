const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'icons');
const SIZES = [16, 48, 128];

const palette = {
  cream: '#F4EDE4',
  clay: '#D9C7B8',
  sage: '#A8C0A5',
  terracotta: '#D46C63'
};

(async () => {
  await ensureDir(OUTPUT_DIR);

  for (const size of SIZES) {
    const png = new PNG({ width: size, height: size });
    const center = (size - 1) / 2;
    const radiusOuter = size * 0.42;
    const radiusInner = size * 0.24;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (size * y + x) << 2;
        const dx = x - center;
        const dy = y - center;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let color = palette.cream;
        if (dist <= radiusOuter) {
          color = palette.clay;
        }
        if (dist <= radiusInner) {
          color = palette.sage;
        }
        if (x > y + size * 0.15) {
          color = blend(color, palette.terracotta, 0.12);
        }

        const [r, g, b] = hexToRgb(color);
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }

    await writePng(path.join(OUTPUT_DIR, `icon${size}.png`), png);
    console.log(`Generated icon${size}.png`);
  }
})().catch((error) => {
  console.error('Failed to generate icons', error);
  process.exitCode = 1;
});

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized, 16);
  return [
    (bigint >> 16) & 255,
    (bigint >> 8) & 255,
    bigint & 255
  ];
}

function blend(baseHex, overlayHex, amount) {
  const base = hexToRgb(baseHex);
  const overlay = hexToRgb(overlayHex);
  return base.map((channel, index) => {
    return Math.round(channel * (1 - amount) + overlay[index] * amount);
  }).reduce((hex, channel) => hex + channel.toString(16).padStart(2, '0'), '#');
}

function ensureDir(dir) {
  return fs.promises.mkdir(dir, { recursive: true });
}

function writePng(file, png) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(file);
    stream.on('finish', resolve);
    stream.on('error', reject);
    png.pack().pipe(stream);
  });
}