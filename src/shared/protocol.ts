// Messages exchanged between the TV (host) and phones (pads).

export const PROTOCOL_VERSION = 1;
/** Prefix for the TV's PeerJS id on the public signaling server, so room codes don't collide with other apps. */
export const PEER_PREFIX = 'topple-party-v1-';
export const MAX_PLAYERS = 8;

export type ModeId = 'blast' | 'best' | 'pull';

export interface ModeInfo {
  id: ModeId;
  name: string;
  tagline: string;
  turns: boolean;
  roundsLabel: string;
}

export const MODES: ModeInfo[] = [
  { id: 'blast', name: 'Blast Party', tagline: 'Everyone throws at once. Knock blocks off the stands to score!', turns: false, roundsLabel: 'levels' },
  { id: 'best', name: 'Best Shot', tagline: 'Take turns. 3 balls each on the same level — biggest topple wins.', turns: true, roundsLabel: 'rounds' },
  { id: 'pull', name: 'Tower Pull', tagline: "Take turns pulling pieces out of the tower. Don't drop the crown!", turns: true, roundsLabel: 'towers' },
];

export type ControlKind = 'throw' | 'grab' | 'none';

/** Everything a phone needs to render its screen. The TV sends a fresh one whenever it changes. */
export interface PadView {
  screen: 'lobby' | 'play' | 'wait' | 'results' | 'paused';
  title: string;
  sub?: string;
  control: ControlKind;
  /** balls left this turn; null = unlimited */
  ammo?: number | null;
  host: boolean;
  mode: ModeId;
  rounds: number;
  score: number;
  rank?: number;
  /** seconds until next throw allowed (cooldown hint) */
  cooldown?: number;
  /** show the camera pad (Tower Pull: move the view around the tower) */
  camera?: boolean;
  /** Tower Pull lobby: the first tower (1-based), its name, and how many towers there are */
  tower?: number;
  towerName?: string;
  towerCount?: number;
  /** how many of the towers were imported from tower files at runtime */
  towersImported?: number;
}

export type HostAction =
  | { a: 'mode'; mode: ModeId }
  | { a: 'rounds'; n: number }
  /** Tower Pull: first tower, 1-based */
  | { a: 'tower'; n: number }
  /** Tower Pull: add a tower from a tower file (JSON text) / forget every imported tower */
  | { a: 'tower-json'; json: string }
  | { a: 'tower-clear' }
  | { a: 'start' }
  | { a: 'again' }
  | { a: 'lobby' }
  | { a: 'pause' }
  | { a: 'resume' };

/** Phone -> TV */
export type C2S =
  | { t: 'hello'; v: number; name: string; token: string }
  | { t: 'aim'; x: number; y: number }
  | { t: 'throw'; x: number; y: number; p: number }
  | { t: 'grab'; x: number; y: number }
  | { t: 'pull'; d: number; s: number }
  | { t: 'release' }
  /** camera deltas: dx = turn (radians), dy = raise/lower (world units), dz = zoom change */
  | { t: 'cam'; dx: number; dy: number; dz: number }
  | ({ t: 'host' } & HostAction)
  | { t: 'name'; name: string }
  | { t: 'ping'; ts: number };

/** TV -> Phone */
export type S2C =
  | { t: 'welcome'; id: number; color: string; colorName: string; name: string }
  | { t: 'view'; v: PadView }
  | { t: 'buzz'; ms: number | number[] }
  | { t: 'pong'; ts: number }
  /** a short message to show the player (e.g. why an import failed) */
  | { t: 'note'; text: string }
  | { t: 'full' }
  | { t: 'bye'; reason: string };

export const PLAYER_COLORS: { hex: string; name: string }[] = [
  { hex: '#ff4d6d', name: 'Red' },
  { hex: '#3fa9f5', name: 'Blue' },
  { hex: '#ffc93c', name: 'Yellow' },
  { hex: '#33c46a', name: 'Green' },
  { hex: '#a66cff', name: 'Purple' },
  { hex: '#ff8a3d', name: 'Orange' },
  { hex: '#ff6ac1', name: 'Pink' },
  { hex: '#2fd6d0', name: 'Teal' },
];

export function randomCode(len = 4): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let s = '';
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export function cleanName(n: string): string {
  return (n || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Player';
}
