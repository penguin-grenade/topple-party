// Generates the Android launcher icon, Android TV banner, and web icons from SVG.
// Usage: node art/make-art.mjs   (needs the `sharp` package available)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require(process.env.SHARP_PATH); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.max(0, Math.min(255, Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f))));
  return '#' + [m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}
function cube(cx, cy, s, color, rot = 0, label = '') {
  const k = 0.866 * s;
  const top = `${cx},${cy - s} ${cx + k},${cy - s / 2} ${cx},${cy} ${cx - k},${cy - s / 2}`;
  const left = `${cx - k},${cy - s / 2} ${cx},${cy} ${cx},${cy + s} ${cx - k},${cy + s / 2}`;
  const right = `${cx},${cy} ${cx + k},${cy - s / 2} ${cx + k},${cy + s / 2} ${cx},${cy + s}`;
  const sw = Math.max(2, s * 0.06);
  const txt = label
    ? `<text x="${cx + k / 2}" y="${cy + s * 0.42}" font-family="DejaVu Sans" font-weight="bold" font-size="${s * 0.5}" fill="#fff" text-anchor="middle" transform="skewY(-30) translate(0 ${(cx + k / 2) * Math.tan(Math.PI / 6)})">${label}</text>`
    : '';
  return `<g transform="rotate(${rot} ${cx} ${cy})" stroke="#1d1433" stroke-width="${sw}" stroke-linejoin="round">
    <polygon points="${top}" fill="${shade(color, 0.35)}"/>
    <polygon points="${left}" fill="${color}"/>
    <polygon points="${right}" fill="${shade(color, -0.28)}"/>${txt}</g>`;
}
function ball(cx, cy, r) {
  return `<g><path d="M${cx - r * 3.4},${cy - r * 0.5} L${cx - r * 1.3},${cy - r * 0.35} M${cx - r * 3.0},${cy + r * 0.35} L${cx - r * 1.2},${cy + r * 0.3} M${cx - r * 2.4},${cy - r * 1.1} L${cx - r * 1.1},${cy - r * 0.85}" stroke="#ffffffaa" stroke-width="${r * 0.28}" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" stroke="#1d1433" stroke-width="${r * 0.14}"/>
  <circle cx="${cx - r * 0.3}" cy="${cy - r * 0.35}" r="${r * 0.28}" fill="#fff" opacity=".9"/>
  <path d="M${cx - r * 0.2},${cy + r * 0.95} A${r},${r} 0 0 0 ${cx + r * 0.95},${cy + r * 0.1}" stroke="#c9d3ff" stroke-width="${r * 0.22}" fill="none"/></g>`;
}
const defs = `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b3cc4"/><stop offset="1" stop-color="#ff7a59"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>`;

function iconSvg(size = 512) {
  const s = size / 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${defs}
  <rect x="0" y="0" width="512" height="512" rx="110" fill="url(#sky)"/>
  <rect x="0" y="0" width="512" height="512" rx="110" fill="url(#glow)"/>
  <ellipse cx="270" cy="440" rx="170" ry="26" fill="#2a1a55" opacity=".35"/>
  ${cube(215, 360, 72, '#3fa9f5')}
  ${cube(340, 360, 72, '#33c46a')}
  ${cube(275, 240, 72, '#ffc93c', 18, '')}
  ${cube(360, 140, 58, '#ff4d6d', 38)}
  ${ball(140, 170, 46)}
</svg>`;
}
function bannerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${defs}
  <rect width="640" height="360" fill="url(#sky)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <ellipse cx="505" cy="318" rx="115" ry="18" fill="#2a1a55" opacity=".35"/>
  ${cube(465, 262, 44, '#3fa9f5')}
  ${cube(542, 262, 44, '#33c46a')}
  ${cube(500, 186, 44, '#ffc93c', 16)}
  ${cube(560, 110, 36, '#ff4d6d', 36)}
  ${ball(468, 64, 22)}
  <g font-family="DejaVu Sans" font-weight="bold" text-anchor="start" stroke="#1d1433" stroke-width="10" paint-order="stroke" stroke-linejoin="round">
    <text x="36" y="168" font-size="80" fill="#ffffff">TOPPLE</text>
    <text x="40" y="262" font-size="80" fill="#ffd23f">PARTY</text>
  </g>
  <text x="44" y="310" font-family="DejaVu Sans" font-weight="bold" font-size="22" fill="#ffffffcc">phones are the controllers</text>
</svg>`;
}

const res = path.join(root, 'android/app/src/main/res');
const out = [];
const icon = Buffer.from(iconSvg());
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(dens)) {
  const f = path.join(res, `mipmap-${d}`, 'ic_launcher.png');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  await sharp(icon, { density: 72 * px / 512 * 4 }).resize(px, px).png().toFile(f);
  out.push(f);
}
const bf = path.join(res, 'drawable-xhdpi', 'banner.png');
await sharp(Buffer.from(bannerSvg()), { density: 72 }).resize(320, 180).png().toFile(bf);
out.push(bf);
const pub = path.join(root, 'public');
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, 'icon.svg'), iconSvg());
await sharp(icon).resize(192, 192).png().toFile(path.join(pub, 'icon-192.png'));
await sharp(icon).resize(512, 512).png().toFile(path.join(pub, 'icon-512.png'));
await sharp(Buffer.from(bannerSvg())).resize(1280, 720).png().toFile(path.join(root, 'art', 'banner-preview.png'));
console.log(out.join('\n'));
