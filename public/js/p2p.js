// Прямое соединение «учитель — ученик» без сервера в интернете (WebRTC, обмен кодами).
// Этот файл — общая часть для страниц: коды приглашения, связь со страницей-мостом
// (p2p-bridge.html, в приложении это скрытое окно) и «сокет» ученика поверх прямого канала.
(() => {
  'use strict';

  const PREFIX = 'D1.';
  const REMOTE_KEY = 'wb:p2p:remote';

  // ---------- коды приглашения: JSON → сжатие → base64url ----------
  async function pipe(bytes, stream) {
    const w = stream.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    return PREFIX + toB64(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  // Возвращает объект или null, если это не код доски
  async function decode(code) {
    try {
      const m = String(code || '').replace(/\s+/g, '').match(/D1\.([A-Za-z0-9_-]{20,})/);
      if (!m) return null;
      const raw = await pipe(fromB64(m[1]), new DecompressionStream('deflate-raw'));
      const obj = JSON.parse(new TextDecoder().decode(raw));
      return obj && typeof obj === 'object' && typeof obj.s === 'string' && typeof obj.n === 'string' ? obj : null;
    } catch {
      return null;
    }
  }

  // ---------- связь со страницей-мостом ----------
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('wb-p2p') : null;
  const waiting = new Map(); // rid -> resolve
  const listeners = new Set();
  const socks = new Map(); // c -> Socket
  let seq = 0;
  const rnd = () => Math.random().toString(36).slice(2, 10);

  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== 'ui') return;
      if (m.rid) {
        const f = waiting.get(m.rid);
        if (f) {
          waiting.delete(m.rid);
          f(m);
        }
        return;
      }
      if (m.ev === 'sock') {
        const s = socks.get(m.c);
        if (s) s._in(m);
        return;
      }
      for (const fn of listeners) fn(m);
    };
  }

  // Запрос к мосту. Если мост не ответил за timeout — { error: 'nobridge' }
  function call(op, data = {}, timeout = 15000) {
    return new Promise((resolve) => {
      if (!bc) return resolve({ error: 'nobridge' });
      const rid = rnd() + ++seq;
      const timer = setTimeout(() => {
        waiting.delete(rid);
        resolve({ error: 'nobridge' });
      }, timeout);
      waiting.set(rid, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      bc.postMessage({ ...data, to: 'bridge', op, rid });
    });
  }

  const status = () => call('status', {}, 700);

  // ---------- какие доски открыты «у учителя» ----------
  function remoteList() {
    try {
      const l = JSON.parse(localStorage.getItem(REMOTE_KEY) || '[]');
      return Array.isArray(l) ? l : [];
    } catch {
      return [];
    }
  }
  const isRemote = (id) => remoteList().includes(id);
  function markRemote(id) {
    try {
      const l = remoteList().filter((x) => x !== id);
      l.unshift(id);
      localStorage.setItem(REMOTE_KEY, JSON.stringify(l.slice(0, 200)));
    } catch {
      /* без памяти — не страшно */
    }
  }

  // ---------- «сокет» ученика: тот же интерфейс, что у WebSocket ----------
  class Socket {
    constructor(board, cid) {
      this.readyState = 0;
      this.c = rnd();
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      socks.set(this.c, this);
      if (!bc) return void setTimeout(() => this._end(), 0);
      bc.postMessage({ to: 'bridge', op: 'sock-open', c: this.c, board, cid });
      // мост не запущен или нет связи с учителем — считаем соединение неудавшимся
      this._timer = setTimeout(() => this._end(), 6000);
    }
    _in(m) {
      if (m.op === 'open') {
        clearTimeout(this._timer);
        this.readyState = 1;
        if (this.onopen) this.onopen({});
      } else if (m.op === 'msg') {
        if (this.readyState === 1 && this.onmessage) this.onmessage({ data: m.d });
      } else if (m.op === 'close') this._end();
    }
    _end() {
      if (this.readyState === 3) return;
      clearTimeout(this._timer);
      this.readyState = 3;
      socks.delete(this.c);
      if (this.onclose) this.onclose({});
    }
    send(d) {
      if (this.readyState === 1) bc.postMessage({ to: 'bridge', op: 'sock-send', c: this.c, d });
    }
    close() {
      if (this.readyState === 3) return;
      if (bc) bc.postMessage({ to: 'bridge', op: 'sock-close', c: this.c });
      this._end();
    }
  }
  window.addEventListener('pagehide', () => {
    for (const s of [...socks.values()]) s.close();
  });

  window.P2P = {
    encode,
    decode,
    call,
    status,
    on: (fn) => listeners.add(fn),
    isRemote,
    markRemote,
    Socket,
    _bus: bc,
  };
})();
