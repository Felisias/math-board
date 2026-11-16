// Онлайн-доска для уроков математики.
// Сервер: раздаёт страницы, синхронизирует доски через WebSocket,
// передаёт служебные сообщения для голосовой связи (WebRTC) и чат.
// Работает и на хостинге (Render), и на своём компьютере (node server.js или десктоп-приложение).
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createTunnel } = require('./tunnel');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_MESSAGE = 6 * 1024 * 1024; // одно сообщение (картинка) до 6 МБ
const MAX_BOARD = 60 * 1024 * 1024; // вся доска до ~60 МБ

// Серверы для голосовой связи. По умолчанию только STUN.
// Свой TURN можно задать переменной окружения ICE_SERVERS (JSON-массив), например:
// [{"urls":"turn:turn.example.com:443?transport=tcp","username":"u","credential":"p"}]
const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
let ICE_SERVERS = DEFAULT_ICE;
if (process.env.ICE_SERVERS) {
  try {
    const extra = JSON.parse(process.env.ICE_SERVERS);
    if (Array.isArray(extra)) ICE_SERVERS = [...extra, ...DEFAULT_ICE];
  } catch (e) {
    console.error('ICE_SERVERS: неверный JSON', e.message);
  }
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomId(len = 10) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
const BOARD_ID_RE = /^[a-z0-9]{6,20}$/;
const CLIENT_ID_RE = /^[a-z0-9]{6,20}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const BACKGROUNDS = new Set(['blank', 'grid', 'dots', 'lines', 'coord']);
const OBJECT_TYPES = new Set(['stroke', 'shape', 'text', 'math', 'graph', 'image', 'plot', 'point', 'curve']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

function start(opts = {}) {
  const WANT_PORT = Number(opts.port ?? process.env.PORT ?? 3000);
  const DATA_DIR = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  // На хостинге панель «запуск со своего компьютера» выключена
  const HOSTED = !!process.env.RENDER || process.env.HOST_PANEL === 'off';
  const HOST_TOKEN = randomId(24);
  let PORT = WANT_PORT;
  let tunnel = null;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ---------- статические файлы ----------
  function sendFile(res, file, cacheSeconds) {
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Не найдено');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    });
  }

  function serveStatic(req, res, urlPath) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      rel = '/';
    }
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const cache = rel.startsWith('/vendor/') ? 60 * 60 * 24 * 7 : 0;
    sendFile(res, file, cache);
  }

  function json(res, data, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let s = '';
      req.on('data', (d) => {
        s += d;
        if (s.length > 10000) req.destroy();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(s || '{}'));
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  // Запрос пришёл с этого же компьютера, напрямую (не через туннель и не с чужого сайта)?
  function isLocalReq(req) {
    if (HOSTED) return false;
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) return false;
    const h = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(h)) return false;
    for (const k of ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip']) {
      if (req.headers[k]) return false;
    }
    return true;
  }

  function lanUrls() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${PORT}`);
      }
    }
    return out;
  }

  const listCache = new Map();
  function listBoards() {
    const out = [];
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = f.match(/^([a-z0-9]{6,20})\.json$/);
      if (!m) continue;
      const file = path.join(DATA_DIR, f);
      try {
        const st = fs.statSync(file);
        let c = listCache.get(m[1]);
        if (!c || c.mtime !== st.mtimeMs) {
          const d = JSON.parse(fs.readFileSync(file, 'utf8'));
          const pages = Array.isArray(d.pages) ? d.pages : [];
          c = { mtime: st.mtimeMs, title: d.title || '', pages: pages.length, empty: !pages.some((p) => p.objects && p.objects.length) };
          listCache.set(m[1], c);
        }
        if (c.empty && !c.title) continue;
        out.push({ id: m[1], title: c.title, at: Math.round(st.mtimeMs), pages: c.pages });
      } catch {
        /* битый файл пропускаем */
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'POST' && p === '/api/boards') {
      const id = randomId(10);
      getBoard(id); // создаём сразу, чтобы ссылка работала
      return json(res, { id });
    }
    if (p === '/api/host/tunnel' && req.method === 'POST') {
      if (!isLocalReq(req) || req.headers['x-host-token'] !== HOST_TOKEN) return json(res, { error: 'forbidden' }, 403);
      const body = await readBody(req);
      if (body.action === 'stop') tunnel.stop();
      else tunnel.start(body.provider === 'lhr' ? 'lhr' : 'cloudflare'); // не ждём: состояние читается через /api/host
      return json(res, { tunnel: tunnel.status() });
    }
    const del = p.match(/^\/api\/boards\/([a-z0-9]{6,20})$/);
    if (del && req.method === 'DELETE') {
      if (!isLocalReq(req) || req.headers['x-host-token'] !== HOST_TOKEN) return json(res, { error: 'forbidden' }, 403);
      const b = boards.get(del[1]);
      if (b && b.clients.size) return json(res, { error: 'busy' }, 409);
      if (b) {
        clearTimeout(b.saveTimer);
        clearTimeout(b.evictTimer);
        boards.delete(del[1]);
      }
      fs.rmSync(boardFile(del[1]), { force: true });
      return json(res, { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    if (p === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (p === '/api/ice') return json(res, { iceServers: ICE_SERVERS });
    if (p === '/api/host') {
      if (!isLocalReq(req)) return json(res, { local: false });
      return json(res, { local: true, desktop: !!opts.desktop, port: PORT, lan: lanUrls(), tunnel: tunnel.status(), token: HOST_TOKEN });
    }
    if (p === '/api/boards') {
      if (!isLocalReq(req)) return json(res, { local: false, boards: [] });
      return json(res, { local: true, boards: listBoards(), token: HOST_TOKEN });
    }
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), 0);
    const m = p.match(/^\/b\/([^/]+)\/?$/);
    if (m) {
      if (!BOARD_ID_RE.test(m[1])) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Неверная ссылка на доску');
      }
      return sendFile(res, path.join(PUBLIC_DIR, 'board.html'), 0);
    }
    return serveStatic(req, res, p);
  });

  // ---------- хранение досок ----------
  // Board: { id, title, notebooks: [{ id, title }], pages: [{ id, nb, bg, objects: [] }], created }
  const boards = new Map(); // id -> { data, clients:Set, fresh, saveTimer, evictTimer, chat }

  function newPage(nb, bg = 'grid') {
    return { id: randomId(8), nb, bg, objects: [] };
  }

  // Приводим доску к текущему формату (у старых досок не было блокнотов)
  function normalize(data) {
    if (!Array.isArray(data.pages)) data.pages = [];
    if (!Array.isArray(data.notebooks) || !data.notebooks.length) {
      data.notebooks = [{ id: randomId(8), title: 'Блокнот 1' }];
    }
    const ids = new Set(data.notebooks.map((n) => n.id));
    for (const pg of data.pages) if (!ids.has(pg.nb)) pg.nb = data.notebooks[0].id;
    for (const nb of data.notebooks) {
      if (!data.pages.some((pg) => pg.nb === nb.id)) data.pages.push(newPage(nb.id));
    }
    return data;
  }

  function boardFile(id) {
    return path.join(DATA_DIR, id + '.json');
  }

  function getBoard(id) {
    let b = boards.get(id);
    if (b) return b;
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(boardFile(id), 'utf8'));
    } catch {
      /* новой доски ещё нет */
    }
    const fresh = !data;
    if (!data) data = { id, title: '', notebooks: [], pages: [], created: Date.now() };
    normalize(data);
    b = { id, data, clients: new Set(), fresh, saveTimer: null, evictTimer: null, chat: [] };
    boards.set(id, b);
    return b;
  }

  function saveNow(b) {
    if (b.saveTimer) {
      clearTimeout(b.saveTimer);
      b.saveTimer = null;
    }
    if (b.fresh && isEmptyBoard(b) && !b.data.title) return; // пустые доски на диск не пишем
    const tmp = boardFile(b.id) + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(b.data));
      fs.renameSync(tmp, boardFile(b.id));
    } catch (e) {
      console.error('Не удалось сохранить доску', b.id, e.message);
    }
  }

  function changed(b) {
    b.fresh = false;
    if (b.saveTimer) return;
    b.saveTimer = setTimeout(() => saveNow(b), 1500);
  }

  const findPage = (b, pageId) => b.data.pages.find((pg) => pg.id === pageId);
  const findNotebook = (b, nbId) => b.data.notebooks.find((n) => n.id === nbId);
  const isEmptyBoard = (b) => b.data.pages.every((pg) => pg.objects.length === 0);

  // ---------- проверка входящих данных ----------
  function validObject(o) {
    return (
      o &&
      typeof o === 'object' &&
      typeof o.id === 'string' &&
      o.id.length > 0 &&
      o.id.length <= 40 &&
      OBJECT_TYPES.has(o.type)
    );
  }

  function validPage(pg) {
    return (
      pg &&
      typeof pg.id === 'string' &&
      pg.id.length <= 40 &&
      typeof pg.nb === 'string' &&
      BACKGROUNDS.has(pg.bg) &&
      Array.isArray(pg.objects) &&
      pg.objects.every(validObject)
    );
  }

  function validNotebook(nb) {
    return nb && typeof nb.id === 'string' && nb.id.length > 0 && nb.id.length <= 40 && typeof nb.title === 'string';
  }

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(b, msg, except) {
    const s = JSON.stringify(msg);
    for (const c of b.clients) if (c !== except && c.readyState === 1) c.send(s);
  }

  function usersOf(b) {
    return [...b.clients].filter((c) => !c.replaced).map((c) => c.user);
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const boardId = url.searchParams.get('board') || '';
    if (!BOARD_ID_RE.test(boardId)) return ws.close(1008, 'bad board');
    const cid = url.searchParams.get('cid') || '';

    const b = getBoard(boardId);
    if (b.evictTimer) {
      clearTimeout(b.evictTimer);
      b.evictTimer = null;
    }
    // Постоянный id вкладки: после переподключения человек остаётся «тем же»,
    // и голосовая связь не рвётся.
    const userId = CLIENT_ID_RE.test(cid) ? cid : randomId(10);
    for (const old of b.clients) {
      if (old.user.id === userId) {
        old.replaced = true;
        old.terminate();
      }
    }
    ws.user = { id: userId, name: 'Гость', color: '#64748b', voice: false, muted: false };
    ws.isAlive = true;
    b.clients.add(ws);

    send(ws, { t: 'init', board: b.data, fresh: b.fresh && isEmptyBoard(b), you: ws.user.id, users: usersOf(b), chat: b.chat });

    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!m || typeof m.t !== 'string') return;
      try {
        handle(b, ws, m, raw.length);
      } catch (e) {
        console.error('Ошибка обработки', m.t, e.message);
      }
    });

    ws.on('close', () => {
      b.clients.delete(ws);
      if (!ws.replaced) broadcast(b, { t: 'leave', uid: ws.user.id });
      if (b.clients.size === 0) {
        saveNow(b);
        // освобождаем память через 10 минут без участников
        b.evictTimer = setTimeout(() => {
          if (b.clients.size === 0) boards.delete(b.id);
        }, 10 * 60 * 1000);
      }
    });
  });

  function setUserFields(ws, m) {
    if (typeof m.name === 'string') ws.user.name = m.name.trim().slice(0, 40) || 'Гость';
    if (typeof m.color === 'string' && COLOR_RE.test(m.color)) ws.user.color = m.color;
    if (typeof m.voice === 'boolean') ws.user.voice = m.voice;
    if (typeof m.muted === 'boolean') ws.user.muted = m.muted;
  }

  function handle(b, ws, m, size) {
    const page = typeof m.page === 'string' ? findPage(b, m.page) : null;

    switch (m.t) {
      case 'ping':
        return send(ws, { t: 'pong' });

      case 'hello':
      case 'voice':
        setUserFields(ws, m);
        return broadcast(b, { t: 'users', users: usersOf(b) });

      case 'rtc': {
        // служебные сообщения WebRTC — только адресату
        if (typeof m.to !== 'string') return;
        for (const c of b.clients) {
          if (c.user.id === m.to && !c.replaced) return send(c, { ...m, from: ws.user.id });
        }
        return;
      }

      case 'chat': {
        if (typeof m.text !== 'string') return;
        const text = m.text.trim().slice(0, 1000);
        if (!text) return;
        const msg = { id: randomId(8), uid: ws.user.id, name: ws.user.name, color: ws.user.color, text, at: Date.now() };
        b.chat.push(msg);
        if (b.chat.length > 200) b.chat.splice(0, b.chat.length - 200);
        return broadcast(b, { t: 'chat', msg });
      }

      case 'title': {
        if (typeof m.title !== 'string') return;
        b.data.title = m.title.slice(0, 120);
        changed(b);
        return broadcast(b, { t: 'title', title: b.data.title }, ws);
      }

      case 'add': {
        if (!page || !validObject(m.obj)) return;
        const i = page.objects.findIndex((o) => o.id === m.obj.id);
        if (i >= 0) page.objects[i] = m.obj;
        else if (Number.isInteger(m.index) && m.index >= 0 && m.index < page.objects.length)
          page.objects.splice(m.index, 0, m.obj);
        else page.objects.push(m.obj);
        changed(b);
        return broadcast(b, { t: 'add', page: page.id, obj: m.obj, index: m.index }, ws);
      }

      case 'update': {
        if (!page || !Array.isArray(m.objs) || !m.objs.every(validObject)) return;
        for (const o of m.objs) {
          const i = page.objects.findIndex((x) => x.id === o.id);
          if (i >= 0) page.objects[i] = o;
        }
        changed(b);
        return broadcast(b, { t: 'update', page: page.id, objs: m.objs }, ws);
      }

      case 'remove': {
        if (!page || !Array.isArray(m.ids)) return;
        const ids = new Set(m.ids);
        page.objects = page.objects.filter((o) => !ids.has(o.id));
        changed(b);
        return broadcast(b, { t: 'remove', page: page.id, ids: m.ids }, ws);
      }

      case 'order': {
        // порядок слоёв: полный список id в нужном порядке
        if (!page || !Array.isArray(m.ids)) return;
        const pos = new Map(m.ids.map((id, i) => [id, i]));
        page.objects = page.objects
          .map((o, i) => ({ o, k: pos.has(o.id) ? pos.get(o.id) : 1e9 + i }))
          .sort((a, c) => a.k - c.k)
          .map((x) => x.o);
        changed(b);
        return broadcast(b, { t: 'order', page: page.id, ids: m.ids }, ws);
      }

      case 'set': {
        if (!page || !Array.isArray(m.objects) || !m.objects.every(validObject)) return;
        page.objects = m.objects;
        changed(b);
        return broadcast(b, { t: 'set', page: page.id, objects: m.objects }, ws);
      }

      case 'page-add': {
        const pd = m.pageData;
        if (!validPage(pd) || findPage(b, pd.id) || !findNotebook(b, pd.nb)) return;
        if (b.data.pages.length >= 500) return;
        const idx = Number.isInteger(m.index) ? Math.max(0, Math.min(m.index, b.data.pages.length)) : b.data.pages.length;
        b.data.pages.splice(idx, 0, pd);
        changed(b);
        return broadcast(b, { t: 'page-add', pageData: pd, index: idx }, ws);
      }

      case 'page-remove': {
        if (!page) return;
        // в блокноте должна остаться хотя бы одна страница
        if (!b.data.pages.some((pg) => pg !== page && pg.nb === page.nb)) return;
        b.data.pages = b.data.pages.filter((pg) => pg !== page);
        changed(b);
        return broadcast(b, { t: 'page-remove', page: page.id }, ws);
      }

      case 'page-bg': {
        if (!page || !BACKGROUNDS.has(m.bg)) return;
        page.bg = m.bg;
        changed(b);
        return broadcast(b, { t: 'page-bg', page: page.id, bg: m.bg }, ws);
      }

      case 'nb-add': {
        // новый блокнот сразу с первой страницей
        if (!validNotebook(m.nb) || findNotebook(b, m.nb.id) || b.data.notebooks.length >= 200) return;
        if (!validPage(m.pageData) || m.pageData.nb !== m.nb.id || findPage(b, m.pageData.id)) return;
        const nb = { id: m.nb.id, title: m.nb.title.slice(0, 80) };
        const idx = Number.isInteger(m.index) ? Math.max(0, Math.min(m.index, b.data.notebooks.length)) : b.data.notebooks.length;
        b.data.notebooks.splice(idx, 0, nb);
        b.data.pages.push(m.pageData);
        changed(b);
        return broadcast(b, { t: 'nb-add', nb, pageData: m.pageData, index: idx }, ws);
      }

      case 'nb-update': {
        if (!validNotebook(m.nb)) return;
        const nb = findNotebook(b, m.nb.id);
        if (!nb) return;
        nb.title = m.nb.title.slice(0, 80);
        changed(b);
        return broadcast(b, { t: 'nb-update', nb }, ws);
      }

      case 'nb-remove': {
        const nb = findNotebook(b, m.nb);
        if (!nb || b.data.notebooks.length <= 1) return;
        b.data.notebooks = b.data.notebooks.filter((n) => n !== nb);
        b.data.pages = b.data.pages.filter((pg) => pg.nb !== nb.id);
        changed(b);
        return broadcast(b, { t: 'nb-remove', nb: nb.id }, ws);
      }

      case 'restore': {
        // Бесплатный хостинг стирает диск при перезапуске. Если доска на сервере пустая,
        // а у участника в браузере есть её копия — восстанавливаем из копии.
        const bd = m.board;
        if (!bd || !isEmptyBoard(b) || size > MAX_BOARD) return;
        const pages = bd.pages;
        if (!Array.isArray(pages) || pages.length === 0 || pages.length > 500) return;
        const notebooks = Array.isArray(bd.notebooks) ? bd.notebooks.filter(validNotebook) : [];
        const fixed = pages.map((pg) => ({ ...pg, nb: typeof pg.nb === 'string' ? pg.nb : '' }));
        if (!fixed.every(validPage)) return;
        b.data.notebooks = notebooks.map((n) => ({ id: n.id, title: n.title.slice(0, 80) }));
        b.data.pages = fixed;
        if (typeof bd.title === 'string') b.data.title = bd.title.slice(0, 120);
        normalize(b.data);
        changed(b);
        // отправителю не шлём: у него уже есть эта доска (и, возможно, свежие изменения поверх)
        return broadcast(b, { t: 'init', board: b.data, fresh: false, users: usersOf(b), restored: true }, ws);
      }

      // Временные сообщения: не сохраняются, просто пересылаются остальным
      case 'live':
      case 'live-end':
      case 'cursor':
      case 'laser':
      case 'summon':
      case 'view':
        return broadcast(b, { ...m, uid: ws.user.id }, ws);
    }
  }

  // Проверка «живых» соединений
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, 30000);

  function close() {
    clearInterval(pingTimer);
    for (const b of boards.values()) saveNow(b);
    if (tunnel) tunnel.stop();
    try {
      server.close();
    } catch {
      /* ignore */
    }
  }

  return new Promise((resolve, reject) => {
    const done = () => {
      PORT = server.address().port;
      tunnel = createTunnel({ port: PORT, binDir: path.join(DATA_DIR, 'bin') });
      resolve({ port: PORT, url: `http://localhost:${PORT}`, lan: lanUrls(), tunnel, close, hosted: HOSTED });
    };
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && opts.fallbackPort) {
        server.once('error', reject);
        server.listen(0, done); // занят — берём любой свободный порт
      } else reject(e);
    });
    server.listen(WANT_PORT, done);
  });
}

