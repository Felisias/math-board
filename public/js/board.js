// Онлайн-доска: рисование, фигуры, текст, формулы, графики, совместная работа.
(() => {
  'use strict';

  // ================== Настройки ==================
  const G = 40; // размер клетки в единицах доски
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const PALETTE = ['#1d2a3a', '#e03e3e', '#2457c5', '#1f9d55', '#f08c00', '#8b4fd9', '#f5c800', '#8a94a3'];
  const GRAPH_COLORS = ['#2457c5', '#e03e3e', '#1f9d55', '#8b4fd9', '#f08c00', '#0ea5b7'];
  const USER_COLORS = ['#e5484d', '#2457c5', '#1f9d55', '#f08c00', '#8b4fd9', '#0ea5b7', '#d6409f', '#12a594', '#ca8a04', '#6e56cf'];
  const WIDTHS = [2, 4, 8]; // толщина линии на экране
  const TEXT_SIZES = [22, 30, 44]; // размер текста на экране
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;
  const SHAPES = ['line', 'arrow', 'rect', 'ellipse', 'triangle'];

  const boardId = location.pathname.split('/').filter(Boolean).pop();

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const mathLayer = $('mathLayer');
  const textEditor = $('textEditor');
  const measureCtx = document.createElement('canvas').getContext('2d');

  // ================== Утилиты ==================
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch {
        return false;
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
  function uid(n = 10) {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    let s = '';
    for (const b of arr) s += a[b % a.length];
    return s;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  const inRect = (p, b) => b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  const expand = (b, d) => b && { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d };
  function unionRect(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

  let toastTimer;
  function toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ================== Состояние ==================
  let board = null; // { id, title, pages: [{ id, bg, objects }] }
  let pageId = null;
  const pageCams = new Map();
  let cam = { x: -90, y: -80, s: 1 };
  let W = 0;
  let H = 0;
  let DPR = 1;

  let tool = 'pen';
  let color = PALETTE[0];
  let markerColor = '#f5c800';
  let widthIdx = 1;
  let fillOn = false;
  let snapOn = false;

  let me = store.get('wb:me', null);
  if (!me || typeof me !== 'object') me = { name: '', color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)] };
  let myUid = null;
  let users = [];

  const selected = new Set();
  const drafts = new Map(); // временные копии объектов, пока их двигают
  const undoStack = [];
  const redoStack = [];
  const live = new Map(); // чужие линии, которые рисуются прямо сейчас
  const cursors = new Map();
  const lasers = new Map();
  let current = null; // объект, который я рисую сейчас
  let action = null; // текущее действие мышью
  let editingId = null;
  let hoverPt = null;
  let spaceDown = false;
  let penSeen = false;

  const page = () => (board ? board.pages.find((p) => p.id === pageId) : null);
  const pageById = (id) => (board ? board.pages.find((p) => p.id === id) : null);

  // ================== Камера ==================
  const toScreen = (x, y) => ({ x: (x - cam.x) * cam.s, y: (y - cam.y) * cam.s });
  const toWorld = (x, y) => ({ x: x / cam.s + cam.x, y: y / cam.s + cam.y });
  const viewRect = () => ({ x: cam.x, y: cam.y, w: W / cam.s, h: H / cam.s, s: cam.s });
  const isMobile = () => window.innerWidth <= 760;

  function zoomAt(sx, sy, factor) {
    const w = toWorld(sx, sy);
    cam.s = clamp(cam.s * factor, MIN_ZOOM, MAX_ZOOM);
    cam.x = w.x - sx / cam.s;
    cam.y = w.y - sy / cam.s;
    requestRender();
  }
  function defaultCam(pg) {
    if (pg && pg.bg === 'coord') return { x: -W / 2, y: -H / 2, s: 1 };
    return isMobile() ? { x: -20, y: -70, s: 1 } : { x: -140, y: -80, s: 1 };
  }
  function centerOn(wx, wy, s = cam.s) {
    cam.s = clamp(s, MIN_ZOOM, MAX_ZOOM);
    cam.x = wx - W / 2 / cam.s;
    cam.y = wy - H / 2 / cam.s;
    requestRender();
  }

  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    requestRender();
  }

  // ================== Сеть ==================
  let ws = null;
  let ready = false;
  let everReady = false;
  let retry = 0;
  const outbox = [];
  const PERSISTENT = new Set(['add', 'update', 'remove', 'set', 'page-add', 'page-remove', 'page-bg', 'title']);

  function setConn(state) {
    const el = $('conn');
    el.className = state;
    el.title = state === 'ok' ? 'Подключено' : 'Переподключение…';
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?board=${encodeURIComponent(boardId)}`);
    setConn('wait');
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ t: 'hello', name: me.name || 'Гость', color: me.color }));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(m);
    };
    ws.onclose = () => {
      ready = false;
      setConn('wait');
      const delay = Math.min(8000, 400 * 2 ** retry++);
      setTimeout(connect, delay);
    };
    ws.onerror = () => {};
  }

  function send(m) {
    if (ready && ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    else if (PERSISTENT.has(m.t)) outbox.push(m);
  }

  setInterval(() => {
    if (ready) send({ t: 'ping' });
  }, 25000);

  setTimeout(() => {
    if (!everReady) toast('Сервер просыпается — это может занять до минуты…', 8000);
  }, 3000);

  function hasObjects(b) {
    return b && Array.isArray(b.pages) && b.pages.some((p) => p.objects && p.objects.length);
  }

  function onMessage(m) {
    switch (m.t) {
      case 'init': {
        if (m.you) myUid = m.you;
        if (m.users) setUsers(m.users);
        const prev = board;
        if (m.fresh) {
          // Сервер перезапустился и потерял доску — восстанавливаем из того, что есть у нас
          const backup = hasObjects(prev) ? prev : store.get('wb:board:' + boardId, null);
          if (hasObjects(backup)) {
            ws.send(JSON.stringify({ t: 'restore', board: { title: backup.title || '', pages: backup.pages } }));
            board = { id: boardId, title: backup.title || '', pages: backup.pages };
            setTimeout(() => toast('Сервер перезапускался — доска восстановлена из копии в браузере'), 300);
          } else board = m.board;
        } else board = m.board;
        if (m.restored) toast('Доска восстановлена из сохранённой копии');
        ready = true;
        setConn('ok');
        if (!everReady) $('toast').hidden = true;
        everReady = true;
        // повторяем действия, сделанные без связи
        const pending = outbox.splice(0);
        for (const msg of pending) {
          applyMessage(msg);
          ws.send(JSON.stringify(msg));
        }
        drafts.clear();
        if (!pageById(pageId)) {
          pageId = board.pages[0].id;
          cam = pageCams.get(pageId) || defaultCam(board.pages[0]);
        }
        pruneSelection();
        $('title').value = board.title || '';
        updateTitle();
        updatePageUI();
        rememberBoard();
        scheduleBackup();
        requestRender();
        return;
      }
      case 'users':
        return setUsers(m.users);
      case 'leave':
        cursors.delete(m.uid);
        lasers.delete(m.uid);
        users = users.filter((u) => u.id !== m.uid);
        renderUsers();
        return requestRender();
      case 'title':
        board.title = m.title;
        if (document.activeElement !== $('title')) $('title').value = m.title;
        updateTitle();
        rememberBoard();
        return;
      case 'live': {
        const l = live.get(m.id);
        if (m.obj) live.set(m.id, { page: m.page, obj: m.obj, at: now() });
        else if (m.base) live.set(m.id, { page: m.page, obj: { ...m.base, id: m.id, pts: (m.pts || []).slice() }, at: now() });
        else if (l && l.obj.pts && Array.isArray(m.pts)) {
          l.obj.pts.push(...m.pts);
          l.at = now();
        }
        return requestRender();
      }
      case 'live-end':
        live.delete(m.id);
        return requestRender();
      case 'cursor':
        if (m.x == null) cursors.delete(m.uid);
        else cursors.set(m.uid, { page: m.page, x: m.x, y: m.y, at: now() });
        return requestRender();
      case 'laser': {
        let tr = lasers.get(m.uid);
        if (!tr) lasers.set(m.uid, (tr = []));
        tr.push({ page: m.page, x: m.x, y: m.y, at: now() });
        if (tr.length > 80) tr.splice(0, tr.length - 80);
        return requestRender();
      }
      case 'summon': {
        const target = pageById(m.page);
        if (!target) return;
        if (m.page !== pageId) goToPage(m.page);
        centerOn(m.cx, m.cy, m.s);
        const u = users.find((x) => x.id === m.uid);
        toast((u ? u.name : 'Участник') + ' показывает вам свою часть доски');
        return;
      }
      default:
        if (PERSISTENT.has(m.t)) {
          if (m.obj && m.obj.id) live.delete(m.obj.id);
          applyMessage(m);
          if (m.t === 'page-remove' && m.page === pageId) {
            /* страницу удалили — applyMessage уже переключил */
          }
          pruneSelection();
          updatePageUI();
          scheduleBackup();
          requestRender();
        }
    }
  }

  // Применение изменения к модели (и для своих, и для чужих изменений)
  function applyMessage(m) {
    if (!board) return;
    const pg = m.page ? pageById(m.page) : null;
    switch (m.t) {
      case 'add':
        if (pg) applyAdd(pg, m.obj, m.index);
        break;
      case 'update':
        if (pg) for (const o of m.objs) replaceObj(pg, o);
        break;
      case 'remove':
        if (pg) {
          const ids = new Set(m.ids);
          pg.objects = pg.objects.filter((o) => !ids.has(o.id));
        }
        break;
      case 'set':
        if (pg) pg.objects = m.objects;
        break;
      case 'page-add':
        if (!pageById(m.pageData.id)) {
          const idx = Number.isInteger(m.index) ? clamp(m.index, 0, board.pages.length) : board.pages.length;
          board.pages.splice(idx, 0, m.pageData);
        }
        break;
      case 'page-remove':
        if (pg && board.pages.length > 1) {
          const idx = board.pages.indexOf(pg);
          board.pages.splice(idx, 1);
          if (pageId === pg.id) goToPage(board.pages[Math.min(idx, board.pages.length - 1)].id);
        }
        break;
      case 'page-bg':
        if (pg) pg.bg = m.bg;
        break;
      case 'title':
        board.title = m.title;
        break;
    }
  }

  function applyAdd(pg, obj, index) {
    const i = pg.objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) pg.objects[i] = obj;
    else if (Number.isInteger(index) && index >= 0 && index < pg.objects.length) pg.objects.splice(index, 0, obj);
    else pg.objects.push(obj);
  }
  function replaceObj(pg, obj) {
    const i = pg.objects.findIndex((o) => o.id === obj.id);
    if (i >= 0) pg.objects[i] = obj;
  }

  // ================== Действия с отменой ==================
  function opAdd(pgId, objs, indexes) {
    const pg = pageById(pgId);
    if (!pg) return;
    objs.forEach((o, i) => {
      const index = indexes ? indexes[i] : undefined;
      applyAdd(pg, o, index);
      send({ t: 'add', page: pgId, obj: o, index });
    });
    afterLocalChange();
  }
  function opRemove(pgId, ids) {
    const pg = pageById(pgId);
    if (!pg) return [];
    const idSet = new Set(ids);
    const found = [];
    pg.objects.forEach((o, i) => idSet.has(o.id) && found.push(i));
    const items = [];
    for (const i of found.sort((a, b) => b - a)) {
      items.push({ obj: pg.objects[i], index: i });
      pg.objects.splice(i, 1);
    }
    if (items.length) send({ t: 'remove', page: pgId, ids: items.map((it) => it.obj.id) });
    for (const id of ids) selected.delete(id);
    afterLocalChange();
    return items;
  }
  function opUpdate(pgId, objs) {
    const pg = pageById(pgId);
    if (!pg) return;
    for (const o of objs) replaceObj(pg, o);
    send({ t: 'update', page: pgId, objs });
    afterLocalChange();
  }
  function opSet(pgId, objects) {
    const pg = pageById(pgId);
    if (!pg) return;
    pg.objects = objects.slice();
    send({ t: 'set', page: pgId, objects: pg.objects });
    afterLocalChange();
  }
  function afterLocalChange() {
    pruneSelection();
    scheduleBackup();
    requestRender();
  }

  function pushUndo(e) {
    undoStack.push(e);
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }
  function doAdd(objs) {
    opAdd(pageId, objs);
    pushUndo({ kind: 'add', page: pageId, objs });
  }
  function doRemove(ids) {
    const items = opRemove(pageId, ids);
    if (items.length) pushUndo({ kind: 'remove', page: pageId, items });
  }
  function doUpdate(before, after) {
    opUpdate(pageId, after);
    pushUndo({ kind: 'update', page: pageId, before, after });
  }
  function doSet(before, after) {
    opSet(pageId, after);
    pushUndo({ kind: 'set', page: pageId, before, after });
  }

  function revert(e) {
    switch (e.kind) {
      case 'add':
        opRemove(e.page, e.objs.map((o) => o.id));
        break;
      case 'remove':
        for (const it of [...e.items].reverse()) opAdd(e.page, [it.obj], [it.index]);
        break;
      case 'update':
        opUpdate(e.page, e.before);
        break;
      case 'set':
        opSet(e.page, e.before);
        break;
    }
  }
  function reapply(e) {
    switch (e.kind) {
      case 'add':
        opAdd(e.page, e.objs);
        break;
      case 'remove':
        e.items = opRemove(e.page, e.items.map((it) => it.obj.id));
        break;
      case 'update':
        opUpdate(e.page, e.after);
        break;
      case 'set':
        opSet(e.page, e.after);
        break;
    }
  }
  function undo() {
    commitText();
    let e;
    while ((e = undoStack.pop()) && !pageById(e.page));
    if (!e) return updateUndoButtons();
    if (e.page !== pageId) goToPage(e.page);
    selected.clear();
    revert(e);
    redoStack.push(e);
    updateUndoButtons();
  }
  function redo() {
    let e;
    while ((e = redoStack.pop()) && !pageById(e.page));
    if (!e) return updateUndoButtons();
    if (e.page !== pageId) goToPage(e.page);
    selected.clear();
    reapply(e);
    undoStack.push(e);
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
  }

  function pruneSelection() {
    const pg = page();
    if (!pg) return selected.clear();
    const ids = new Set(pg.objects.map((o) => o.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  }

  // ================== Размеры и попадание ==================
  const boundsCache = new WeakMap();
  const mathEls = new Map(); // id -> { el, tex }

  function textSize(o) {
    measureCtx.font = `${o.size}px ${FONT}`;
    const lines = o.text.split('\n');
    let w = 0;
    for (const ln of lines) w = Math.max(w, measureCtx.measureText(ln).width);
    return { w: Math.max(w, o.size * 0.5), h: lines.length * o.size * 1.25 };
  }

  function bounds(o) {
    if (o.type === 'graph') return null;
    if (o.type === 'math') {
      const e = mathEls.get(o.id);
      if (e && e.el.isConnected && e.el.offsetWidth) {
        // точный размер с учётом дробей и корней, которые выходят за строку
        const r = e.el.getBoundingClientRect();
        const k = e.el.querySelector('.katex');
        const rk = k ? k.getBoundingClientRect() : r;
        const top = Math.min(r.top, rk.top), bottom = Math.max(r.bottom, rk.bottom);
        const p = toWorld(r.left, top);
        return { x: p.x, y: p.y, w: r.width / cam.s, h: (bottom - top) / cam.s };
      }
      return { x: o.x, y: o.y, w: o.size * Math.max(2, o.tex.length * 0.4), h: o.size * 1.5 };
    }
    let b = boundsCache.get(o);
    if (b) return b;
    switch (o.type) {
      case 'stroke': {
        const p = o.pts;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < p.length; i += 2) {
          if (p[i] < x0) x0 = p[i];
          if (p[i] > x1) x1 = p[i];
          if (p[i + 1] < y0) y0 = p[i + 1];
          if (p[i + 1] > y1) y1 = p[i + 1];
        }
        const r = o.w / 2;
        b = { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
        break;
      }
      case 'shape': {
        const r = o.w / 2 + (o.shape === 'arrow' ? Math.max(12, o.w * 4) * 0.5 : 0);
        const x0 = Math.min(o.x1, o.x2), y0 = Math.min(o.y1, o.y2);
        b = { x: x0 - r, y: y0 - r, w: Math.abs(o.x2 - o.x1) + 2 * r, h: Math.abs(o.y2 - o.y1) + 2 * r };
        break;
      }
      case 'text': {
        const s = textSize(o);
        b = { x: o.x, y: o.y, w: s.w, h: s.h };
        break;
      }
      case 'image':
        b = { x: o.x, y: o.y, w: o.w, h: o.h };
        break;
      default:
        return null;
    }
    boundsCache.set(o, b);
    return b;
  }

  function hitTest(o, x, y, tol) {
    switch (o.type) {
      case 'stroke': {
        if (!inRect({ x, y }, expand(bounds(o), tol))) return false;
        const p = o.pts;
        const r = o.w / 2 + tol;
        if (p.length <= 2) return Math.hypot(x - p[0], y - p[1]) <= r;
        for (let i = 0; i < p.length - 2; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
        return false;
      }
      case 'shape': {
        const r = o.w / 2 + tol;
        const { x1, y1, x2, y2 } = o;
        if (o.shape === 'line' || o.shape === 'arrow') return segDist(x, y, x1, y1, x2, y2) <= r;
        if (o.shape === 'rect') {
          const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), B = Math.max(y1, y2);
          if (o.fill && x >= L && x <= R && y >= T && y <= B) return true;
          return (
            segDist(x, y, L, T, R, T) <= r || segDist(x, y, R, T, R, B) <= r ||
            segDist(x, y, R, B, L, B) <= r || segDist(x, y, L, B, L, T) <= r
          );
        }
        if (o.shape === 'ellipse') {
          const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
          const rx = Math.max(Math.abs(x2 - x1) / 2, 0.01), ry = Math.max(Math.abs(y2 - y1) / 2, 0.01);
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (o.fill && d <= 1) return true;
          return Math.abs(d - 1) * Math.min(rx, ry) <= r;
        }
        if (o.shape === 'triangle') {
          const P = triPoints(o);
          if (o.fill && pointInTri(x, y, P)) return true;
          for (let i = 0; i < 3; i++) {
            const a = P[i], b = P[(i + 1) % 3];
            if (segDist(x, y, a[0], a[1], b[0], b[1]) <= r) return true;
          }
        }
        return false;
      }
      case 'text':
      case 'math':
      case 'image':
        return inRect({ x, y }, expand(bounds(o), tol));
      case 'graph': {
        const g = graphFn(o.expr);
        if (!g.f) return false;
        for (let dx = -tol; dx <= tol; dx += tol / 3) {
          const Y = -g.f((x + dx) / G) * G;
          if (Number.isFinite(Y) && Math.hypot(dx, Y - y) <= tol + o.w / 2) return true;
        }
        return false;
      }
    }
    return false;
  }
  function triPoints(o) {
    return [
      [(o.x1 + o.x2) / 2, o.y1],
      [o.x2, o.y2],
      [o.x1, o.y2],
    ];
  }
  function pointInTri(x, y, P) {
    const s = (a, b) => (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
    const d1 = s(P[0], P[1]), d2 = s(P[1], P[2]), d3 = s(P[2], P[0]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  function transformObj(o, fx, fy, k) {
    switch (o.type) {
      case 'stroke': {
        const p = o.pts.slice();
        for (let i = 0; i < p.length; i += 2) {
          p[i] = r1(fx(p[i]));
          p[i + 1] = r1(fy(p[i + 1]));
        }
        return { ...o, pts: p, w: r2(o.w * k) };
      }
      case 'shape':
        return { ...o, x1: r1(fx(o.x1)), y1: r1(fy(o.y1)), x2: r1(fx(o.x2)), y2: r1(fy(o.y2)), w: r2(o.w * k) };
      case 'text':
      case 'math':
        return { ...o, x: r1(fx(o.x)), y: r1(fy(o.y)), size: r2(o.size * k) };
      case 'image':
        return { ...o, x: r1(fx(o.x)), y: r1(fy(o.y)), w: r1(o.w * k), h: r1(o.h * k) };
      default:
        return o;
    }
  }

  function objectsForRender(pg) {
    return pg.objects.map((o) => drafts.get(o.id) || o).filter((o) => o.id !== editingId);
  }

  function pickObject(wp) {
    const pg = page();
    if (!pg) return null;
    const tol = 6 / cam.s;
    const objs = objectsForRender(pg);
    for (let i = objs.length - 1; i >= 0; i--) if (hitTest(objs[i], wp.x, wp.y, tol)) return objs[i];
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === 'shape' && o.shape !== 'line' && o.shape !== 'arrow' && inRect(wp, bounds(o))) return o;
    }
    return null;
  }

  function selectionBounds() {
    const pg = page();
    if (!pg) return null;
    let b = null;
    for (const o of objectsForRender(pg)) if (selected.has(o.id)) b = unionRect(b, bounds(o));
    return b;
  }
  function contentBounds(pg, measure) {
    let b = null;
    for (const o of pg.objects) {
      if (o.type === 'math' && measure) b = unionRect(b, measure(o));
      else b = unionRect(b, bounds(o));
    }
    return b;
  }

  // ================== Рисование ==================
  let dirty = false;
  function requestRender() {
    if (!dirty) {
      dirty = true;
      requestAnimationFrame(frame);
    }
  }
  function frame() {
    dirty = false;
    render();
    if (animating()) requestRender();
  }
  function animating() {
    const t = now();
    for (const tr of lasers.values()) if (tr.length && t - tr[tr.length - 1].at < 1000) return true;
    return false;
  }

  function drawBackground(c, bg, v, w, h) {
    // v: { x, y, s } — левый верхний угол видимой области и масштаб; w, h — размер в пикселях
    c.fillStyle = '#fffefb';
    c.fillRect(0, 0, w, h);
    if (bg === 'blank') return;
    const s = v.s;
    let step = G;
    while (step * s < 9) step *= 5;
    const sx = (x) => (x - v.x) * s;
    const sy = (y) => (y - v.y) * s;
    const i0 = Math.floor(v.x / step), i1 = Math.ceil((v.x + w / s) / step);
    const j0 = Math.floor(v.y / step), j1 = Math.ceil((v.y + h / s) / step);

    if (bg === 'grid' || bg === 'coord') {
      c.strokeStyle = bg === 'coord' ? '#e1e8f2' : '#d3dff0';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = i0; i <= i1; i++) {
        const X = Math.round(sx(i * step)) + 0.5;
        c.moveTo(X, 0);
        c.lineTo(X, h);
      }
      for (let j = j0; j <= j1; j++) {
        const Y = Math.round(sy(j * step)) + 0.5;
        c.moveTo(0, Y);
        c.lineTo(w, Y);
      }
      c.stroke();
    } else if (bg === 'dots') {
      c.fillStyle = '#b3c1d6';
      const r = clamp(1.4 * Math.sqrt(s), 1, 2.5);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) c.fillRect(sx(i * step) - r / 2, sy(j * step) - r / 2, r, r);
    } else if (bg === 'lines') {
      c.strokeStyle = '#c6d5ea';
      c.lineWidth = 1;
      c.beginPath();
      for (let j = j0; j <= j1; j++) {
        const Y = Math.round(sy(j * step)) + 0.5;
        c.moveTo(0, Y);
        c.lineTo(w, Y);
      }
      c.stroke();
    }

    if (bg === 'coord') drawAxes(c, v, w, h, sx, sy);
  }

  function drawAxes(c, v, w, h, sx, sy) {
    const s = v.s;
    const ox = sx(0), oy = sy(0);
    const unitPx = G * s;
    const label = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((n) => n * unitPx >= 30) || 1000;
    c.strokeStyle = '#33465c';
    c.fillStyle = '#33465c';
    c.lineWidth = 1.5;
    c.font = `12px ${FONT}`;
    const ax = Math.round(oy) + 0.5;
    const ay = Math.round(ox) + 0.5;
    // ось X
    if (oy >= -20 && oy <= h + 20) {
      c.beginPath();
      c.moveTo(0, ax);
      c.lineTo(w, ax);
      c.stroke();
      c.beginPath();
      c.moveTo(w - 4, ax);
      c.lineTo(w - 14, ax - 5);
      c.lineTo(w - 14, ax + 5);
      c.closePath();
      c.fill();
      c.textAlign = 'center';
      c.textBaseline = 'top';
      const i0 = Math.ceil(v.x / G / label) * label, i1 = Math.floor((v.x + w / s) / G / label) * label;
      for (let i = i0; i <= i1; i += label) {
        if (i === 0) continue;
        const X = sx(i * G);
        if (X > w - 24) continue;
        c.fillRect(X - 0.5, ax - 4, 1, 8);
        c.fillText(String(i).replace('-', '−'), X, ax + 6);
      }
      c.font = `italic 15px ${FONT}`;
      c.textAlign = 'right';
      c.fillText('x', w - 8, ax + 8);
      c.font = `12px ${FONT}`;
    }
    // ось Y
    if (ox >= -20 && ox <= w + 20) {
      c.beginPath();
      c.moveTo(ay, h);
      c.lineTo(ay, 0);
      c.stroke();
      c.beginPath();
      c.moveTo(ay, 4);
      c.lineTo(ay - 5, 14);
      c.lineTo(ay + 5, 14);
      c.closePath();
      c.fill();
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      const j0 = Math.ceil(-(v.y + h / s) / G / label) * label, j1 = Math.floor(-v.y / G / label) * label;
      for (let j = j0; j <= j1; j += label) {
        if (j === 0) continue;
        const Y = sy(-j * G);
        if (Y < 24) continue;
        c.fillRect(ay - 4, Y - 0.5, 8, 1);
        c.fillText(String(j).replace('-', '−'), ay - 7, Y);
      }
      c.font = `italic 15px ${FONT}`;
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillText('y', ay + 9, 4);
      c.font = `12px ${FONT}`;
    }
    if (oy >= -20 && oy <= h + 20 && ox >= -20 && ox <= w + 20) {
      c.textAlign = 'right';
      c.textBaseline = 'top';
      c.fillText('0', ay - 5, ax + 5);
    }
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }

  function drawStroke(c, o) {
    const p = o.pts;
    if (!p || p.length < 2) return;
    c.save();
    c.strokeStyle = c.fillStyle = o.color;
    c.lineWidth = o.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (o.marker) {
      c.globalAlpha = 0.42;
      c.globalCompositeOperation = 'multiply';
    }
    c.beginPath();
    if (p.length <= 2) {
      c.arc(p[0], p[1], o.w / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.moveTo(p[0], p[1]);
      if (p.length === 4) c.lineTo(p[2], p[3]);
      else {
        for (let i = 2; i < p.length - 2; i += 2) {
          c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
        }
        c.lineTo(p[p.length - 2], p[p.length - 1]);
      }
      c.stroke();
    }
    c.restore();
  }

  function drawShape(c, o) {
    const { x1, y1, x2, y2 } = o;
    c.save();
    c.strokeStyle = o.color;
    c.lineWidth = o.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    switch (o.shape) {
      case 'line':
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        break;
      case 'arrow': {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const hl = Math.max(12, o.w * 4);
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.moveTo(x2 - hl * Math.cos(a - 0.42), y2 - hl * Math.sin(a - 0.42));
        c.lineTo(x2, y2);
        c.lineTo(x2 - hl * Math.cos(a + 0.42), y2 - hl * Math.sin(a + 0.42));
        break;
      }
      case 'rect':
        c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        break;
      case 'ellipse':
        c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        break;
      case 'triangle': {
        const P = triPoints(o);
        c.moveTo(P[0][0], P[0][1]);
        c.lineTo(P[1][0], P[1][1]);
        c.lineTo(P[2][0], P[2][1]);
        c.closePath();
        break;
      }
    }
    if (o.fill && o.shape !== 'line' && o.shape !== 'arrow') {
      c.fillStyle = hexA(o.color, 0.16);
      c.fill();
    }
    c.stroke();
    c.restore();
  }

  function drawText(c, o) {
    c.save();
    c.fillStyle = o.color;
    c.font = `${o.size}px ${FONT}`;
    c.textBaseline = 'top';
    const lines = o.text.split('\n');
    const off = o.size * 0.125;
    lines.forEach((ln, i) => c.fillText(ln, o.x, o.y + off + i * o.size * 1.25));
    c.restore();
  }

  const imgCache = new Map();
  function getImage(o) {
    const e = imgCache.get(o.id);
    if (e && e.src === o.src) return e.img;
    const img = new Image();
    img.onload = requestRender;
    img.src = o.src;
    imgCache.set(o.id, { src: o.src, img });
    return img;
  }
  function drawImageObj(c, o) {
    const img = getImage(o);
    if (img.complete && img.naturalWidth) c.drawImage(img, o.x, o.y, o.w, o.h);
    else {
      c.fillStyle = '#eef1f5';
      c.fillRect(o.x, o.y, o.w, o.h);
    }
  }

  const fnCache = new Map();
  function graphFn(expr) {
    let g = fnCache.get(expr);
    if (!g) {
      try {
        g = { f: MathParse.compile(expr) };
      } catch (e) {
        g = { err: e.message };
      }
      fnCache.set(expr, g);
    }
    return g;
  }

  function drawGraph(c, o, v) {
    const g = graphFn(o.expr);
    if (!g.f) return;
    const f = g.f;
    const step = 1.5 / v.s;
    const top = v.y - v.h * 3, bottom = v.y + v.h * 4;
    c.save();
    c.strokeStyle = o.color;
    c.lineWidth = o.w;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    let pen = false;
    let prevY = 0;
    for (let X = v.x - step; X <= v.x + v.w + step; X += step) {
      const Y = -f(X / G) * G;
      if (!Number.isFinite(Y) || Y < top || Y > bottom) {
        pen = false;
        continue;
      }
      if (pen && Math.abs(Y - prevY) > v.h) pen = false;
      if (pen) c.lineTo(X, Y);
      else {
        c.moveTo(X, Y);
        pen = true;
      }
      prevY = Y;
    }
    c.stroke();
    // подпись y = …
    const fs = 15 / v.s;
    const margin = 90 / v.s; // не прятать подпись под панелями
    for (let X = v.x + v.w - 90 / v.s; X > v.x + 140 / v.s; X -= 12 / v.s) {
      const Y = -f(X / G) * G;
      if (Number.isFinite(Y) && Y > v.y + margin && Y < v.y + v.h - margin) {
        const txt = 'y = ' + MathParse.pretty(o.expr);
        c.font = `italic ${fs}px ${FONT}`;
        c.textAlign = 'right';
        c.textBaseline = 'bottom';
        c.lineWidth = 4 / v.s;
        c.strokeStyle = 'rgba(255,254,251,.95)';
        c.strokeText(txt, X - 6 / v.s, Y - 6 / v.s);
        c.fillStyle = o.color;
        c.fillText(txt, X - 6 / v.s, Y - 6 / v.s);
        break;
      }
    }
    c.restore();
  }

  function drawObject(c, o, v) {
    switch (o.type) {
      case 'stroke':
        return drawStroke(c, o);
      case 'shape':
        return drawShape(c, o);
      case 'text':
        return drawText(c, o);
      case 'image':
        return drawImageObj(c, o);
      case 'graph':
        return drawGraph(c, o, v);
      // формулы рисуются отдельным слоем (KaTeX)
    }
  }

  // v: { x, y, w, h, s } в единицах доски; pr — плотность пикселей
  function renderScene(c, pg, v, pr, objs) {
    c.setTransform(pr, 0, 0, pr, 0, 0);
    drawBackground(c, pg.bg, v, v.w * v.s, v.h * v.s);
    c.setTransform(pr * v.s, 0, 0, pr * v.s, -v.x * v.s * pr, -v.y * v.s * pr);
    for (const o of objs) drawObject(c, o, v);
  }

  function render() {
    const pg = page();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!pg) {
      ctx.fillStyle = '#fffefb';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const v = viewRect();
    renderScene(ctx, pg, v, DPR, objectsForRender(pg));
    const t = now();
    for (const [id, l] of live) {
      if (t - l.at > 15000) live.delete(id);
      else if (l.page === pg.id) drawObject(ctx, l.obj, v);
    }
    if (current) drawObject(ctx, current, v);

    // формулы обновляем раньше рамки выделения: её размер берётся из них
    syncMath(pg);
    // экранные элементы
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSelection();
    drawBoxSelect();
    drawLasers(pg.id);
    drawCursors(pg.id);
    drawEraserRing();
    if (textState) positionTextEditor();
    $('zoomLabel').textContent = Math.round(cam.s * 100) + '%';
  }

  function handleRect(b) {
    if (!b) return null;
    const p = toScreen(b.x + b.w, b.y + b.h);
    return { x: p.x + 4 - 6, y: p.y + 4 - 6, w: 12, h: 12 };
  }

  function drawSelection() {
    if (!selected.size) return;
    const pg = page();
    ctx.save();
    ctx.strokeStyle = '#2457c5';
    ctx.lineWidth = 1;
    // подсветка графиков (у них нет рамки)
    for (const o of objectsForRender(pg)) {
      if (selected.has(o.id) && o.type === 'graph') {
        ctx.save();
        ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, -cam.x * cam.s * DPR, -cam.y * cam.s * DPR);
        drawGraph(ctx, { ...o, color: 'rgba(36,87,197,.25)', w: o.w + 8 / cam.s }, viewRect());
        ctx.restore();
      }
    }
    const b = selectionBounds();
    if (b) {
      const p = toScreen(b.x, b.y);
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(Math.round(p.x - 4) + 0.5, Math.round(p.y - 4) + 0.5, Math.round(b.w * cam.s + 8), Math.round(b.h * cam.s + 8));
      ctx.setLineDash([]);
      const hr = handleRect(b);
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(hr.x, hr.y, hr.w, hr.h);
      ctx.strokeRect(hr.x, hr.y, hr.w, hr.h);
    }
    ctx.restore();
  }

  function drawBoxSelect() {
    if (!action || action.kind !== 'box') return;
    const a = toScreen(Math.min(action.x0, action.x1), Math.min(action.y0, action.y1));
    const w = Math.abs(action.x1 - action.x0) * cam.s, h = Math.abs(action.y1 - action.y0) * cam.s;
    ctx.save();
    ctx.fillStyle = 'rgba(36,87,197,.08)';
    ctx.strokeStyle = 'rgba(36,87,197,.6)';
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
    ctx.restore();
  }

  const myTrail = [];
  function drawLasers(pid) {
    const t = now();
    const all = [['me', myTrail], ...lasers];
    for (const [, tr] of all) {
      while (tr.length && t - tr[0].at > 900) tr.shift();
      const pts = tr.filter((p) => p.page === pid);
      if (!pts.length) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = toScreen(pts[i - 1].x, pts[i - 1].y), b = toScreen(pts[i].x, pts[i].y);
        const age = (t - pts[i].at) / 900;
        ctx.strokeStyle = `rgba(229,72,77,${0.85 * (1 - age)})`;
        ctx.lineWidth = 6 * (1 - age) + 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const head = pts[pts.length - 1];
      if (t - head.at < 500) {
        const p = toScreen(head.x, head.y);
        ctx.shadowColor = 'rgba(229,72,77,.9)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ff3b3b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawCursors(pid) {
    const t = now();
    for (const [uidKey, c] of cursors) {
      if (t - c.at > 10000) {
        cursors.delete(uidKey);
        continue;
      }
      if (c.page !== pid) continue;
      const u = users.find((x) => x.id === uidKey);
      if (!u) continue;
      const p = toScreen(c.x, c.y);
      ctx.save();
      ctx.translate(Math.round(p.x), Math.round(p.y));
      ctx.fillStyle = u.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4.5, 12);
      ctx.lineTo(8, 19);
      ctx.lineTo(10.5, 18);
      ctx.lineTo(7.2, 11);
      ctx.lineTo(12.5, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = `600 12px ${FONT}`;
      const tw = ctx.measureText(u.name).width;
      ctx.fillStyle = u.color;
      roundRect(ctx, 12, 18, tw + 12, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.name, 18, 28.5);
      ctx.restore();
    }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function eraserRadius() {
    return Math.max(8, WIDTHS[widthIdx] * 3);
  }
  function drawEraserRing() {
    if (tool !== 'eraser' || !hoverPt) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(29,42,58,.55)';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hoverPt.x, hoverPt.y, eraserRadius(), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ================== Формулы (KaTeX) ==================
  function renderTex(el, tex) {
    try {
      if (!window.katex) throw new Error('no katex');
      katex.render('\\displaystyle ' + tex, el, { throwOnError: true, strict: false, output: 'html' });
      el.classList.remove('err');
    } catch {
      el.textContent = tex;
      el.classList.add('err');
    }
  }
  let mathPage = null;
  function syncMath(pg) {
    mathLayer.style.transform = `translate(${-cam.x * cam.s}px, ${-cam.y * cam.s}px) scale(${cam.s})`;
    if (mathPage !== pg.id) {
      mathLayer.innerHTML = '';
      mathEls.clear();
      mathPage = pg.id;
    }
    const seen = new Set();
    for (const o of objectsForRender(pg)) {
      if (o.type !== 'math') continue;
      seen.add(o.id);
      let e = mathEls.get(o.id);
      if (!e) {
        const el = document.createElement('div');
        el.className = 'formula';
        mathLayer.append(el);
        e = { el, tex: null, key: '' };
        mathEls.set(o.id, e);
      }
      if (e.tex !== o.tex) {
        renderTex(e.el, o.tex);
        e.tex = o.tex;
      }
      const key = `${o.x}|${o.y}|${o.size}|${o.color}`;
      if (e.key !== key) {
        e.el.style.left = o.x + 'px';
        e.el.style.top = o.y + 'px';
        e.el.style.fontSize = o.size + 'px';
        e.el.style.color = o.color;
        e.key = key;
      }
    }
    for (const [id, e] of mathEls)
      if (!seen.has(id)) {
        e.el.remove();
        mathEls.delete(id);
      }
  }

  // ================== Ввод мышью, пером и пальцами ==================
  const pointers = new Map();
  let lastCursorSend = 0;
  let lastLiveSend = 0;
  let lastLaserSend = 0;
  let lastDragSend = 0;

  function setCursor() {
    const map = {
      select: 'default', hand: 'grab', pen: 'crosshair', marker: 'crosshair', eraser: 'none',
      laser: 'crosshair', text: 'text', math: 'copy', graph: 'copy',
    };
    canvas.style.cursor = spaceDown ? 'grab' : map[tool] || 'crosshair';
  }

  function snap(p) {
    return snapOn ? { x: Math.round(p.x / G) * G, y: Math.round(p.y / G) * G } : p;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!board) return;
    if (textState) {
      commitText();
      return;
    }
    closeMenu();
    // не даём браузеру перекинуть фокус (иначе поле ввода текста сразу закроется)
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== textEditor) {
      document.activeElement.blur();
    }
    if (e.pointerType === 'pen') penSeen = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    const touches = [...pointers.values()].filter((p) => p.type === 'touch');
    if (e.pointerType === 'touch' && touches.length >= 2) {
      cancelAction();
      startPinch();
      return;
    }
    if (pointers.size > 1) return;

    const sp = { x: e.clientX, y: e.clientY };
    const wp = toWorld(sp.x, sp.y);
    const panTouch = e.pointerType === 'touch' && penSeen;
    if (e.button === 1 || e.button === 2 || spaceDown || tool === 'hand' || panTouch) {
      action = { kind: 'pan', sx: sp.x, sy: sp.y, cx: cam.x, cy: cam.y };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    switch (tool) {
      case 'pen':
      case 'marker':
        startStroke(wp);
        break;
      case 'eraser':
        action = { kind: 'erase', last: wp, removed: [] };
        eraseAlong(wp, wp);
        break;
      case 'laser':
        action = { kind: 'laser' };
        addLaser(wp);
        break;
      case 'text': {
        const hit = pickObject(wp);
        if (hit && hit.type === 'text') startText(null, hit);
        else startText(wp);
        break;
      }
      case 'math':
        openMathModal({ x: wp.x, y: wp.y });
        break;
      case 'graph':
        openGraphModal(null);
        break;
      case 'select':
        selectDown(wp, sp, e);
        break;
      default:
        if (SHAPES.includes(tool)) startShape(wp);
    }
    requestRender();
  });

  window.addEventListener('pointermove', (e) => {
    if (!board) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const sp = { x: e.clientX, y: e.clientY };
    const onCanvas = e.target === canvas;
    hoverPt = onCanvas ? sp : null;
    if (tool === 'eraser') requestRender();

    const wp = toWorld(sp.x, sp.y);
    const t = now();
    if (e.pointerType !== 'touch' && onCanvas && t - lastCursorSend > 60) {
      lastCursorSend = t;
      send({ t: 'cursor', page: pageId, x: r1(wp.x), y: r1(wp.y) });
    }
    if (!action) return;

    switch (action.kind) {
      case 'pinch':
        return movePinch();
      case 'pan':
        cam.x = action.cx - (sp.x - action.sx) / cam.s;
        cam.y = action.cy - (sp.y - action.sy) / cam.s;
        return requestRender();
      case 'stroke': {
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of evs.length ? evs : [e]) addStrokePoint(toWorld(ce.clientX, ce.clientY));
        flushLiveStroke(false);
        return requestRender();
      }
      case 'erase':
        eraseAlong(action.last, wp);
        action.last = wp;
        return;
      case 'laser':
        return addLaser(wp);
      case 'shape':
        moveShape(wp, e.shiftKey);
        return requestRender();
      case 'move':
        return moveSelection(wp);
      case 'resize':
        return resizeSelection(wp);
      case 'box':
        action.x1 = wp.x;
        action.y1 = wp.y;
        return requestRender();
    }
  });

  function pointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!action) return;
    if (action.kind === 'pinch') {
      if (pointers.size < 2) action = null;
      return;
    }
    if (pointers.size > 0) return;
    const a = action;
    action = null;
    switch (a.kind) {
      case 'pan':
        setCursor();
        break;
      case 'stroke':
        finishStroke();
        break;
      case 'erase':
        if (a.removed.length) pushUndo({ kind: 'remove', page: pageId, items: a.removed });
        break;
      case 'shape':
        finishShape();
        break;
      case 'move':
      case 'resize':
        finishDrag(a);
        break;
      case 'box':
        finishBox(a);
        break;
    }
    requestRender();
  }
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', () => {
    hoverPt = null;
    if (tool === 'eraser') requestRender();
  });

  function cancelAction() {
    if (!action) return;
    if ((action.kind === 'stroke' || action.kind === 'shape') && current) {
      send({ t: 'live-end', id: current.id });
      current = null;
    }
    if (action.kind === 'move' || action.kind === 'resize') drafts.clear();
    action = null;
    requestRender();
  }

  // ----- масштаб двумя пальцами -----
  function startPinch() {
    const [a, b] = [...pointers.values()].filter((p) => p.type === 'touch');
    action = {
      kind: 'pinch',
      d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam0: { ...cam },
    };
  }
  function movePinch() {
    const ts = [...pointers.values()].filter((p) => p.type === 'touch');
    if (ts.length < 2) return;
    const [a, b] = ts;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const c0 = action.cam0;
    const w0 = { x: action.m0.x / c0.s + c0.x, y: action.m0.y / c0.s + c0.y };
    cam.s = clamp((c0.s * d) / action.d0, MIN_ZOOM, MAX_ZOOM);
    cam.x = w0.x - m.x / cam.s;
    cam.y = w0.y - m.y / cam.s;
    requestRender();
  }

  // ----- колесо мыши и тачпад -----
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else {
        const k = e.deltaMode === 1 ? 20 : 1;
        cam.x += ((e.shiftKey ? e.deltaY : e.deltaX) * k) / cam.s;
        cam.y += (e.shiftKey ? 0 : e.deltaY * k) / cam.s;
        requestRender();
      }
    },
    { passive: false }
  );

  // ----- карандаш и выделитель -----
  function strokeWidth(marker) {
    return r2((marker ? WIDTHS[widthIdx] * 5 : WIDTHS[widthIdx]) / cam.s);
  }
  function startStroke(wp) {
    const marker = tool === 'marker';
    current = { id: uid(), type: 'stroke', color: marker ? markerColor : color, w: strokeWidth(marker), pts: [r1(wp.x), r1(wp.y)] };
    if (marker) current.marker = 1;
    action = { kind: 'stroke', sent: 0 };
    flushLiveStroke(true);
  }
  function addStrokePoint(wp) {
    const p = current.pts;
    const lx = p[p.length - 2], ly = p[p.length - 1];
    if (Math.hypot(wp.x - lx, wp.y - ly) < 1.2 / cam.s) return;
    p.push(r1(wp.x), r1(wp.y));
  }
  function flushLiveStroke(force) {
    const t = now();
    if (!force && t - lastLiveSend < 50) return;
    lastLiveSend = t;
    const p = current.pts;
    if (action.sent === 0) {
      const { id, type, color: c, w, marker } = current;
      send({ t: 'live', page: pageId, id, base: { type, color: c, w, marker }, pts: p.slice() });
    } else if (p.length > action.sent) {
      send({ t: 'live', page: pageId, id: current.id, pts: p.slice(action.sent) });
    }
    action.sent = p.length;
  }
  function finishStroke() {
    if (!current) return;
    const obj = current;
    current = null;
    doAdd([obj]);
  }

  // ----- фигуры -----
  function startShape(wp) {
    const p = snap(wp);
    current = {
      id: uid(), type: 'shape', shape: tool, color, w: r2(WIDTHS[widthIdx] / cam.s),
      x1: r1(p.x), y1: r1(p.y), x2: r1(p.x), y2: r1(p.y),
    };
    if (fillOn && ['rect', 'ellipse', 'triangle'].includes(tool)) current.fill = 1;
    action = { kind: 'shape' };
  }
  function moveShape(wp, shift) {
    const p = snap(wp);
    let dx = p.x - current.x1, dy = p.y - current.y1;
    if (shift) {
      if (current.shape === 'line' || current.shape === 'arrow') {
        const step = Math.PI / 12;
        const ang = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        dx = len * Math.cos(ang);
        dy = len * Math.sin(ang);
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (Math.sign(dx) || 1) * m;
        dy = (Math.sign(dy) || 1) * m;
      }
    }
    current.x2 = r1(current.x1 + dx);
    current.y2 = r1(current.y1 + dy);
    const t = now();
    if (t - lastLiveSend > 50) {
      lastLiveSend = t;
      send({ t: 'live', page: pageId, id: current.id, obj: current });
    }
  }
  function finishShape() {
    if (!current) return;
    const o = current;
    current = null;
    if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * cam.s < 4) {
      send({ t: 'live-end', id: o.id });
      return;
    }
    doAdd([o]);
  }

  // ----- ластик -----
  function eraseAlong(a, b) {
    const pg = page();
    const r = eraserRadius() / cam.s;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 2)));
    const hits = [];
    for (const o of pg.objects) {
      if (o.type === 'image') continue; // картинки удаляются через выделение
      for (let k = 0; k <= n; k++) {
        if (hitTest(o, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, r)) {
          hits.push(o.id);
          break;
        }
      }
    }
    if (hits.length) action.removed.push(...opRemove(pageId, hits));
  }

  // ----- указка -----
  function addLaser(wp) {
    myTrail.push({ page: pageId, x: wp.x, y: wp.y, at: now() });
    const t = now();
    if (t - lastLaserSend > 30) {
      lastLaserSend = t;
      send({ t: 'laser', page: pageId, x: r1(wp.x), y: r1(wp.y) });
    }
    requestRender();
  }

  // ----- выделение, перемещение, масштаб -----
  function selectDown(wp, sp, e) {
    if (selected.size) {
      const b = selectionBounds();
      const hr = handleRect(b);
      if (hr && sp.x >= hr.x - 4 && sp.x <= hr.x + hr.w + 4 && sp.y >= hr.y - 4 && sp.y <= hr.y + hr.h + 4) {
        action = { kind: 'resize', b, orig: originals() };
        return;
      }
    }
    const hit = pickObject(wp);
    if (hit) {
      if (e.shiftKey) {
        if (selected.has(hit.id)) selected.delete(hit.id);
        else selected.add(hit.id);
      } else if (!selected.has(hit.id)) {
        selected.clear();
        selected.add(hit.id);
      }
      action = { kind: 'move', start: wp, orig: originals() };
    } else {
      if (!e.shiftKey) selected.clear();
      action = { kind: 'box', x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y };
    }
  }
  function originals() {
    const pg = page();
    return pg.objects.filter((o) => selected.has(o.id));
  }
  function sendDrafts(force) {
    const t = now();
    if (!force && t - lastDragSend < 80) return;
    lastDragSend = t;
    if (drafts.size) send({ t: 'update', page: pageId, objs: [...drafts.values()] });
  }
  function moveSelection(wp) {
    let dx = wp.x - action.start.x, dy = wp.y - action.start.y;
    if (snapOn) {
      dx = Math.round(dx / G) * G;
      dy = Math.round(dy / G) * G;
    }
    for (const o of action.orig) drafts.set(o.id, transformObj(o, (x) => x + dx, (y) => y + dy, 1));
    sendDrafts(false);
    requestRender();
  }
  function resizeSelection(wp) {
    const b = action.b;
    if (!b || b.w < 1 || b.h < 1) return;
    const k = clamp(Math.max((wp.x - b.x) / b.w, (wp.y - b.y) / b.h), 0.05, 50);
    for (const o of action.orig) drafts.set(o.id, transformObj(o, (x) => b.x + (x - b.x) * k, (y) => b.y + (y - b.y) * k, k));
    sendDrafts(false);
    requestRender();
  }
  function finishDrag(a) {
    if (!drafts.size) return;
    const after = a.orig.map((o) => drafts.get(o.id) || o);
    drafts.clear();
    if (after.every((o, i) => o === a.orig[i])) return requestRender();
    doUpdate(a.orig, after);
  }
  function finishBox(a) {
    const box = { x: Math.min(a.x0, a.x1), y: Math.min(a.y0, a.y1), w: Math.abs(a.x1 - a.x0), h: Math.abs(a.y1 - a.y0) };
    if (box.w * cam.s < 3 && box.h * cam.s < 3) return;
    for (const o of page().objects) {
      const b = bounds(o);
      if (b && intersects(b, box)) selected.add(o.id);
    }
  }

  canvas.addEventListener('dblclick', (e) => {
    if (!board || tool !== 'select') return;
    const wp = toWorld(e.clientX, e.clientY);
    const hit = pickObject(wp);
    if (!hit) {
      if (tool === 'select') startText(wp);
      return;
    }
    if (hit.type === 'text') startText(null, hit);
    else if (hit.type === 'math') openMathModal({ edit: hit });
    else if (hit.type === 'graph') openGraphModal(hit);
  });

  // ================== Текст ==================
  let textState = null;
  function startText(wp, existing) {
    commitText();
    if (existing) {
      textState = { x: existing.x, y: existing.y, size: existing.size, color: existing.color, id: existing.id, orig: existing };
      editingId = existing.id;
      textEditor.value = existing.text;
    } else {
      const size = r2(TEXT_SIZES[widthIdx] / cam.s);
      textState = { x: wp.x, y: wp.y - size * 0.65, size, color };
      textEditor.value = '';
    }
    textEditor.hidden = false;
    positionTextEditor();
    textEditor.focus();
    requestRender();
  }
  function positionTextEditor() {
    const st = textState;
    const p = toScreen(st.x, st.y);
    const fs = st.size * cam.s;
    textEditor.style.left = p.x + 'px';
    textEditor.style.top = p.y + 'px';
    textEditor.style.fontSize = fs + 'px';
    textEditor.style.color = st.color;
    measureCtx.font = `${fs}px ${FONT}`;
    const lines = textEditor.value.split('\n');
    let w = 0;
    for (const ln of lines) w = Math.max(w, measureCtx.measureText(ln).width);
    textEditor.style.width = Math.ceil(w + fs) + 'px';
    textEditor.style.height = Math.ceil(lines.length * fs * 1.25 + 4) + 'px';
  }
  function commitText() {
    if (!textState) return;
    const st = textState;
    textState = null;
    const text = textEditor.value.replace(/\s+$/, '');
    textEditor.hidden = true;
    textEditor.blur();
    editingId = null;
    if (st.id) {
      const cur = page() && page().objects.find((o) => o.id === st.id);
      if (!cur) return requestRender();
      if (!text) doRemove([st.id]);
      else if (text !== cur.text) doUpdate([cur], [{ ...cur, text }]);
    } else if (text) {
      doAdd([{ id: uid(), type: 'text', x: r1(st.x), y: r1(st.y), size: st.size, color: st.color, text }]);
    }
    requestRender();
  }
  textEditor.addEventListener('input', positionTextEditor);
  textEditor.addEventListener('blur', () => setTimeout(commitText, 0));
  textEditor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commitText();
    }
  });

  // ================== Окна ==================
  function showModal(id) {
    $(id).hidden = false;
  }
  function hideModal(id) {
    $(id).hidden = true;
  }
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('mousedown', (e) => {
      if (e.target === m && m.id !== 'nameModal') m.hidden = true;
    });
    m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (m.hidden = true)));
    m.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && m.id !== 'nameModal') m.hidden = true;
    });
  });

  // ----- имя -----
  function askName() {
    $('nameInput').value = me.name || '';
    showModal('nameModal');
    setTimeout(() => $('nameInput').focus(), 30);
  }
  $('nameForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('nameInput').value.trim().slice(0, 40);
    if (!n) return;
    me.name = n;
    store.set('wb:me', me);
    hideModal('nameModal');
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hello', name: me.name, color: me.color }));
  };

  // ----- формулы -----
  const SNIPPETS = [
    ['a/b', '\\frac{}{}'], ['√', '\\sqrt{}'], ['ⁿ√', '\\sqrt[]{}'], ['xⁿ', '^{}'], ['xₙ', '_{}'],
    ['±', '\\pm '], ['·', '\\cdot '], ['×', '\\times '], ['÷', '\\div '], ['≠', '\\ne '], ['≤', '\\le '], ['≥', '\\ge '], ['≈', '\\approx '],
    ['π', '\\pi '], ['∞', '\\infty '], ['α', '\\alpha '], ['β', '\\beta '], ['φ', '\\varphi '], ['Δ', '\\Delta '],
    ['∠', '\\angle '], ['°', '^\\circ '], ['⊥', '\\perp '], ['∥', '\\parallel '], ['△', '\\triangle '],
    ['→a', '\\vec{}'], ['AB̄', '\\overline{}'], ['|x|', '\\left|  \\right|'], ['( )', '\\left(  \\right)'],
    ['sin', '\\sin '], ['cos', '\\cos '], ['tg', '\\operatorname{tg} '], ['log', '\\log_{}'], ['lim', '\\lim_{x \\to } '],
    ['Σ', '\\sum_{i=1}^{n} '], ['∫', '\\int_{a}^{b} '], ['∈', '\\in '], ['ℝ', '\\mathbb{R}'], ['⇒', '\\Rightarrow '], ['⇔', '\\Leftrightarrow '],
    ['{ система', '\\begin{cases} x + y = 5 \\\\ x - y = 1 \\end{cases}'],
    ['текст', '\\text{}'],
  ];
  const mathInput = $('mathInput');
  const preview = $('mathPreview');
  for (const [label, ins] of SNIPPETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = ins.trim();
    b.onclick = () => insertSnippet(ins);
    $('snippets').append(b);
  }
  function insertSnippet(ins) {
    const s = mathInput.selectionStart, e = mathInput.selectionEnd;
    const v = mathInput.value;
    const sel = v.slice(s, e);
    let text = ins;
    let caret;
    const brace = ins.indexOf('{}');
    const sq = ins.indexOf('[]');
    const pipe = ins.indexOf('  ');
    if (sel && brace >= 0) {
      text = ins.slice(0, brace + 1) + sel + ins.slice(brace + 1);
      caret = s + text.length;
    } else if (sq >= 0) caret = s + sq + 1;
    else if (brace >= 0) caret = s + brace + 1;
    else if (pipe >= 0) caret = s + pipe + 1;
    else caret = s + text.length;
    mathInput.value = v.slice(0, s) + text + v.slice(e);
    mathInput.focus();
    mathInput.setSelectionRange(caret, caret);
    updatePreview();
  }
  function updatePreview() {
    const tex = mathInput.value.trim();
    if (!tex) {
      preview.textContent = '';
      preview.classList.remove('err');
      return;
    }
    try {
      katex.render('\\displaystyle ' + tex, preview, { throwOnError: true, strict: false });
      preview.classList.remove('err');
    } catch (err) {
      preview.textContent = 'Пока не получается прочитать: ' + String(err.message || err).replace('KaTeX parse error: ', '');
      preview.classList.add('err');
    }
  }
  mathInput.addEventListener('input', updatePreview);
  mathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $('mathForm').requestSubmit();
    }
  });
  let mathTarget = null;
  function openMathModal(target) {
    mathTarget = target;
    mathInput.value = target.edit ? target.edit.tex : '';
    updatePreview();
    showModal('mathModal');
    setTimeout(() => mathInput.focus(), 30);
  }
  $('mathForm').onsubmit = (e) => {
    e.preventDefault();
    const tex = mathInput.value.trim();
    hideModal('mathModal');
    if (!mathTarget) return;
    if (mathTarget.edit) {
      const cur = page().objects.find((o) => o.id === mathTarget.edit.id);
      if (!cur) return;
      if (!tex) doRemove([cur.id]);
      else if (tex !== cur.tex) doUpdate([cur], [{ ...cur, tex }]);
    } else if (tex) {
      const size = r2(TEXT_SIZES[widthIdx] / cam.s);
      const id = uid();
      doAdd([{ id, type: 'math', x: r1(mathTarget.x), y: r1(mathTarget.y - size * 0.8), size, color, tex }]);
      setTool('select');
      selected.clear();
      selected.add(id);
    }
    mathTarget = null;
  };

  // ----- графики -----
  const GRAPH_EXAMPLES = ['x^2', 'x^2 - 4x + 3', '2x + 1', '-x + 3', '1/x', 'sqrt(x)', '|x|', 'x^3 - 3x', 'sin(x)', '2^x'];
  const graphInput = $('graphInput');
  const graphHint = $('graphHint');
  const graphHintText = graphHint.textContent;
  for (const ex of GRAPH_EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ex;
    b.onclick = () => {
      graphInput.value = ex;
      checkGraph();
      graphInput.focus();
    };
    $('graphExamples').append(b);
  }
  function checkGraph() {
    const v = graphInput.value.trim();
    if (!v) {
      graphHint.textContent = graphHintText;
      graphHint.style.color = '';
      return true;
    }
    try {
      MathParse.compile(v);
      graphHint.textContent = graphHintText;
      graphHint.style.color = '';
      return true;
    } catch (err) {
      graphHint.textContent = err.message;
      graphHint.style.color = 'var(--danger)';
      return false;
    }
  }
  graphInput.addEventListener('input', checkGraph);
  let graphEdit = null;
  function openGraphModal(obj) {
    graphEdit = obj;
    graphInput.value = obj ? obj.expr : '';
    checkGraph();
    showModal('graphModal');
    setTimeout(() => graphInput.focus(), 30);
  }
  $('graphForm').onsubmit = (e) => {
    e.preventDefault();
    const expr = graphInput.value.trim().replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    if (!expr) return hideModal('graphModal');
    if (!checkGraph()) return;
    hideModal('graphModal');
    const pg = page();
    if (graphEdit) {
      const cur = pg.objects.find((o) => o.id === graphEdit.id);
      if (cur && cur.expr !== expr) doUpdate([cur], [{ ...cur, expr }]);
      graphEdit = null;
      return;
    }
    if (pg.bg !== 'coord') setPageBg('coord');
    const v = viewRect();
    const originVisible = 0 > v.x + 60 / cam.s && 0 < v.x + v.w - 60 / cam.s && 0 > v.y + 80 / cam.s && 0 < v.y + v.h - 80 / cam.s;
    if (!originVisible) centerOn(0, 0);
    const graphs = pg.objects.filter((o) => o.type === 'graph').length;
    const c = color === PALETTE[0] ? GRAPH_COLORS[graphs % GRAPH_COLORS.length] : color;
    doAdd([{ id: uid(), type: 'graph', expr, color: c, w: r2(Math.max(2.5, WIDTHS[widthIdx]) / cam.s) }]);
    setTool('select');
  };

  // ----- приглашение -----
  $('invite').onclick = () => {
    $('inviteLink').value = location.origin + '/b/' + boardId;
    showModal('inviteModal');
    setTimeout(() => $('inviteLink').select(), 30);
  };
  $('copyLink').onclick = async () => {
    const link = $('inviteLink').value;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      $('inviteLink').select();
      document.execCommand('copy');
    }
    $('copyLink').textContent = 'Скопировано';
    setTimeout(() => ($('copyLink').textContent = 'Копировать'), 1500);
  };

  // ================== Картинки ==================
  function loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }
  async function addImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImg(url);
    } catch {
      URL.revokeObjectURL(url);
      return toast('Не получилось открыть картинку');
    }
    URL.revokeObjectURL(url);
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * k)), ch = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, cw, ch);
    cx.drawImage(img, 0, 0, cw, ch);
    let src = c.toDataURL('image/jpeg', 0.85);
    if (file.type === 'image/png') {
      const png = c.toDataURL('image/png');
      if (png.length < src.length * 1.4) src = png;
    }
    if (src.length > 5_500_000) return toast('Картинка слишком большая');
    const v = viewRect();
    const fit = Math.min((v.w * 0.6) / cw, (v.h * 0.6) / ch, 1 / cam.s);
    const w = cw * fit, h = ch * fit;
    const id = uid();
    doAdd([{ id, type: 'image', x: r1(v.x + (v.w - w) / 2), y: r1(v.y + (v.h - h) / 2), w: r1(w), h: r1(h), src }]);
    setTool('select');
    selected.clear();
    selected.add(id);
    requestRender();
  }
  $('imageFile').onchange = (e) => {
    addImageFile(e.target.files[0]);
    e.target.value = '';
  };
  window.addEventListener('paste', (e) => {
    if (!board || isTyping()) return;
    for (const item of e.clipboardData ? e.clipboardData.items : []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        addImageFile(item.getAsFile());
        return;
      }
    }
  });

  // ================== Панели ==================
  function setTool(t) {
    if (t === 'image') {
      $('imageFile').click();
      return;
    }
    commitText();
    tool = t;
    if (t !== 'select') selected.clear();
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    updateSwatches();
    setCursor();
    requestRender();
  }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));

  function activeColor() {
    return tool === 'marker' ? markerColor : color;
  }
  function chooseColor(c) {
    if (tool === 'marker') markerColor = c;
    else color = c;
    // перекрасить выделенное
    if (tool === 'select' && selected.size) {
      const before = originals().filter((o) => o.type !== 'image');
      if (before.length) doUpdate(before, before.map((o) => ({ ...o, color: c })));
    }
    updateSwatches();
  }
  const swatchEls = [];
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.title = 'Цвет';
    b.onclick = () => chooseColor(c);
    swatchEls.push([c, b]);
    $('colors').append(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = 'Другой цвет';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.oninput = () => chooseColor(picker.value);
  custom.append(picker);
  $('colors').append(custom);
  function updateSwatches() {
    const c = activeColor();
    let found = false;
    for (const [pc, b] of swatchEls) {
      const on = pc.toLowerCase() === c.toLowerCase();
      b.classList.toggle('active', on);
      found = found || on;
    }
    custom.classList.toggle('active', !found);
    if (!found) custom.style.boxShadow = `0 0 0 2px ${c}`;
    else custom.style.boxShadow = '';
  }

  const widthEls = [];
  WIDTHS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'width-btn';
    b.title = ['Тонко', 'Средне', 'Толсто'][i];
    const s = document.createElement('span');
    s.style.height = [2, 4, 7][i] + 'px';
    b.append(s);
    b.onclick = () => {
      widthIdx = i;
      widthEls.forEach((x, j) => x.classList.toggle('active', j === i));
    };
    widthEls.push(b);
    $('widths').append(b);
  });
  widthEls[widthIdx].classList.add('active');

  $('fillToggle').onclick = () => {
    fillOn = !fillOn;
    $('fillToggle').classList.toggle('active', fillOn);
  };
  $('snapToggle').onclick = () => {
    snapOn = !snapOn;
    $('snapToggle').classList.toggle('active', snapOn);
    toast(snapOn ? 'Фигуры прилипают к узлам клеток' : 'Привязка к клеткам выключена', 1600);
  };
  $('undo').onclick = undo;
  $('redo').onclick = redo;

  // ----- участники -----
  function setUsers(list) {
    users = list || [];
    renderUsers();
  }
  function renderUsers() {
    const box = $('users');
    box.innerHTML = '';
    const shown = users.slice(0, 5);
    for (const u of shown) {
      const a = document.createElement('span');
      a.className = 'avatar';
      a.style.background = u.color;
      a.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
      a.title = u.name + (u.id === myUid ? ' (вы)' : '');
      box.append(a);
    }
    if (users.length > 5) {
      const a = document.createElement('span');
      a.className = 'avatar more';
      a.textContent = '+' + (users.length - 5);
      box.append(a);
    }
  }

  // ----- страницы -----
  function goToPage(id) {
    commitText();
    if (pageId) pageCams.set(pageId, { ...cam });
    pageId = id;
    cam = pageCams.get(id) || defaultCam(page());
    selected.clear();
    drafts.clear();
    updatePageUI();
    requestRender();
  }
  function updatePageUI() {
    if (!board) return;
    const i = board.pages.findIndex((p) => p.id === pageId);
    $('pageLabel').textContent = `${i + 1} / ${board.pages.length}`;
    $('prevPage').disabled = i <= 0;
    $('nextPage').disabled = i >= board.pages.length - 1;
    const pg = page();
    if (pg) $('bgSelect').value = pg.bg;
  }
  function pageIndex() {
    return board.pages.findIndex((p) => p.id === pageId);
  }
  $('prevPage').onclick = () => {
    const i = pageIndex();
    if (i > 0) goToPage(board.pages[i - 1].id);
  };
  $('nextPage').onclick = () => {
    const i = pageIndex();
    if (i < board.pages.length - 1) goToPage(board.pages[i + 1].id);
  };
  $('addPage').onclick = () => {
    if (!board) return;
    const pg = page();
    const np = { id: uid(8), bg: pg ? pg.bg : 'grid', objects: [] };
    const index = pageIndex() + 1;
    board.pages.splice(index, 0, np);
    send({ t: 'page-add', pageData: np, index });
    goToPage(np.id);
    scheduleBackup();
  };
  function setPageBg(bg) {
    const pg = page();
    if (!pg || pg.bg === bg) return;
    pg.bg = bg;
    send({ t: 'page-bg', page: pg.id, bg });
    updatePageUI();
    scheduleBackup();
    requestRender();
  }
  $('bgSelect').onchange = (e) => {
    setPageBg(e.target.value);
    e.target.blur();
  };
  $('summon').onclick = () => {
    const v = viewRect();
    send({ t: 'summon', page: pageId, cx: r1(v.x + v.w / 2), cy: r1(v.y + v.h / 2), s: r2(cam.s) });
    toast('Все участники перешли к вам');
  };

  // ----- масштаб -----
  $('zoomIn').onclick = () => zoomAt(W / 2, H / 2, 1.25);
  $('zoomOut').onclick = () => zoomAt(W / 2, H / 2, 0.8);
  $('zoomLabel').onclick = () => zoomAt(W / 2, H / 2, 1 / cam.s);
  $('zoomFit').onclick = () => {
    const pg = page();
    const b = pg && contentBounds(pg);
    if (!b) {
      cam = defaultCam(pg);
      return requestRender();
    }
    const s = clamp(Math.min((W - 160) / b.w, (H - 160) / b.h), MIN_ZOOM, 2);
    centerOn(b.x + b.w / 2, b.y + b.h / 2, s);
  };

  // ----- название -----
  let titleTimer;
  function updateTitle() {
    document.title = (board && board.title ? board.title + ' — ' : '') + 'Доска';
  }
  $('title').addEventListener('input', (e) => {
    if (!board) return;
    board.title = e.target.value.slice(0, 120);
    updateTitle();
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => {
      send({ t: 'title', title: board.title });
      rememberBoard();
      scheduleBackup();
    }, 400);
  });
  $('title').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') e.target.blur();
  });

  // ----- меню -----
  function closeMenu() {
    $('menu').hidden = true;
  }
  $('menuBtn').onclick = (e) => {
    e.stopPropagation();
    $('menu').hidden = !$('menu').hidden;
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenu();
  });
  $('menu').addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    closeMenu();
    if (act === 'rename') askName();
    else if (act === 'print') printBoard();
    else if (act === 'save') saveToFile();
    else if (act === 'open') $('boardFile').click();
    else if (act === 'clear') {
      const pg = page();
      if (!pg.objects.length) return;
      if (confirm('Очистить всю страницу? Это можно отменить кнопкой «Отменить».')) doSet(pg.objects.slice(), []);
    } else if (act === 'delpage') {
      if (board.pages.length <= 1) return toast('Это единственная страница');
      if (!confirm('Удалить эту страницу для всех участников? Отменить это нельзя.')) return;
      const id = pageId;
      const idx = pageIndex();
      board.pages.splice(idx, 1);
      send({ t: 'page-remove', page: id });
      goToPage(board.pages[Math.min(idx, board.pages.length - 1)].id);
      scheduleBackup();
    }
  });

  // ================== Файлы, печать, копия в браузере ==================
  function saveToFile() {
    const data = JSON.stringify({ app: 'math-board', version: 1, title: board.title || '', pages: board.pages });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (board.title || 'доска').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'доска';
    a.download = name + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('boardFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('Это не файл доски');
    }
    if (!data || !Array.isArray(data.pages) || !data.pages.length) return toast('В файле нет страниц');
    let index = pageIndex() + 1;
    let first = null;
    for (const p of data.pages) {
      if (!p || !Array.isArray(p.objects)) continue;
      const np = {
        id: uid(8),
        bg: ['blank', 'grid', 'dots', 'lines', 'coord'].includes(p.bg) ? p.bg : 'grid',
        objects: p.objects.filter((o) => o && typeof o.id === 'string' && o.type),
      };
      board.pages.splice(index, 0, np);
      send({ t: 'page-add', pageData: np, index });
      index++;
      first = first || np.id;
    }
    if (first) {
      goToPage(first);
      toast('Страницы из файла добавлены в доску');
      scheduleBackup();
    }
  };

  function printBoard() {
    commitText();
    const area = $('printArea');
    area.innerHTML = '';
    // невидимый контейнер, чтобы измерить формулы на других страницах
    const meas = document.createElement('div');
    meas.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
    document.body.append(meas);
    const measured = new Map();
    const measure = (o) => {
      const el = document.createElement('div');
      el.className = 'formula';
      el.style.fontSize = o.size + 'px';
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      renderTex(el, o.tex);
      meas.append(el);
      const r = el.getBoundingClientRect();
      const k = el.querySelector('.katex');
      const rk = k ? k.getBoundingClientRect() : r;
      const top = Math.min(r.top, rk.top), bottom = Math.max(r.bottom, rk.bottom);
      const b = { x: o.x, y: o.y + (top - r.top), w: r.width, h: bottom - top };
      measured.set(o.id, el);
      return b;
    };
    let printed = 0;
    const loads = [];
    for (const pg of board.pages) {
      const b = contentBounds(pg, measure);
      if (!b) continue;
      const pad = G;
      const bx = b.x - pad, by = b.y - pad, bw = b.w + 2 * pad, bh = b.h + 2 * pad;
      const q = Math.min(2, 4000 / bw, 4000 / bh);
      const c = document.createElement('canvas');
      c.width = Math.ceil(bw * q);
      c.height = Math.ceil(bh * q);
      renderScene(c.getContext('2d'), pg, { x: bx, y: by, w: bw, h: bh, s: q }, 1, pg.objects);
      const k = Math.min(720 / bw, 1000 / bh, 1.5);
      const block = document.createElement('div');
      block.style.cssText = `position:relative;width:${bw * k}px;height:${bh * k}px;overflow:hidden;page-break-after:always;break-after:page`;
      const img = new Image();
      loads.push(new Promise((r) => (img.onload = img.onerror = r)));
      img.src = c.toDataURL('image/png');
      img.style.cssText = `position:absolute;left:0;top:0;width:${bw * k}px;height:${bh * k}px`;
      block.append(img);
      const layer = document.createElement('div');
      layer.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${-bx * k}px,${-by * k}px) scale(${k})`;
      for (const o of pg.objects) {
        if (o.type !== 'math') continue;
        const el = measured.get(o.id) || document.createElement('div');
        el.className = 'formula';
        el.style.cssText = `position:absolute;left:${o.x}px;top:${o.y}px;font-size:${o.size}px;color:${o.color}`;
        if (!measured.has(o.id)) renderTex(el, o.tex);
        layer.append(el);
      }
      block.append(layer);
      area.append(block);
      printed++;
    }
    meas.remove();
    if (!printed) return toast('На доске пока ничего нет');
    Promise.all(loads).then(() => {
      window.print();
      setTimeout(() => (area.innerHTML = ''), 1000);
    });
  }

  let backupTimer;
  function scheduleBackup() {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      if (!board) return;
      const data = { title: board.title || '', pages: board.pages, at: Date.now() };
      if (!store.set('wb:board:' + boardId, data)) {
        // не влезло (большие картинки) — сохраняем без картинок
        store.set('wb:board:' + boardId, {
          ...data,
          pages: board.pages.map((p) => ({ ...p, objects: p.objects.filter((o) => o.type !== 'image') })),
        });
      }
    }, 1500);
  }
  function rememberBoard() {
    let list = store.get('wb:recent', []);
    if (!Array.isArray(list)) list = [];
    list = list.filter((r) => r && r.id !== boardId);
    list.unshift({ id: boardId, title: board ? board.title || '' : '', at: Date.now() });
    list = list.slice(0, 20);
    store.set('wb:recent', list);
    // удаляем копии досок, которых больше нет в списке
    try {
      const keep = new Set(list.map((r) => 'wb:board:' + r.id));
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('wb:board:') && !keep.has(k)) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }

  // ================== Клавиатура ==================
  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }
  const KEYS = { v: 'select', h: 'hand', p: 'pen', m: 'marker', e: 'eraser', k: 'laser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', y: 'triangle', t: 'text', f: 'math', g: 'graph' };
  window.addEventListener('keydown', (e) => {
    if (isTyping() || !board) return;
    if ([...document.querySelectorAll('.modal')].some((m) => !m.hidden)) return;
    // e.code не зависит от раскладки: русская «я» и английская «z» — одна клавиша
    const key = e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && key === 'y') {
      e.preventDefault();
      return redo();
    }
    if (mod && key === 'a') {
      e.preventDefault();
      setTool('select');
      for (const o of page().objects) selected.add(o.id);
      return requestRender();
    }
    if (mod && key === 'd') {
      e.preventDefault();
      if (!selected.size) return;
      const copies = originals().map((o) => ({ ...transformObj(o, (x) => x + G, (y) => y + G, 1), id: uid() }));
      doAdd(copies);
      selected.clear();
      copies.forEach((o) => selected.add(o.id));
      return;
    }
    if (mod) return;
    if (e.key === ' ' && !spaceDown) {
      spaceDown = true;
      setCursor();
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      e.preventDefault();
      return doRemove([...selected]);
    }
    if (e.key === 'Escape') {
      selected.clear();
      return requestRender();
    }
    if (KEYS[key]) setTool(KEYS[key]);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceDown = false;
      setCursor();
    }
  });

  // ================== Запуск ==================
  window.addEventListener('resize', resize);
  // когда шрифты формул догрузились, размеры формул меняются — перерисовываем
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', requestRender);
    document.fonts.ready.then(requestRender);
  }
  resize();
  setTool('pen');
  updateUndoButtons();
  if (!me.name) askName();
  connect();

  // для автоматических проверок
  window.__board = { get board() { return board; }, get cam() { return cam; }, get pageId() { return pageId; }, setTool };
})();
