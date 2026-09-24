import * as THREE from 'three';
import type { BlockType } from '../sim/blocks';

const S = 256;
const FONT = "'Fredoka', 'Arial Rounded MT Bold', 'Helvetica Neue', Arial, sans-serif";

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d')!];
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function border(g: CanvasRenderingContext2D, color: string, w = 14) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.strokeRect(w / 2, w / 2, S - w, S - w);
}

function grain(g: CanvasRenderingContext2D, base: string, dark: string, seed: number, lines = 14) {
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = rng(seed);
  g.globalAlpha = 0.35;
  g.strokeStyle = dark;
  for (let i = 0; i < lines; i++) {
    g.lineWidth = 1.5 + r() * 3;
    const y0 = (i + r() * 0.8) * (S / lines);
    g.beginPath();
    for (let x = -10; x <= S + 10; x += 16) {
      const y = y0 + Math.sin(x / 40 + i * 1.7) * 3 + Math.sin(x / 13 + i) * 1.2;
      if (x === -10) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // a knot or two
  g.globalAlpha = 0.3;
  for (let k = 0; k < 2; k++) {
    const x = 40 + r() * 170, y = 40 + r() * 170;
    g.beginPath();
    g.ellipse(x, y, 10 + r() * 8, 5 + r() * 4, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function number(g: CanvasRenderingContext2D, text: string, fill: string, stroke: string, size = 120) {
  g.font = `700 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = stroke;
  g.strokeText(text, S / 2, S / 2 + 8);
  g.fillStyle = fill;
  g.fillText(text, S / 2, S / 2 + 8);
}

function vgrad(g: CanvasRenderingContext2D, a: string, b: string) {
  const gr = g.createLinearGradient(0, 0, S, S);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
}

function draw(type: BlockType): HTMLCanvasElement {
  const [c, g] = canvas();
  switch (type) {
    case 'wood':
    case 'plank':
      grain(g, '#e9a95c', '#9b5f22', type === 'wood' ? 7 : 11);
      border(g, '#b97632', 12);
      break;
    case 'jenga':
      grain(g, '#f4d29b', '#b98a4a', 3, 20);
      border(g, '#d9ad6c', 8);
      break;
    case 'stone': {
      g.fillStyle = '#a6afbb';
      g.fillRect(0, 0, S, S);
      const r = rng(5);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r() < 0.5 ? '#8f98a4' : '#bcc4ce';
        g.globalAlpha = 0.6;
        g.beginPath();
        g.arc(r() * S, r() * S, 2 + r() * 7, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      border(g, '#7c8591', 14);
      break;
    }
    case 'silver':
      vgrad(g, '#f4f8fc', '#9eabbb');
      border(g, '#7d8a9a', 14);
      number(g, '5', '#ffffff', '#5c6a7b', 150);
      break;
    case 'gold':
      vgrad(g, '#fff08a', '#e89a00');
      border(g, '#b87400', 14);
      number(g, '10', '#fff7d6', '#9a5c00', 130);
      break;
    case 'gem': {
      vgrad(g, '#7ff3ff', '#1b7cff');
      border(g, '#1256c4', 14);
      g.fillStyle = '#ffffffdd';
      g.beginPath();
      g.moveTo(128, 40);
      g.lineTo(200, 100);
      g.lineTo(128, 200);
      g.lineTo(56, 100);
      g.closePath();
      g.fill();
      g.strokeStyle = '#1b7cffaa';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(56, 100);
      g.lineTo(200, 100);
      g.moveTo(100, 100);
      g.lineTo(128, 200);
      g.lineTo(156, 100);
      g.stroke();
      g.font = `700 44px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.fillText('25', 128, 236);
      break;
    }
    case 'skull': {
      vgrad(g, '#6c3aa0', '#2c1250');
      border(g, '#1b0934', 14);
      g.fillStyle = '#f4ecff';
      g.beginPath();
      g.arc(128, 110, 60, 0, Math.PI * 2);
      g.fill();
      g.fillRect(92, 140, 72, 44);
      g.fillStyle = '#2c1250';
      g.beginPath();
      g.arc(104, 110, 18, 0, Math.PI * 2);
      g.arc(152, 110, 18, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(118, 146);
      g.lineTo(138, 146);
      g.fill();
      for (let i = 0; i < 4; i++) g.fillRect(100 + i * 17, 168, 6, 16);
      g.font = `700 36px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#ff8fa3';
      g.fillText('-10', 128, 228);
      break;
    }
    case 'bomb': {
      g.fillStyle = '#ff4747';
      g.fillRect(0, 0, S, S);
      // hazard stripes border
      g.save();
      g.beginPath();
      g.rect(0, 0, S, S);
      g.rect(26, 26, S - 52, S - 52);
      g.clip('evenodd');
      g.fillStyle = '#ffd23f';
      g.fillRect(0, 0, S, S);
      g.fillStyle = '#1a1a1a';
      for (let i = -S; i < S * 2; i += 36) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 18, 0);
        g.lineTo(i + 18 - S, S);
        g.lineTo(i - S, S);
        g.fill();
      }
      g.restore();
      g.fillStyle = '#1a1a1a';
      g.beginPath();
      g.arc(120, 140, 56, 0, Math.PI * 2);
      g.fill();
      g.fillRect(140, 70, 30, 26);
      g.strokeStyle = '#8a5a2b';
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(155, 72);
      g.quadraticCurveTo(170, 44, 196, 50);
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(198, 48, 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff55';
      g.beginPath();
      g.arc(100, 120, 16, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'chem': {
      vgrad(g, '#b6ff6a', '#3cc43c');
      border(g, '#258a25', 14);
      const r = rng(9);
      g.fillStyle = '#ffffffaa';
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.arc(50 + r() * 156, 50 + r() * 156, 8 + r() * 20, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#1d5e1d';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(128, 128, 30, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
        g.beginPath();
        g.arc(128 + Math.cos(a) * 50, 128 + Math.sin(a) * 50, 22, 0, Math.PI * 2);
        g.stroke();
      }
      break;
    }
    case 'ice': {
      vgrad(g, '#f4feff', '#9fe3ff');
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.globalAlpha = 0.8;
      g.beginPath();
      g.moveTo(30, 60);
      g.lineTo(110, 110);
      g.lineTo(90, 190);
      g.moveTo(110, 110);
      g.lineTo(210, 90);
      g.moveTo(150, 180);
      g.lineTo(220, 220);
      g.stroke();
      g.globalAlpha = 1;
      border(g, '#6fcfff', 10);
      break;
    }
    case 'ghost': {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, S, S);
      g.setLineDash([22, 14]);
      border(g, '#a78bfa', 12);
      g.setLineDash([]);
      g.fillStyle = '#7c5cd6';
      g.beginPath();
      g.arc(100, 118, 14, 0, Math.PI * 2);
      g.arc(156, 118, 14, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(128, 160, 16, 20, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'crown': {
      vgrad(g, '#fff08a', '#f0a800');
      border(g, '#b87400', 14);
      g.fillStyle = '#fffbe6';
      g.beginPath();
      g.moveTo(52, 180);
      g.lineTo(52, 90);
      g.lineTo(90, 130);
      g.lineTo(128, 70);
      g.lineTo(166, 130);
      g.lineTo(204, 90);
      g.lineTo(204, 180);
      g.closePath();
      g.fill();
      g.fillStyle = '#ff4d6d';
      g.beginPath();
      g.arc(128, 150, 14, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }
  return c;
}

const cache = new Map<BlockType, THREE.Material>();

export function blockMaterial(type: BlockType, maxAniso = 4): THREE.Material {
  const hit = cache.get(type);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(draw(type));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  let m: THREE.MeshStandardMaterial;
  switch (type) {
    case 'silver':
      m = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.32 });
      break;
    case 'gold':
    case 'crown':
      m = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.3, emissive: new THREE.Color('#ffae00'), emissiveIntensity: 0.12 });
      break;
    case 'gem':
      m = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.1, roughness: 0.12, emissive: new THREE.Color('#16c8ff'), emissiveIntensity: 0.35 });
      break;
    case 'ice':
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.78 });
      break;
    case 'ghost':
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: true, opacity: 0.42, depthWrite: false });
      break;
    case 'chem':
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: new THREE.Color('#5cff3a'), emissiveIntensity: 0.22 });
      break;
    case 'bomb':
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      break;
    case 'stone':
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 });
  }
  cache.set(type, m);
  return m;
}

/** Round dot texture for sprites/particles. */
export function dotTexture(): THREE.Texture {
  const [c, g] = canvas();
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#ffffffff');
  gr.addColorStop(0.5, '#ffffffaa');
  gr.addColorStop(1, '#ffffff00');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
