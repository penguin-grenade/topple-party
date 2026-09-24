// Transport layer. The TV hosts a room; phones connect to it.
//  - 'peer'  : WebRTC data channels, brokered by a PeerJS signaling server (default: the free public one).
//  - 'local' : BroadcastChannel between tabs of the same browser (for testing without phones).

import { PEER_PREFIX, randomCode } from './protocol';

export interface Link {
  readonly id: string;
  send(msg: unknown): void;
  close(): void;
  onMessage: (msg: any) => void;
  onClose: () => void;
}

export interface PeerServerConfig {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  key?: string;
}

export type TransportKind = 'peer' | 'local';

export interface NetConfig {
  transport: TransportKind;
  server: PeerServerConfig;
}

/** Reads transport settings from the page URL (?local, ?peerHost=..&peerPort=..&peerPath=..&peerSecure=0|1&peerKey=..). */
export function netConfigFromUrl(url = new URL(location.href)): NetConfig {
  const q = url.searchParams;
  const server: PeerServerConfig = {};
  if (q.get('peerHost')) server.host = q.get('peerHost')!;
  if (q.get('peerPort')) server.port = Number(q.get('peerPort'));
  if (q.get('peerPath')) server.path = q.get('peerPath')!;
  if (q.get('peerSecure')) server.secure = q.get('peerSecure') !== '0';
  if (q.get('peerKey')) server.key = q.get('peerKey')!;
  return { transport: q.has('local') ? 'local' : 'peer', server };
}

/** Query string that carries the same transport settings over to the phone's page. */
export function netConfigToQuery(cfg: NetConfig): string {
  const q = new URLSearchParams();
  if (cfg.transport === 'local') q.set('local', '1');
  const s = cfg.server;
  if (s.host) q.set('peerHost', s.host);
  if (s.port) q.set('peerPort', String(s.port));
  if (s.path) q.set('peerPath', s.path);
  if (s.secure !== undefined) q.set('peerSecure', s.secure ? '1' : '0');
  if (s.key) q.set('peerKey', s.key);
  const str = q.toString();
  return str ? '?' + str : '';
}

function peerOptions(s: PeerServerConfig): Record<string, unknown> {
  const o: Record<string, unknown> = { debug: 1 };
  if (s.host) o.host = s.host;
  if (s.port) o.port = s.port;
  if (s.path) o.path = s.path;
  if (s.secure !== undefined) o.secure = s.secure;
  if (s.key) o.key = s.key;
  return o;
}

type HostStatus = 'connecting' | 'ready' | 'reconnecting' | 'error';

export class NetHost {
  code = '';
  onLink: (link: Link) => void = () => {};
  onStatus: (s: HostStatus, detail?: string) => void = () => {};
  private destroyFn: (() => void) | null = null;

  constructor(private cfg: NetConfig) {}

  async start(preferred?: string): Promise<string> {
    return this.cfg.transport === 'local' ? this.startLocal(preferred) : this.startPeer(preferred);
  }

  destroy() {
    this.destroyFn?.();
  }

  // ---------- PeerJS ----------
  private async startPeer(preferred?: string, attempt = 0): Promise<string> {
    const { Peer } = await import('peerjs');
    const code = preferred || randomCode();
    this.onStatus('connecting');
    return new Promise<string>((resolve, reject) => {
      const peer: any = new Peer(PEER_PREFIX + code, peerOptions(this.cfg.server) as any);
      let opened = false;
      let retryTimer = 0;
      this.destroyFn = () => {
        clearTimeout(retryTimer);
        peer.destroy();
      };
      peer.on('open', () => {
        opened = true;
        this.code = code;
        this.onStatus('ready');
        resolve(code);
      });
      peer.on('connection', (conn: any) => {
        const link = wrapPeerConn(conn);
        conn.on('open', () => this.onLink(link));
      });
      peer.on('disconnected', () => {
        // Lost the signaling server (existing phone connections keep working). Try to get back.
        if (peer.destroyed) return;
        this.onStatus('reconnecting');
        clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (!peer.destroyed) peer.reconnect();
        }, 2000);
      });
      peer.on('error', (err: any) => {
        const type = err?.type ?? 'error';
        if (type === 'unavailable-id' && !opened) {
          // someone else has this code: pick a fresh one
          peer.destroy();
          this.startPeer(undefined, attempt + 1).then(resolve, reject);
          return;
        }
        if (type === 'peer-unavailable') return; // a phone went away mid-handshake
        if (!opened) {
          this.onStatus('error', type);
          peer.destroy();
          // retry forever with backoff; the TV may just be offline for a moment
          retryTimer = window.setTimeout(() => this.startPeer(code, attempt + 1).then(resolve, reject), Math.min(15000, 2000 * (attempt + 1)));
        } else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
          this.onStatus('reconnecting', type);
        }
      });
    });
  }

  // ---------- BroadcastChannel (local testing) ----------
  private async startLocal(preferred?: string): Promise<string> {
    const code = preferred || randomCode();
    const bc = new BroadcastChannel('topple-local-' + code);
    const links = new Map<string, { link: Link; last: number }>();
    bc.onmessage = (ev) => {
      const d = ev.data;
      if (!d || d.dir !== 'c2s') return;
      if (d.k === 'join') {
        if (links.has(d.cid)) return;
        const link: Link = {
          id: d.cid,
          send: (m) => bc.postMessage({ dir: 's2c', k: 'm', cid: d.cid, m }),
          close: () => {
            bc.postMessage({ dir: 's2c', k: 'bye', cid: d.cid });
            drop(d.cid);
          },
          onMessage: () => {},
          onClose: () => {},
        };
        links.set(d.cid, { link, last: performance.now() });
        bc.postMessage({ dir: 's2c', k: 'accept', cid: d.cid });
        this.onLink(link);
      } else {
        const e = links.get(d.cid);
        if (!e) return;
        e.last = performance.now();
        if (d.k === 'm') e.link.onMessage(d.m);
        else if (d.k === 'bye') drop(d.cid);
      }
    };
    const drop = (cid: string) => {
      const e = links.get(cid);
      if (!e) return;
      links.delete(cid);
      e.link.onClose();
    };
    const iv = window.setInterval(() => {
      const now = performance.now();
      for (const [cid, e] of links) if (now - e.last > 5000) drop(cid);
    }, 1000);
    this.destroyFn = () => {
      clearInterval(iv);
      bc.close();
    };
    this.code = code;
    this.onStatus('ready');
    return code;
  }
}