module.exports = { start };

// ---------- запуск из командной строки: node server.js [--open] [--tunnel] ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  start()
    .then((info) => {
      console.log(`Доска запущена: ${info.url}`);
      if (!info.hosted) {
        for (const u of info.lan) console.log(`В этой сети (Wi-Fi):  ${u}`);
        console.log('Доступ из интернета включается на доске кнопкой «Пригласить» (или запуск с ключом --tunnel).');
      }
      if (args.includes('--open')) {
        const { spawn } = require('child_process');
        const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', info.url]] : process.platform === 'darwin' ? ['open', [info.url]] : ['xdg-open', [info.url]];
        try {
          spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
        } catch {
          /* откроют вручную */
        }
      }
      if (args.includes('--tunnel')) {
        info.tunnel.start(args.includes('--lhr') ? 'lhr' : 'cloudflare');
        let shown = '';
        const watch = setInterval(() => {
          const s = info.tunnel.status();
          if (s.state === 'on' && shown !== s.url) {
            shown = s.url;
            console.log(`Адрес для интернета: ${s.url}`);
          } else if (s.state === 'error') {
            console.log('Туннель: ' + s.error);
            clearInterval(watch);
          }
        }, 1000);
      }
      const bye = () => {
        info.close();
        process.exit(0);
      };
      process.on('SIGTERM', bye);
      process.on('SIGINT', bye);
    })
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? 'Порт уже занят — возможно, доска уже запущена.' : e);
      process.exit(1);
    });
}
