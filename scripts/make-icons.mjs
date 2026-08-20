/**
 * Renders the app icon to PNG.
 *
 * iOS ignores SVG for a home-screen icon: without a PNG it takes a screenshot
 * of the page instead, which for this app would be a blank capture screen. So
 * the icon is rasterised here rather than shipped only as vector.
 *
 * Written against node:zlib and nothing else. A one-off icon is not worth a
 * build dependency, and the alternative — asking someone to open a design tool
 * every time the brand colour moves — is worse.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [0x81, 0x97, 0x7d];   // the app's primary, hsl(110 11% 54%)
const FG = [0xfd, 0xfc, 0xf7];   // the app's background, near-white

/** Supersampling factor. Curves without it look like staircases at icon sizes. */
const SS = 4;

function inRoundedRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Distance from a point to a circle's edge, for drawing an arc as a stroke. */
function onRing(x, y, cx, cy, radius, width) {
  const d = Math.hypot(x - cx, y - cy);
  return Math.abs(d - radius) <= width / 2;
}

function render(size) {
  const S = size * SS;
  const px = new Uint8Array(S * S * 4);

  // Geometry as fractions of the canvas, so every size renders identically.
  const mic = { x: 0.42 * S, y: 0.23 * S, w: 0.16 * S, h: 0.30 * S };
  const arc = { cx: 0.5 * S, cy: 0.47 * S, r: 0.165 * S, w: 0.048 * S };
  const stem = { x: 0.476 * S, y: 0.635 * S, w: 0.048 * S, h: 0.085 * S };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;

      if (!inRoundedRect(x, y, S, S, 0.22 * S)) {
        px[i + 3] = 0;                       // outside the squircle: transparent
        continue;
      }

      let c = BG;

      // Capsule body.
      if (inRoundedRect(x - mic.x, y - mic.y, mic.w, mic.h, mic.w / 2)) c = FG;

      // The U beneath it — lower half of a ring only.
      if (y > arc.cy && onRing(x, y, arc.cx, arc.cy, arc.r, arc.w)) c = FG;

      // Stand.
      if (x >= stem.x && x <= stem.x + stem.w && y >= stem.y && y <= stem.y + stem.h) c = FG;

      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }

  // Average each SS×SS block back down to one pixel.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

// ── Minimal PNG writer ─────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per scanline; 0 means "no filter", which compresses fine
  // for flat colour and keeps this readable.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  const file = `artifacts/one-for-all/public/icon-${size}.png`;
  writeFileSync(file, png(render(size), size));
  console.log("wrote", file);
}
