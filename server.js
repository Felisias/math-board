// Онлайн-доска для уроков математики.
// Сервер: раздаёт страницы, синхронизирует доски через WebSocket
// и передаёт служебные сообщения для голосовой связи (WebRTC).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_MESSAGE = 6 * 1024 * 1024; // одно сообщение (картинка) до 6 МБ
const MAX_BOARD = 40 * 1024 * 1024; // вся доска до ~40 МБ

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

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- утилиты ----------
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

// ---------- статические файлы ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

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

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'POST' && p === '/api/boards') {
    const id = randomId(10);
    getBoard(id); // создаём сразу, чтобы ссылка работала
    return json(res, { id });
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
const boards = new Map(); // id -> { data, clients:Set, fresh, saveTimer, evictTimer }

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
  b = { id, data, clients: new Set(), fresh, saveTimer: null, evictTimer: null };
  boards.set(id, b);
  return b;
}

function saveNow(b) {
  if (b.saveTimer) {
    clearTimeout(b.saveTimer);
    b.saveTimer = null;
  }
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

  send(ws, { t: 'init', board: b.data, fresh: b.fresh && isEmptyBoard(b), you: ws.user.id, users: usersOf(b) });

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
      // Бесплатный Render стирает диск при перезапуске. Если доска на сервере пустая,
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
      return broadcast(b, { ...m, uid: ws.user.id }, ws);
  }
}

// Проверка «живых» соединений
setInterval(() => {
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

function shutdown() {
  for (const b of boards.values()) if (b.saveTimer) saveNow(b);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Доска запущена: http://localhost:${PORT}`));