function wrapPeerConn(conn: any): Link {
  let closed = false;
  const link: Link = {
    id: conn.peer + ':' + conn.connectionId,
    send: (m) => {
      if (!closed && conn.open) {
        try {
          conn.send(m);
        } catch {
          /* channel closing */
        }
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      link.onClose();
    },
    onMessage: () => {},
    onClose: () => {},
  };
  conn.on('data', (d: unknown) => link.onMessage(d));
  const fin = () => {
    if (closed) return;
    closed = true;
    link.onClose();
  };
  conn.on('close', fin);
  conn.on('error', fin);
  return link;
}

/** Phone side: connect to the TV's room. Rejects with a readable message on failure. */
export async function connectToRoom(code: string, cfg: NetConfig, timeoutMs = 15000): Promise<Link> {
  code = code.toUpperCase();
  if (cfg.transport === 'local') return connectLocal(code, timeoutMs);
  const { Peer } = await import('peerjs');
  return new Promise<Link>((resolve, reject) => {
    const peer: any = new Peer(peerOptions(cfg.server) as any);
    let done = false;
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = window.setTimeout(() => fail('Timed out reaching the TV. Is it on the same Wi-Fi and showing the join screen?'), timeoutMs);
    peer.on('error', (err: any) => {
      const type = err?.type;
      if (type === 'peer-unavailable') fail(`No game found with code ${code}. Check the code on the TV.`);
      else if (!done) fail(`Connection problem (${type || 'unknown'}). Try again.`);
    });
    peer.on('open', () => {
      const conn: any = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const link = wrapPeerConn(conn);
        const origClose = link.close;
        link.close = () => {
          origClose();
          peer.destroy();
        };
        conn.on('close', () => peer.destroy());
        resolve(link);
      });
    });
  });
}

function connectLocal(code: string, timeoutMs: number): Promise<Link> {
  return new Promise<Link>((resolve, reject) => {
    const bc = new BroadcastChannel('topple-local-' + code);
    const cid = Math.random().toString(36).slice(2);
    let accepted = false;
    let hb = 0;
    const link: Link = {
      id: cid,
      send: (m) => bc.postMessage({ dir: 'c2s', k: 'm', cid, m }),
      close: () => {
        bc.postMessage({ dir: 'c2s', k: 'bye', cid });
        shutdown();
      },
      onMessage: () => {},
      onClose: () => {},
    };
    const shutdown = () => {
      clearInterval(hb);
      bc.close();
    };
    bc.onmessage = (ev) => {
      const d = ev.data;
      if (!d || d.dir !== 's2c' || d.cid !== cid) return;
      if (d.k === 'accept' && !accepted) {
        accepted = true;
        clearTimeout(timer);
        hb = window.setInterval(() => bc.postMessage({ dir: 'c2s', k: 'hb', cid }), 1000);
        resolve(link);
      } else if (d.k === 'm') link.onMessage(d.m);
      else if (d.k === 'bye') {
        shutdown();
        link.onClose();
      }
    };
    const timer = window.setTimeout(() => {
      shutdown();
      reject(new Error(`No local game with code ${code}.`));
    }, timeoutMs);
    bc.postMessage({ dir: 'c2s', k: 'join', cid });
  });
}
