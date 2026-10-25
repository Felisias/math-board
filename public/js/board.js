// Онлайн-доска: рисование, фигуры, текст, формулы, графики, блокноты, голос.
(() => {
  'use strict';

  // ================== Настройки ==================
  const G = 40; // размер клетки в единицах доски
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const PALETTE = ['#1d2a3a', '#e03e3e', '#2457c5', '#1f9d55', '#f08c00', '#8b4fd9', '#f5c800', '#8a94a3'];
  const GRAPH_COLORS = ['#2457c5', '#e03e3e', '#1f9d55', '#8b4fd9', '#f08c00', '#0ea5b7'];
  const USER_COLORS = ['#e5484d', '#2457c5', '#1f9d55', '#f08c00', '#8b4fd9', '#0ea5b7', '#d6409f', '#12a594', '#ca8a04', '#6e56cf'];
  const NB_COLORS = ['#2457c5', '#e0663e', '#1f9d55', '#8b4fd9', '#d6409f', '#0ea5b7', '#ca8a04', '#64748b'];
  const WIDTHS = [2, 4, 8]; // толщина линии на экране
  const TEXT_SIZES = [22, 30, 44]; // размер текста на экране
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;
  const SHAPES = ['line', 'arrow', 'rect', 'ellipse', 'triangle'];
  const BGS = ['blank', 'grid', 'dots', 'lines', 'coord'];

  const boardId = location.pathname.split('/').filter(Boolean).pop();
  const clientId = uid(12); // id этой вкладки — сохраняется при переподключении

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
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const fmtNum = (v) => String(Math.round(v * 1000) / 1000).replace('-', '−').replace('.', ',');

  let toastTimer;
  function toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ================== Тема (светлая / тёмная) ==================
  // Каждый участник видит доску в своей теме. Цвета объектов хранятся одинаково,
  // а при рисовании тёмные чернила на тёмном фоне становятся светлыми и наоборот.
  const LIGHT = {
    paper: '#fffefb', grid: '#d3dff0', gridCoord: '#e1e8f2', dots: '#b3c1d6', lines: '#c6d5ea', axis: '#33465c',
    plotPaper: '#ffffff', plotGrid: '#dde6f2', plotFrame: '#9aa8ba', placeholder: '#eef1f5', halo: 'rgba(255,254,251,.95)',
    sel: '#2457c5', selSoft: 'rgba(36,87,197,.25)', box: 'rgba(36,87,197,.08)', boxLine: 'rgba(36,87,197,.6)', ring: 'rgba(29,42,58,.55)', ringFill: 'rgba(255,255,255,.5)',
  };
  const DARK = {
    paper: '#171b22', grid: '#2a3342', gridCoord: '#232b37', dots: '#3b4759', lines: '#2c374a', axis: '#b4c0cf',
    plotPaper: '#1c222b', plotGrid: '#2b3442', plotFrame: '#4e5b6e', placeholder: '#262d38', halo: 'rgba(23,27,34,.95)',
    sel: '#6b9bff', selSoft: 'rgba(107,155,255,.3)', box: 'rgba(107,155,255,.10)', boxLine: 'rgba(107,155,255,.7)', ring: 'rgba(230,235,242,.6)', ringFill: 'rgba(23,27,34,.4)',
  };
  const DARK_MAP = {
    '#1d2a3a': '#e6ebf2', '#e03e3e': '#ff6b6b', '#2457c5': '#6f9dff', '#1f9d55': '#3fcf82', '#f08c00': '#ffa53a',
    '#8b4fd9': '#b48cff', '#f5c800': '#ffd84d', '#8a94a3': '#a7b1bf', '#0ea5b7': '#3dd2e2', '#e5484d': '#ff6b6b',
  };
  let themeSetting = store.get('wb:theme', 'auto');
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => themeSetting === 'dark' || (themeSetting === 'auto' && !!darkQuery && darkQuery.matches);
  let paintDark = isDark();
  const PAL = () => (paintDark ? DARK : LIGHT);

  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  const colorCache = new Map();
  function adaptColor(c, dark) {
    if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) return c;
    const key = (dark ? 'd' : 'l') + c;
    let r = colorCache.get(key);
    if (r) return r;
    const lc = c.toLowerCase();
    if (dark) {
      if (DARK_MAP[lc]) r = DARK_MAP[lc];
      else {
        const [h, s, l] = hexToHsl(lc);
        r = l < 0.42 ? hslToHex(h, s, Math.min(0.9, 1 - l + 0.08)) : lc;
      }
    } else {
      const [h, s, l] = hexToHsl(lc);
      r = l > 0.88 ? hslToHex(h, s, 0.3) : lc;
    }
    colorCache.set(key, r);
    return r;
  }
  const tc = (c) => adaptColor(c, paintDark);

  function applyTheme() {
    document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
    const labels = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };
    $('themeItem').textContent = 'Тема: ' + labels[themeSetting];
    updateSwatches();
    requestRender();
  }
  if (darkQuery) darkQuery.addEventListener('change', () => themeSetting === 'auto' && applyTheme());

  // ================== Состояние ==================
  let board = null; // { id, title, notebooks: [{id,title}], pages: [{ id, nb, bg, objects }] }
  let pageId = null;
  const pageCams = new Map();
  const pageVer = new Map(); // счётчик изменений страницы — для миниатюр
  let cam = { x: -140, y: -80, s: 1 };
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
  let myUid = clientId;
  let users = [];

  const selected = new Set();
  const drafts = new Map(); // временные копии объектов, пока их двигают
  const undoStack = [];
  const redoStack = [];
  const live = new Map(); // чужие линии, которые рисуются прямо сейчас
  const cursors = new Map();
  const lasers = new Map();
  let current = null; // объект, который я рисую сейчас
  let curveDraft = null; // кривая по точкам, которую я ставлю сейчас
  let curveHover = null;
  let action = null; // текущее действие мышью
  let editingId = null;
  let hoverPt = null;
  let spaceDown = false;
  let penSeen = false;

  const page = () => (board ? board.pages.find((p) => p.id === pageId) : null);
  const pageById = (id) => (board ? board.pages.find((p) => p.id === id) : null);
  const nbById = (id) => (board ? board.notebooks.find((n) => n.id === id) : null);
  const nbPages = (nbId) => (board ? board.pages.filter((p) => p.nb === nbId) : []);
  const bump = (pgId) => pageVer.set(pgId, (pageVer.get(pgId) || 0) + 1);

  function normalizeBoard(b) {
    if (!Array.isArray(b.pages)) b.pages = [];
    if (!Array.isArray(b.notebooks) || !b.notebooks.length) b.notebooks = [{ id: uid(8), title: 'Блокнот 1' }];
    const ids = new Set(b.notebooks.map((n) => n.id));
    for (const p of b.pages) if (!ids.has(p.nb)) p.nb = b.notebooks[0].id;
    for (const nb of b.notebooks) if (!b.pages.some((p) => p.nb === nb.id)) b.pages.push({ id: uid(8), nb: nb.id, bg: 'grid', objects: [] });
    return b;
  }

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
    if (nbView) layoutFlow();
  }

  // ================== Голосовая связь ==================
  const voice = window.createVoice({
    send: (m) => send(m),
    myUid: () => myUid,
    users: () => users,
    toast,
    changed: updateVoiceUI,
  });

  // ================== Сеть ==================
  let ws = null;
  let ready = false;
  let everReady = false;
  let retry = 0;
  const outbox = [];
  const PERSISTENT = new Set(['add', 'update', 'remove', 'set', 'page-add', 'page-remove', 'page-bg', 'title', 'nb-add', 'nb-update', 'nb-remove']);

  function setConn(state) {
    const el = $('conn');
    el.className = state;
    el.title = state === 'ok' ? 'Подключено' : 'Переподключение…';
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?board=${encodeURIComponent(boardId)}&cid=${clientId}`);
    setConn('wait');
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ t: 'hello', name: me.name || 'Гость', color: me.color, voice: voice.isOn(), muted: voice.isMuted() }));
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

  const hasObjects = (b) => b && Array.isArray(b.pages) && b.pages.some((p) => p.objects && p.objects.length);

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
            const restored = normalizeBoard({ title: backup.title || '', notebooks: backup.notebooks, pages: backup.pages });
            ws.send(JSON.stringify({ t: 'restore', board: restored }));
            board = { id: boardId, ...restored };
            setTimeout(() => toast('Сервер перезапускался — доска восстановлена из копии в браузере'), 300);
          } else board = normalizeBoard(m.board);
        } else board = normalizeBoard(m.board);
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
        for (const p of board.pages) bump(p.id);
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
        if (nbView) refreshNotebooks();
        requestRender();
        return;
      }
      case 'users':
        return setUsers(m.users);
      case 'leave':
        cursors.delete(m.uid);
        lasers.delete(m.uid);
        setUsers(users.filter((u) => u.id !== m.uid));
        return requestRender();
      case 'rtc':
        return voice.signal(m);
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
        if (!pageById(m.page)) return;
        if (nbView) closeNotebooks(true);
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
          pruneSelection();
          updatePageUI();
          scheduleBackup();
          if (nbView && /^(nb-|page-)/.test(m.t)) refreshNotebooks();
          requestRender();
        }
    }
  }

  // Применение изменения к модели (и для своих, и для чужих изменений)
  function applyMessage(m) {
    if (!board) return;
    const pg = m.page ? pageById(m.page) : null;
    if (pg) bump(pg.id);
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
        if (pg) {
          const idx = board.pages.indexOf(pg);
          board.pages.splice(idx, 1);
          if (pageId === pg.id) {
            const rest = nbPages(pg.nb);
            goToPage((rest[0] || board.pages[0]).id);
          }
        }
        break;
      case 'page-bg':
        if (pg) pg.bg = m.bg;
        break;
      case 'title':
        board.title = m.title;
        break;
      case 'nb-add':
        if (!nbById(m.nb.id)) {
          const idx = Number.isInteger(m.index) ? clamp(m.index, 0, board.notebooks.length) : board.notebooks.length;
          board.notebooks.splice(idx, 0, m.nb);
          if (!pageById(m.pageData.id)) board.pages.push(m.pageData);
        }
        break;
      case 'nb-update': {
        const nb = nbById(m.nb.id);
        if (nb) nb.title = m.nb.title;
        break;
      }
      case 'nb-remove': {
        const nb = nbById(m.nb);
        if (!nb || board.notebooks.length <= 1) break;
        const wasHere = page() && page().nb === nb.id;
        board.notebooks = board.notebooks.filter((n) => n !== nb);
        board.pages = board.pages.filter((p) => p.nb !== nb.id);
        if (wasHere) goToPage(nbPages(board.notebooks[0].id)[0].id);
        break;
      }
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
    afterLocalChange(pgId);
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
    afterLocalChange(pgId);
    return items;
  }
  function opUpdate(pgId, objs) {
    const pg = pageById(pgId);
    if (!pg) return;
    for (const o of objs) replaceObj(pg, o);
    send({ t: 'update', page: pgId, objs });
    afterLocalChange(pgId);
  }
  function opSet(pgId, objects) {
    const pg = pageById(pgId);
    if (!pg) return;
    pg.objects = objects.slice();
    send({ t: 'set', page: pgId, objects: pg.objects });
    afterLocalChange(pgId);
  }
  function afterLocalChange(pgId) {
    if (pgId) bump(pgId);
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
  // вместе с координатной плоскостью удаляются и графики на ней
  function withAttached(ids) {
    const set = new Set(ids);
    const pg = page();
    if (pg) for (const o of pg.objects) if (o.type === 'graph' && o.plot && set.has(o.plot)) set.add(o.id);
    return [...set];
  }
  function doRemove(ids) {
    const items = opRemove(pageId, withAttached(ids));
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
    cancelCurve();
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

  // ================== Кривые по точкам (сплайн Катмулла–Рома → Безье) ==================
  // Кривая проходит ровно через все поставленные точки и не «перелетает» между ними.
  function curveBeziers(flat, closed) {
    const P = [];
    for (let i = 0; i < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
    const n = P.length;
    if (n < 2) return [];
    const get = (i) => {
      if (closed) return P[((i % n) + n) % n];
      if (i < 0) return [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]];
      if (i >= n) return [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]];
      return P[i];
    };
    const segs = [];
    const m = closed && n > 2 ? n : n - 1;
    for (let i = 0; i < m; i++) segs.push(crToBezier(get(i - 1), get(i), get(i + 1), get(i + 2)));
    return segs;
  }
  function crToBezier(p0, p1, p2, p3) {
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
    const d1 = d(p0, p1), d2 = d(p1, p2), d3 = d(p2, p3);
    let b1 = p1, b2 = p2;
    if (d1 > 1e-6 && d2 > 1e-6) {
      const A = d1 * d1, B = d2 * d2, k = 3 * d1 * (d1 + d2);
      b1 = [(A * p2[0] - B * p0[0] + (2 * A + 3 * d1 * d2 + B) * p1[0]) / k, (A * p2[1] - B * p0[1] + (2 * A + 3 * d1 * d2 + B) * p1[1]) / k];
    }
    if (d3 > 1e-6 && d2 > 1e-6) {
      const C = d3 * d3, B = d2 * d2, k = 3 * d3 * (d3 + d2);
      b2 = [(C * p1[0] - B * p3[0] + (2 * C + 3 * d3 * d2 + B) * p2[0]) / k, (C * p1[1] - B * p3[1] + (2 * C + 3 * d3 * d2 + B) * p2[1]) / k];
    }
    return [p1, b1, b2, p2];
  }
  const curvePolyCache = new WeakMap();
  function curvePoly(o) {
    let poly = curvePolyCache.get(o);
    if (poly) return poly;
    poly = [];
    for (const [a, b, c, d] of curveBeziers(o.pts, o.closed)) {
      for (let i = poly.length ? 1 : 0; i <= 14; i++) {
        const t = i / 14, u = 1 - t;
        poly.push(
          u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
          u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]
        );
      }
    }
    curvePolyCache.set(o, poly);
    return poly;
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
  function polyBounds(p, r) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r };
  }
  function estimateMath(o) {
    return { x: o.x, y: o.y, w: o.size * Math.max(2, o.tex.length * 0.42), h: o.size * 1.6 };
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
      return estimateMath(o);
    }
    let b = boundsCache.get(o);
    if (b) return b;
    switch (o.type) {
      case 'stroke':
        b = polyBounds(o.pts, o.w / 2);
        break;
      case 'curve':
        b = polyBounds(curvePoly(o), o.w / 2);
        break;
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
      case 'point':
        b = { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r };
        break;
      case 'image':
      case 'plot':
        b = { x: o.x, y: o.y, w: o.w, h: o.h };
        break;
      default:
        return null;
    }
    boundsCache.set(o, b);
    return b;
  }

  function polyHit(p, x, y, r) {
    if (p.length <= 2) return Math.hypot(x - p[0], y - p[1]) <= r;
    for (let i = 0; i < p.length - 2; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
    return false;
  }

  function hitTest(o, x, y, tol) {
    switch (o.type) {
      case 'stroke':
        if (!inRect({ x, y }, expand(bounds(o), tol))) return false;
        return polyHit(o.pts, x, y, o.w / 2 + tol);
      case 'curve':
        if (!inRect({ x, y }, expand(bounds(o), tol))) return false;
        return polyHit(curvePoly(o), x, y, o.w / 2 + tol);
      case 'point':
        return Math.hypot(x - o.x, y - o.y) <= o.r + tol;
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
      case 'plot':
        return inRect({ x, y }, expand(bounds(o), tol));
      case 'graph': {
        const g = graphFn(o.expr);
        const fr = graphFrame(o, findPlotOnPage);
        if (!g.f || !fr) return false;
        if (fr.clip && !inRect({ x, y }, fr.clip)) return false;
        for (let dx = -tol; dx <= tol; dx += tol / 3) {
          const Y = fr.oy - g.f((x + dx - fr.ox) / fr.unit) * fr.unit;
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
      case 'stroke':
      case 'curve': {
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
      case 'point':
        return { ...o, x: r1(fx(o.x)), y: r1(fy(o.y)), r: r2(o.r * k) };
      case 'image':
        return { ...o, x: r1(fx(o.x)), y: r1(fy(o.y)), w: r1(o.w * k), h: r1(o.h * k) };
      case 'plot':
        return {
          ...o, x: r1(fx(o.x)), y: r1(fy(o.y)), w: r1(o.w * k), h: r1(o.h * k),
          ox: r1(fx(o.ox)), oy: r1(fy(o.oy)), cell: r2(o.cell * k),
        };
      default:
        return o;
    }
  }

  function objectsForRender(pg) {
    return pg.objects.map((o) => drafts.get(o.id) || o).filter((o) => o.id !== editingId);
  }
  function findPlotOnPage(id) {
    const pg = page();
    if (!pg) return null;
    const o = pg.objects.find((x) => x.id === id);
    return o ? drafts.get(o.id) || o : null;
  }
  function plotAt(wp) {
    const objs = objectsForRender(page());
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type === 'plot' && inRect(wp, objs[i])) return objs[i];
    return null;
  }

  function pickObject(wp) {
    const pg = page();
    if (!pg) return null;
    const tol = 6 / cam.s;
    const objs = objectsForRender(pg);
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type !== 'plot' && hitTest(objs[i], wp.x, wp.y, tol)) return objs[i];
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === 'shape' && o.shape !== 'line' && o.shape !== 'arrow' && inRect(wp, bounds(o))) return o;
    }
    // координатная плоскость — в последнюю очередь, чтобы можно было выбрать то, что нарисовано на ней
    for (let i = objs.length - 1; i >= 0; i--) if (objs[i].type === 'plot' && inRect(wp, objs[i])) return objs[i];
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
    const all = [myTrail, ...lasers.values()];
    for (const tr of all) if (tr.length && t - tr[tr.length - 1].at < 1000) return true;
    return false;
  }

  function drawBackground(c, bg, v, w, h) {
    // v: { x, y, s } — левый верхний угол видимой области и масштаб; w, h — размер в пикселях
    const P = PAL();
    c.fillStyle = P.paper;
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
      c.strokeStyle = bg === 'coord' ? P.gridCoord : P.grid;
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
      c.fillStyle = P.dots;
      const r = clamp(1.4 * Math.sqrt(s), 1, 2.5);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) c.fillRect(sx(i * step) - r / 2, sy(j * step) - r / 2, r, r);
    } else if (bg === 'lines') {
      c.strokeStyle = P.lines;
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
    c.strokeStyle = PAL().axis;
    c.fillStyle = PAL().axis;
    c.lineWidth = 1.5;
    c.font = `12px ${FONT}`;
    const ax = Math.round(oy) + 0.5;
    const ay = Math.round(ox) + 0.5;
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

  // ----- координатная плоскость-объект -----
  // plot: { x, y, w, h — рамка; ox, oy — начало координат; cell — размер клетки; cells — клеток в единице }
  const plotUnit = (o) => o.cell * o.cells;

  function drawPlot(c, o, v) {
    const P = PAL();
    const s = v.s;
    const unit = plotUnit(o);
    c.save();
    c.fillStyle = P.plotPaper;
    c.fillRect(o.x, o.y, o.w, o.h);
    c.beginPath();
    c.rect(o.x, o.y, o.w, o.h);
    c.clip();
    // сетка
    let step = o.cell;
    while (step * s < 7) step *= 5;
    c.strokeStyle = P.plotGrid;
    c.lineWidth = 1 / s;
    c.beginPath();
    for (let i = Math.ceil((o.x - o.ox) / step); i <= Math.floor((o.x + o.w - o.ox) / step); i++) {
      const X = o.ox + i * step;
      c.moveTo(X, o.y);
      c.lineTo(X, o.y + o.h);
    }
    for (let j = Math.ceil((o.y - o.oy) / step); j <= Math.floor((o.y + o.h - o.oy) / step); j++) {
      const Y = o.oy + j * step;
      c.moveTo(o.x, Y);
      c.lineTo(o.x + o.w, Y);
    }
    c.stroke();
    // оси со стрелками
    c.strokeStyle = c.fillStyle = P.axis;
    c.lineWidth = 1.6 / s;
    const ah = 11 / s, aw = 4.5 / s;
    const right = o.x + o.w - 3 / s, top = o.y + 3 / s;
    const hasX = o.oy > o.y && o.oy < o.y + o.h;
    const hasY = o.ox > o.x && o.ox < o.x + o.w;
    if (hasX) {
      c.beginPath();
      c.moveTo(o.x, o.oy);
      c.lineTo(right - ah * 0.6, o.oy);
      c.stroke();
      c.beginPath();
      c.moveTo(right, o.oy);
      c.lineTo(right - ah, o.oy - aw);
      c.lineTo(right - ah, o.oy + aw);
      c.closePath();
      c.fill();
    }
    if (hasY) {
      c.beginPath();
      c.moveTo(o.ox, o.y + o.h);
      c.lineTo(o.ox, top + ah * 0.6);
      c.stroke();
      c.beginPath();
      c.moveTo(o.ox, top);
      c.lineTo(o.ox - aw, top + ah);
      c.lineTo(o.ox + aw, top + ah);
      c.closePath();
      c.fill();
    }
    // деления и подписи
    const L = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((n) => n * unit * s >= 26 && (n >= 1 || unit * s >= 70)) || 1000;
    const fs = 12 / s;
    c.font = `${fs}px ${FONT}`;
    const tick = 3.5 / s;
    if (hasX) {
      const below = o.oy + 22 / s < o.y + o.h;
      c.textAlign = 'center';
      c.textBaseline = below ? 'top' : 'bottom';
      for (let k = Math.ceil((o.x - o.ox) / (L * unit)); k <= Math.floor((o.x + o.w - o.ox) / (L * unit)); k++) {
        if (k === 0) continue;
        const X = o.ox + k * L * unit;
        if (X > right - ah - 6 / s || X < o.x + 8 / s) continue;
        c.fillRect(X - 0.6 / s, o.oy - tick, 1.2 / s, 2 * tick);
        c.fillText(fmtNum(k * L), X, below ? o.oy + 5 / s : o.oy - 5 / s);
      }
      c.font = `italic ${15 / s}px ${FONT}`;
      c.textAlign = 'right';
      c.textBaseline = below ? 'top' : 'bottom';
      c.fillText('x', right - 2 / s, below ? o.oy + 7 / s : o.oy - 7 / s);
      c.font = `${fs}px ${FONT}`;
    }
    if (hasY) {
      const leftSide = o.ox - 34 / s > o.x;
      c.textAlign = leftSide ? 'right' : 'left';
      c.textBaseline = 'middle';
      for (let k = Math.ceil((o.oy - (o.y + o.h)) / (L * unit)); k <= Math.floor((o.oy - o.y) / (L * unit)); k++) {
        if (k === 0) continue;
        const Y = o.oy - k * L * unit;
        if (Y < top + ah + 6 / s || Y > o.y + o.h - 8 / s) continue;
        c.fillRect(o.ox - tick, Y - 0.6 / s, 2 * tick, 1.2 / s);
        c.fillText(fmtNum(k * L), leftSide ? o.ox - 7 / s : o.ox + 7 / s, Y);
      }
      c.font = `italic ${15 / s}px ${FONT}`;
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.fillText('y', o.ox + 8 / s, top);
      c.font = `${fs}px ${FONT}`;
    }
    if (hasX && hasY) {
      c.textAlign = 'right';
      c.textBaseline = 'top';
      c.fillText('0', o.ox - 4 / s, o.oy + 4 / s);
    }
    c.restore();
    c.strokeStyle = P.plotFrame;
    c.lineWidth = 1.2 / s;
    c.strokeRect(o.x, o.y, o.w, o.h);
  }

  function drawStroke(c, o) {
    const p = o.pts;
    if (!p || p.length < 2) return;
    c.save();
    c.strokeStyle = c.fillStyle = tc(o.color);
    c.lineWidth = o.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (o.marker) {
      c.globalAlpha = paintDark ? 0.34 : 0.42;
      if (!paintDark) c.globalCompositeOperation = 'multiply';
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

  function traceCurve(c, o) {
    const segs = curveBeziers(o.pts, o.closed);
    if (!segs.length) return false;
    c.moveTo(segs[0][0][0], segs[0][0][1]);
    for (const [, b, d, e] of segs) c.bezierCurveTo(b[0], b[1], d[0], d[1], e[0], e[1]);
    if (o.closed) c.closePath();
    return true;
  }
  function drawCurve(c, o) {
    c.save();
    c.strokeStyle = tc(o.color);
    c.lineWidth = o.w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    if (traceCurve(c, o)) {
      if (o.fill && o.closed) {
        c.fillStyle = hexA(tc(o.color), 0.16);
        c.fill();
      }
      c.stroke();
    }
    c.restore();
  }

  function drawPoint(c, o) {
    c.save();
    c.fillStyle = tc(o.color);
    c.strokeStyle = PAL().paper;
    c.lineWidth = o.r * 0.45;
    c.beginPath();
    c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    c.stroke();
    c.fill();
    c.restore();
  }

  function drawShape(c, o) {
    const { x1, y1, x2, y2 } = o;
    const col = tc(o.color);
    c.save();
    c.strokeStyle = col;
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
      c.fillStyle = hexA(col, 0.16);
      c.fill();
    }
    c.stroke();
    c.restore();
  }

  function drawText(c, o) {
    c.save();
    c.fillStyle = tc(o.color);
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
      c.fillStyle = PAL().placeholder;
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
  // Где рисовать график: на своей координатной плоскости или на фоне «Координаты»
  function graphFrame(o, lookup) {
    if (o.plot) {
      const pl = lookup(o.plot);
      if (!pl || pl.type !== 'plot') return null;
      return { ox: pl.ox, oy: pl.oy, unit: plotUnit(pl), clip: { x: pl.x, y: pl.y, w: pl.w, h: pl.h } };
    }
    return { ox: 0, oy: 0, unit: G, clip: null };
  }
  let plotSource = new Map();

  function drawGraph(c, o, v) {
    const g = graphFn(o.expr);
    const fr = graphFrame(o, (id) => plotSource.get(id));
    if (!g.f || !fr) return;
    const f = g.f;
    const step = 1.5 / v.s;
    const cl = fr.clip;
    const x0 = cl ? Math.max(v.x, cl.x) : v.x;
    const x1 = cl ? Math.min(v.x + v.w, cl.x + cl.w) : v.x + v.w;
    if (x1 <= x0) return;
    const span = cl ? cl.h : v.h;
    const top = (cl ? cl.y : v.y) - span * 3, bottom = (cl ? cl.y + cl.h : v.y + v.h) + span * 3;
    c.save();
    if (cl) {
      c.beginPath();
      c.rect(cl.x, cl.y, cl.w, cl.h);
      c.clip();
    }
    c.strokeStyle = tc(o.color);
    c.lineWidth = o.w;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    let pen = false;
    let prevY = 0;
    for (let X = x0 - step; X <= x1 + step; X += step) {
      const Y = fr.oy - f((X - fr.ox) / fr.unit) * fr.unit;
      if (!Number.isFinite(Y) || Y < top || Y > bottom) {
        pen = false;
        continue;
      }
      if (pen && Math.abs(Y - prevY) > span) pen = false;
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
    const yMin = cl ? Math.max(cl.y, v.y) + 26 / v.s : v.y + 90 / v.s;
    const yMax = cl ? Math.min(cl.y + cl.h, v.y + v.h) - 14 / v.s : v.y + v.h - 90 / v.s;
    const xStart = cl ? x1 - 16 / v.s : x1 - 90 / v.s;
    const xEnd = cl ? x0 + 60 / v.s : x0 + 140 / v.s;
    for (let X = xStart; X > xEnd; X -= 10 / v.s) {
      const Y = fr.oy - f((X - fr.ox) / fr.unit) * fr.unit;
      if (Number.isFinite(Y) && Y > yMin && Y < yMax) {
        const txt = 'y = ' + MathParse.pretty(o.expr);
        c.font = `italic ${fs}px ${FONT}`;
        c.textAlign = 'right';
        c.textBaseline = 'bottom';
        c.lineWidth = 4 / v.s;
        c.strokeStyle = cl ? PAL().plotPaper : PAL().halo;
        c.strokeText(txt, X - 6 / v.s, Y - 6 / v.s);
        c.fillStyle = tc(o.color);
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
      case 'curve':
        return drawCurve(c, o);
      case 'point':
        return drawPoint(c, o);
      case 'shape':
        return drawShape(c, o);
      case 'text':
        return drawText(c, o);
      case 'image':
        return drawImageObj(c, o);
      case 'plot':
        return drawPlot(c, o, v);
      case 'graph':
        return drawGraph(c, o, v);
      // формулы рисуются отдельным слоем (KaTeX)
    }
  }

  // v: { x, y, w, h, s } в единицах доски; pr — плотность пикселей
  function renderScene(c, pg, v, pr, objs, dark) {
    paintDark = dark;
    plotSource = new Map();
    for (const o of objs) if (o.type === 'plot') plotSource.set(o.id, o);
    c.setTransform(pr, 0, 0, pr, 0, 0);
    drawBackground(c, pg.bg, v, v.w * v.s, v.h * v.s);
    c.setTransform(pr * v.s, 0, 0, pr * v.s, -v.x * v.s * pr, -v.y * v.s * pr);
    for (const o of objs) drawObject(c, o, v);
  }

  function render() {
    const pg = page();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!pg) {
      paintDark = isDark();
      ctx.fillStyle = PAL().paper;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const v = viewRect();
    const objs = objectsForRender(pg);
    renderScene(ctx, pg, v, DPR, objs, isDark());
    const t = now();
    for (const [id, l] of live) {
      if (t - l.at > 15000) live.delete(id);
      else if (l.page === pg.id) drawObject(ctx, l.obj, v);
    }
    if (current) drawObject(ctx, current, v);
    if (curveDraft) drawCurveDraft(v);

    // формулы обновляем раньше рамки выделения: её размер берётся из них
    syncMath(pg);
    // экранные элементы
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSelection();
    drawBoxSelect();
    drawCurveMarkers();
    drawLasers(pg.id);
    drawCursors(pg.id);
    drawEraserRing();
    if (textState) positionTextEditor();
    $('zoomLabel').textContent = Math.round(cam.s * 100) + '%';
  }

  function drawCurveDraft(v) {
    const pts = curveDraft.pts;
    if (curveHover) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      drawCurve(ctx, { ...curveDraft, pts: [...pts, curveHover.x, curveHover.y] });
      ctx.restore();
    }
    if (pts.length >= 4) drawCurve(ctx, curveDraft);
  }
  function drawCurveMarkers() {
    if (!curveDraft) return;
    const pts = curveDraft.pts;
    ctx.save();
    for (let i = 0; i < pts.length; i += 2) {
      const p = toScreen(pts[i], pts[i + 1]);
      ctx.fillStyle = i === 0 ? PAL().sel : PAL().paper;
      ctx.strokeStyle = PAL().sel;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function handleRect(b) {
    if (!b) return null;
    const p = toScreen(b.x + b.w, b.y + b.h);
    return { x: p.x + 4 - 6, y: p.y + 4 - 6, w: 12, h: 12 };
  }

  function drawSelection() {
    if (!selected.size) return;
    const pg = page();
    const P = PAL();
    ctx.save();
    ctx.strokeStyle = P.sel;
    ctx.lineWidth = 1;
    // подсветка графиков (у них нет рамки)
    for (const o of objectsForRender(pg)) {
      if (selected.has(o.id) && o.type === 'graph') {
        ctx.save();
        ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, -cam.x * cam.s * DPR, -cam.y * cam.s * DPR);
        drawGraph(ctx, { ...o, color: P.selSoft, w: o.w + 8 / cam.s }, viewRect());
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
      ctx.fillStyle = P.paper;
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
    ctx.fillStyle = PAL().box;
    ctx.strokeStyle = PAL().boxLine;
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
    ctx.strokeStyle = PAL().ring;
    ctx.fillStyle = PAL().ringFill;
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
      const col = tc(o.color);
      const key = `${o.x}|${o.y}|${o.size}|${col}`;
      if (e.key !== key) {
        e.el.style.left = o.x + 'px';
        e.el.style.top = o.y + 'px';
        e.el.style.fontSize = o.size + 'px';
        e.el.style.color = col;
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
      laser: 'crosshair', text: 'text', math: 'copy', graph: 'copy', point: 'crosshair', curve: 'crosshair', plot: 'crosshair',
    };
    canvas.style.cursor = spaceDown ? 'grab' : map[tool] || 'crosshair';
  }

  function snap(p) {
    return snapOn ? { x: Math.round(p.x / G) * G, y: Math.round(p.y / G) * G } : p;
  }
  const snapG = (p) => ({ x: Math.round(p.x / G) * G, y: Math.round(p.y / G) * G });

  // Куда «прилипает» точка: к уже поставленным точкам, к узлам сетки
  function pointTargets() {
    const res = [];
    for (const o of objectsForRender(page())) {
      if (o.type === 'point') res.push({ x: o.x, y: o.y });
      else if (o.type === 'stroke') {
        // точки, поставленные карандашом (маленькие штрихи)
        const b = bounds(o);
        if (b && Math.max(b.w, b.h) < Math.max(14 / cam.s, o.w * 3.5)) res.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      }
    }
    return res;
  }
  function gridNode(wp) {
    const pl = plotAt(wp);
    if (pl) return { x: pl.ox + Math.round((wp.x - pl.ox) / pl.cell) * pl.cell, y: pl.oy + Math.round((wp.y - pl.oy) / pl.cell) * pl.cell };
    if (page().bg === 'blank') return null;
    return snapG(wp);
  }
  function magnet(wp, soft) {
    const tolW = 10 / cam.s;
    let best = null, bd = tolW;
    for (const t of pointTargets()) {
      const d = Math.hypot(t.x - wp.x, t.y - wp.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) return best;
    const n = gridNode(wp);
    if (n && (snapOn || (soft && Math.hypot(n.x - wp.x, n.y - wp.y) < 8 / cam.s))) return n;
    return wp;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerdown', () => voice.unlock(), true);

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
      case 'graph': {
        const pl = plotAt(wp);
        if (pl) openGraphModal({ plot: pl });
        else if (page().bg === 'coord') openGraphModal({ page: true });
        else openGraphModal({ newPlotAt: wp });
        break;
      }
      case 'point': {
        const p = magnet(wp, true);
        doAdd([{ id: uid(), type: 'point', x: r1(p.x), y: r1(p.y), r: r2(Math.max(3, WIDTHS[widthIdx] + 2.5) / cam.s), color }]);
        break;
      }
      case 'curve':
        curveClick(wp);
        break;
      case 'plot':
        startPlot(wp);
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
    if (curveDraft && onCanvas && !action) {
      curveHover = magnet(wp, false);
      requestRender();
    }
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
      case 'plot':
        movePlot(wp, e.shiftKey);
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
      case 'plot':
        finishPlot(a);
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
    if (curveDraft) curveHover = null;
    if (tool === 'eraser' || curveDraft) requestRender();
  });

  function cancelAction() {
    if (!action) return;
    if ((action.kind === 'stroke' || action.kind === 'shape' || action.kind === 'plot') && current) {
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
    sendLiveObj(current);
  }
  function sendLiveObj(o) {
    const t = now();
    if (t - lastLiveSend > 50) {
      lastLiveSend = t;
      send({ t: 'live', page: pageId, id: o.id, obj: o });
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

  // ----- координатная плоскость -----
  function originFor(x, y, w, h, cell, cells, mode) {
    const u = Math.max(cell, cell * cells);
    const cx = x + Math.round(w / 2 / cell) * cell, cy = y + Math.round(h / 2 / cell) * cell;
    switch (mode) {
      case 'corner':
        return { ox: x + Math.ceil(u / cell) * cell, oy: y + h - Math.ceil(u / cell) * cell };
      case 'left':
        return { ox: x + Math.ceil(u / cell) * cell, oy: cy };
      case 'bottom':
        return { ox: cx, oy: y + h - Math.ceil(u / cell) * cell };
      default:
        return { ox: cx, oy: cy };
    }
  }
  function makePlot(x, y, w, h, cells = 1, mode = 'center') {
    const o = originFor(x, y, w, h, G, cells, mode);
    return { id: uid(), type: 'plot', x: r1(x), y: r1(y), w: r1(w), h: r1(h), ox: r1(o.ox), oy: r1(o.oy), cell: G, cells, om: mode };
  }
  function startPlot(wp) {
    const p = snapG(wp);
    action = { kind: 'plot', x0: p.x, y0: p.y, moved: false };
    current = makePlot(p.x, p.y, 0, 0);
  }
  function movePlot(wp, shift) {
    const p = snapG(wp);
    let dx = p.x - action.x0, dy = p.y - action.y0;
    if (shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (Math.sign(dx) || 1) * m;
      dy = (Math.sign(dy) || 1) * m;
    }
    const x = Math.min(action.x0, action.x0 + dx), y = Math.min(action.y0, action.y0 + dy);
    const w = Math.abs(dx), h = Math.abs(dy);
    if (w >= G || h >= G) action.moved = true;
    current = { ...makePlot(x, y, Math.max(w, G), Math.max(h, G)), id: current.id };
    sendLiveObj(current);
  }
  function finishPlot(a) {
    if (!current) return;
    let o = current;
    current = null;
    if (!a.moved || o.w < 4 * G || o.h < 4 * G) {
      // просто клик — плоскость стандартного размера вокруг точки
      const cw = 14 * G, ch = 10 * G;
      const x = a.moved ? o.x : a.x0 - cw / 2, y = a.moved ? o.y : a.y0 - ch / 2;
      o = { ...makePlot(x, y, Math.max(o.w, a.moved ? 4 * G : cw), Math.max(o.h, a.moved ? 4 * G : ch)), id: o.id };
    }
    doAdd([o]);
    setTool('select');
    selected.add(o.id);
    requestRender();
  }

  // ----- кривая по точкам -----
  let lastCurveClick = { t: 0, x: 0, y: 0 };
  function curveClick(wp) {
    const p = magnet(wp, false);
    const t = now();
    const sp = toScreen(p.x, p.y);
    const dbl = t - lastCurveClick.t < 350 && Math.hypot(sp.x - lastCurveClick.x, sp.y - lastCurveClick.y) < 8;
    lastCurveClick = { t, x: sp.x, y: sp.y };
    if (!curveDraft) {
      curveDraft = { id: uid(), type: 'curve', color, w: r2(WIDTHS[widthIdx] / cam.s), pts: [r1(p.x), r1(p.y)] };
      if (fillOn) curveDraft.fill = 1;
      return;
    }
    const pts = curveDraft.pts;
    const near = (x, y) => Math.hypot(p.x - x, p.y - y) * cam.s < 9;
    if (pts.length >= 6 && near(pts[0], pts[1])) {
      curveDraft.closed = 1;
      return finishCurve();
    }
    if (dbl || near(pts[pts.length - 2], pts[pts.length - 1])) return finishCurve();
    pts.push(r1(p.x), r1(p.y));
    send({ t: 'live', page: pageId, id: curveDraft.id, obj: curveDraft });
  }
  function finishCurve() {
    if (!curveDraft) return;
    const d = curveDraft;
    curveDraft = null;
    curveHover = null;
    if (d.pts.length >= 4) doAdd([d]);
    else send({ t: 'live-end', id: d.id });
    requestRender();
  }
  function cancelCurve() {
    if (!curveDraft) return;
    send({ t: 'live-end', id: curveDraft.id });
    curveDraft = null;
    curveHover = null;
    requestRender();
  }

  // ----- ластик -----
  function eraseAlong(a, b) {
    const pg = page();
    const r = eraserRadius() / cam.s;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 2)));
    const hits = [];
    for (const o of pg.objects) {
      if (o.type === 'image' || o.type === 'plot') continue; // их удаляют через выделение
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
    if (snapOn || action.orig.some((o) => o.type === 'plot')) {
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
      if (!b) continue;
      // плоскость выделяется, только если рамка охватывает её целиком
      if (o.type === 'plot') {
        if (b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h) selected.add(o.id);
      } else if (intersects(b, box)) selected.add(o.id);
    }
  }

  canvas.addEventListener('dblclick', (e) => {
    if (!board || tool !== 'select') return;
    const wp = toWorld(e.clientX, e.clientY);
    const hit = pickObject(wp);
    if (!hit) return startText(wp);
    if (hit.type === 'text') startText(null, hit);
    else if (hit.type === 'math') openMathModal({ edit: hit });
    else if (hit.type === 'graph') openGraphModal({ edit: hit });
    else if (hit.type === 'plot') openGraphModal({ plot: hit });
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
    textEditor.style.color = adaptColor(st.color, isDark());
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
  const showModal = (id) => ($(id).hidden = false);
  const hideModal = (id) => ($(id).hidden = true);
  const anyModal = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
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

  // ----- графики и координатные плоскости -----
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
    graphHint.style.color = '';
    graphHint.textContent = graphHintText;
    if (!v) return true;
    try {
      MathParse.compile(v);
      return true;
    } catch (err) {
      graphHint.textContent = err.message;
      graphHint.style.color = 'var(--danger)';
      return false;
    }
  }
  graphInput.addEventListener('input', checkGraph);

  // target: { edit: график } | { plot: плоскость } | { page: true } | { newPlotAt: точка }
  let graphTarget = null;
  let graphEditId = null;
  function openGraphModal(target) {
    graphTarget = target;
    graphEditId = target.edit ? target.edit.id : null;
    graphInput.value = target.edit ? target.edit.expr : '';
    const plot = target.plot || (target.edit && target.edit.plot ? findPlotOnPage(target.edit.plot) : null);
    const showPlot = !!(plot || target.newPlotAt);
    $('plotSection').hidden = !showPlot;
    $('graphTitle').textContent = showPlot ? 'Координатная плоскость' : 'График функции';
    if (plot) {
      $('plotUnit').value = String(plot.cells);
      $('plotOrigin').value = plot.om || 'center';
    } else {
      $('plotUnit').value = '1';
      $('plotOrigin').value = 'center';
    }
    renderGraphList();
    checkGraph();
    showModal('graphModal');
    setTimeout(() => graphInput.focus(), 30);
  }
  function modalPlot() {
    if (!graphTarget) return null;
    if (graphTarget.plot) return findPlotOnPage(graphTarget.plot.id);
    if (graphTarget.edit && graphTarget.edit.plot) return findPlotOnPage(graphTarget.edit.plot);
    return null;
  }
  function renderGraphList() {
    const box = $('graphList');
    box.innerHTML = '';
    const pl = modalPlot();
    if (!pl) return;
    for (const g of page().objects.filter((o) => o.type === 'graph' && o.plot === pl.id)) {
      const row = document.createElement('div');
      row.className = 'graph-item';
      const dot = document.createElement('i');
      dot.style.background = adaptColor(g.color, isDark());
      const txt = document.createElement('span');
      txt.textContent = 'y = ' + MathParse.pretty(g.expr);
      txt.title = 'Изменить';
      txt.style.cursor = 'pointer';
      txt.onclick = () => {
        graphEditId = g.id;
        graphInput.value = g.expr;
        checkGraph();
        graphInput.focus();
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Удалить график';
      del.textContent = '×';
      del.onclick = () => {
        doRemove([g.id]);
        if (graphEditId === g.id) {
          graphEditId = null;
          graphInput.value = '';
        }
        renderGraphList();
      };
      row.append(dot, txt, del);
      box.append(row);
    }
  }
  // настройки плоскости применяются сразу
  function applyPlotSettings() {
    const pl = modalPlot();
    if (!pl) return;
    const cells = Number($('plotUnit').value) || 1;
    const om = $('plotOrigin').value;
    const o = originFor(pl.x, pl.y, pl.w, pl.h, pl.cell, cells, om);
    doUpdate([pl], [{ ...pl, cells, om, ox: r1(o.ox), oy: r1(o.oy) }]);
  }
  $('plotUnit').onchange = applyPlotSettings;
  $('plotOrigin').onchange = applyPlotSettings;

  function nextGraphColor(list) {
    return color === PALETTE[0] ? GRAPH_COLORS[list.length % GRAPH_COLORS.length] : color;
  }
  $('graphForm').onsubmit = (e) => {
    e.preventDefault();
    const expr = graphInput.value.trim().replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    if (!expr) return hideModal('graphModal');
    if (!checkGraph()) return;
    hideModal('graphModal');
    const pg = page();
    const w = r2(Math.max(2.5, WIDTHS[widthIdx]) / cam.s);
    if (graphEditId) {
      const cur = pg.objects.find((o) => o.id === graphEditId);
      if (cur && cur.expr !== expr) doUpdate([cur], [{ ...cur, expr }]);
    } else if (graphTarget.newPlotAt) {
      const p = snapG(graphTarget.newPlotAt);
      const pl = makePlot(p.x - 7 * G, p.y - 5 * G, 14 * G, 10 * G, Number($('plotUnit').value) || 1, $('plotOrigin').value);
      doAdd([pl, { id: uid(), type: 'graph', expr, color: nextGraphColor([]), w, plot: pl.id }]);
    } else {
      const pl = modalPlot();
      if (pl) {
        const list = pg.objects.filter((o) => o.type === 'graph' && o.plot === pl.id);
        doAdd([{ id: uid(), type: 'graph', expr, color: nextGraphColor(list), w, plot: pl.id }]);
      } else {
        if (pg.bg !== 'coord') setPageBg('coord');
        const v = viewRect();
        const originVisible = 0 > v.x + 60 / cam.s && 0 < v.x + v.w - 60 / cam.s && 0 > v.y + 80 / cam.s && 0 < v.y + v.h - 80 / cam.s;
        if (!originVisible) centerOn(0, 0);
        const list = pg.objects.filter((o) => o.type === 'graph' && !o.plot);
        doAdd([{ id: uid(), type: 'graph', expr, color: nextGraphColor(list), w }]);
      }
    }
    graphTarget = null;
    graphEditId = null;
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
  let curveHintShown = false;
  function setTool(t) {
    if (t === 'image') {
      $('imageFile').click();
      return;
    }
    commitText();
    if (t !== 'curve') finishCurve();
    tool = t;
    if (t !== 'select') selected.clear();
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    if (t === 'curve' && !curveHintShown) {
      curveHintShown = true;
      toast('Ставьте точки кликами — линия пройдёт ровно через них. Двойной клик или Enter — готово, клик по первой точке — замкнуть.', 6000);
    }
    if (t === 'plot') toast('Растяните прямоугольник — получится координатная плоскость. Просто клик — стандартный размер.', 4000);
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
    if (curveDraft) curveDraft.color = c;
    // перекрасить выделенное
    if (tool === 'select' && selected.size) {
      const before = originals().filter((o) => o.type !== 'image' && o.type !== 'plot');
      if (before.length) doUpdate(before, before.map((o) => ({ ...o, color: c })));
    }
    updateSwatches();
    requestRender();
  }
  const swatchEls = [];
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.className = 'swatch';
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
    const dark = isDark();
    let found = false;
    for (const [pc, b] of swatchEls) {
      b.style.background = adaptColor(pc, dark);
      const on = pc.toLowerCase() === c.toLowerCase();
      b.classList.toggle('active', on);
      found = found || on;
    }
    custom.classList.toggle('active', !found);
    custom.style.boxShadow = found ? '' : `0 0 0 2px ${adaptColor(c, dark)}`;
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
    toast(snapOn ? 'Фигуры и точки прилипают к узлам клеток' : 'Привязка к клеткам выключена', 1600);
  };
  $('undo').onclick = undo;
  $('redo').onclick = redo;

  // ----- участники и голос -----
  function setUsers(list) {
    users = list || [];
    renderUsers();
    voice.syncPeers(users);
    updateVoiceUI();
  }
  const ICON_HEADSET = '<svg viewBox="0 0 24 24"><path d="M4 15v-3a8 8 0 0116 0v3"/><path d="M4 14h3v6H4zM17 14h3v6h-3z"/></svg>';
  const ICON_MICOFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M9 9v2a3 3 0 005 2.2M15 9.5V6a3 3 0 00-6 0"/></svg>';
  function renderUsers() {
    const box = $('users');
    box.innerHTML = '';
    // сначала те, кто в голосовой связи
    const sorted = [...users].sort((a, b) => (b.voice ? 1 : 0) - (a.voice ? 1 : 0));
    const shown = sorted.slice(0, 6);
    for (const u of shown) {
      const a = document.createElement('span');
      a.className = 'avatar';
      a.dataset.uid = u.id;
      a.style.background = u.color;
      a.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
      a.title = u.name + (u.id === myUid ? ' (вы)' : '') + (u.voice ? (u.muted ? ' — микрофон выключен' : ' — в голосовой связи') : '');
      if (u.voice) {
        const badge = document.createElement('span');
        badge.className = 'badge' + (u.muted ? ' off' : '');
        badge.innerHTML = u.muted ? ICON_MICOFF : ICON_HEADSET;
        a.append(badge);
      }
      box.append(a);
    }
    if (users.length > 6) {
      const a = document.createElement('span');
      a.className = 'avatar more';
      a.textContent = '+' + (users.length - 6);
      a.title = users.slice(6).map((u) => u.name).join(', ');
      box.append(a);
    }
  }
  function updateVoiceUI() {
    const on = voice.isOn();
    $('voiceJoin').hidden = on;
    $('micBtn').hidden = !on;
    $('leaveBtn').hidden = !on;
    const muted = voice.isMuted();
    $('micBtn').classList.toggle('muted', muted);
    $('micBtn').title = muted ? 'Включить микрофон' : 'Выключить микрофон';
    const n = users.filter((u) => u.voice && u.id !== myUid).length;
    $('voiceJoin').title = n ? `Подключиться к голосовой связи (уже ${n})` : 'Подключиться к голосовой связи';
    $('voiceJoin').querySelector('span').textContent = n ? `Голос · ${n}` : 'Голос';
  }
  setInterval(() => {
    if (!voice.isOn()) return;
    for (const a of document.querySelectorAll('#users .avatar[data-uid]')) a.classList.toggle('speaking', voice.speaking(a.dataset.uid));
  }, 150);
  $('voiceJoin').onclick = () => voice.join();
  $('micBtn').onclick = () => voice.toggleMute();
  $('leaveBtn').onclick = () => voice.leave();

  // ================== Страницы и блокноты ==================
  function goToPage(id) {
    commitText();
    cancelCurve();
    if (pageId) pageCams.set(pageId, { ...cam });
    pageId = id;
    cam = pageCams.get(id) || defaultCam(page());
    selected.clear();
    drafts.clear();
    updatePageUI();
    requestRender();
  }
  function updatePageUI() {
    const pg = page();
    if (!pg) return;
    const nb = nbById(pg.nb);
    const list = nbPages(pg.nb);
    const i = list.indexOf(pg);
    $('nbName').textContent = (nb && nb.title) || 'Без названия';
    $('pageLabel').textContent = `${i + 1} / ${list.length}`;
    $('prevPage').disabled = i <= 0;
    $('nextPage').disabled = i >= list.length - 1;
    $('bgSelect').value = pg.bg;
  }
  function stepPage(d) {
    const pg = page();
    const list = nbPages(pg.nb);
    const i = list.indexOf(pg) + d;
    if (i >= 0 && i < list.length) goToPage(list[i].id);
  }
  $('prevPage').onclick = () => stepPage(-1);
  $('nextPage').onclick = () => stepPage(1);

  function addPage(nbId, afterPageId, bg) {
    const np = { id: uid(8), nb: nbId, bg: bg || 'grid', objects: [] };
    let index = board.pages.length;
    const after = afterPageId ? board.pages.findIndex((p) => p.id === afterPageId) : -1;
    if (after >= 0) index = after + 1;
    else {
      const last = nbPages(nbId).pop();
      if (last) index = board.pages.indexOf(last) + 1;
    }
    board.pages.splice(index, 0, np);
    send({ t: 'page-add', pageData: np, index });
    scheduleBackup();
    return np;
  }
  $('addPage').onclick = () => {
    if (!board) return;
    const pg = page();
    const np = addPage(pg.nb, pg.id, pg.bg);
    goToPage(np.id);
    toast('Новая страница', 1200);
  };
  function setPageBg(bg) {
    const pg = page();
    if (!pg || pg.bg === bg) return;
    pg.bg = bg;
    bump(pg.id);
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

  // ----- миниатюры страниц -----
  const thumbCache = new Map();
  function pageThumb(pg, w, h) {
    const holder = document.createElement('div');
    holder.className = 'thumb';
    let b = contentBounds(pg, (o) => (pg.id === pageId ? bounds(o) : estimateMath(o)));
    if (!b) b = pg.bg === 'coord' ? { x: -320, y: -200, w: 640, h: 400 } : { x: 0, y: 0, w: 640, h: 400 };
    const pad = Math.max(b.w, b.h) * 0.06 + 16;
    let bx = b.x - pad, by = b.y - pad, bw = b.w + 2 * pad, bh = b.h + 2 * pad;
    // подгоняем под пропорции карточки
    const aspect = w / h;
    if (bw / bh > aspect) {
      const nh = bw / aspect;
      by -= (nh - bh) / 2;
      bh = nh;
    } else {
      const nw = bh * aspect;
      bx -= (nw - bw) / 2;
      bw = nw;
    }
    const k = w / bw;
    const dark = isDark();
    const key = `${pageVer.get(pg.id) || 0}|${pg.bg}|${dark}|${w}x${h}`;
    let cached = thumbCache.get(pg.id);
    if (!cached || cached.key !== key) {
      const c = document.createElement('canvas');
      const pr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * pr);
      c.height = Math.round(h * pr);
      renderScene(c.getContext('2d'), pg, { x: bx, y: by, w: bw, h: bh, s: k }, pr, pg.objects, dark);
      cached = { key, src: c.toDataURL('image/png') };
      thumbCache.set(pg.id, cached);
      requestRender(); // вернуть основной холст к своей теме
    }
    const img = new Image();
    img.src = cached.src;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    holder.append(img);
    const maths = pg.objects.filter((o) => o.type === 'math');
    if (maths.length) {
      const layer = document.createElement('div');
      layer.className = 'tm';
      layer.style.transform = `translate(${-bx * k}px, ${-by * k}px) scale(${k})`;
      for (const o of maths) {
        const el = document.createElement('div');
        el.className = 'formula';
        el.style.cssText = `left:${o.x}px;top:${o.y}px;font-size:${o.size}px;color:${adaptColor(o.color, dark)}`;
        renderTex(el, o.tex);
        layer.append(el);
      }
      holder.append(layer);
    }
    return holder;
  }

  // ----- окно блокнотов -----
  let nbView = null; // { nb, focus }
  let flowCards = [];
  const overlay = $('nbOverlay');
  const ICON_PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';

  function openNotebooks() {
    if (!board) return;
    commitText();
    cancelCurve();
    const pg = page();
    nbView = { nb: pg.nb, focus: nbPages(pg.nb).indexOf(pg) };
    overlay.classList.remove('closing');
    overlay.hidden = false;
    renderShelf(true);
    renderFlow(true);
    setTimeout(() => {
      const act = $('nbShelf').querySelector('.nb-card.active');
      if (act) act.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }, 60);
  }
  function closeNotebooks(instant) {
    if (!nbView) return;
    nbView = null;
    if (instant) {
      overlay.hidden = true;
      $('nbFlow').innerHTML = '';
      return;
    }
    overlay.classList.add('closing');
    setTimeout(() => {
      if (nbView) return;
      overlay.hidden = true;
      overlay.classList.remove('closing');
      $('nbFlow').innerHTML = '';
      $('nbShelf').innerHTML = '';
    }, 240);
  }
  function refreshNotebooks() {
    if (!nbView) return;
    if (!nbById(nbView.nb)) nbView.nb = page().nb;
    nbView.focus = clamp(nbView.focus, 0, nbPages(nbView.nb).length);
    renderShelf(false);
    renderFlow(false);
  }
  $('nbBtn').onclick = openNotebooks;
  $('pageLabel').onclick = openNotebooks;
  $('nbClose').onclick = () => closeNotebooks();
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeNotebooks();
  });

  function renderShelf(animate) {
    const shelf = $('nbShelf');
    shelf.innerHTML = '';
    board.notebooks.forEach((nb, i) => {
      const card = document.createElement('button');
      card.className = 'nb-card' + (nb.id === nbView.nb ? ' active' : '');
      card.style.setProperty('--c', NB_COLORS[i % NB_COLORS.length]);
      card.style.animationDelay = animate ? i * 45 + 'ms' : '0ms';
      if (!animate) card.style.animation = 'none';
      const pages = nbPages(nb.id);
      const spine = document.createElement('div');
      spine.className = 'spine';
      const th = pageThumb(pages[0], 157, 84);
      const label = document.createElement('div');
      label.className = 'label';
      const t = document.createElement('b');
      t.textContent = nb.title || 'Без названия';
      const s = document.createElement('small');
      s.textContent = `${pages.length} ${plural(pages.length, 'страница', 'страницы', 'страниц')}`;
      label.append(t, s);
      card.append(th, spine, label);
      card.onclick = () => selectNotebook(nb.id);
      shelf.append(card);
    });
    const add = document.createElement('button');
    add.className = 'nb-card add';
    add.style.animationDelay = animate ? board.notebooks.length * 45 + 'ms' : '0ms';
    if (!animate) add.style.animation = 'none';
    add.innerHTML = ICON_PLUS + '<span>Новый блокнот</span>';
    add.onclick = newNotebook;
    shelf.append(add);
    const nb = nbById(nbView.nb);
    if (document.activeElement !== $('nbTitle')) $('nbTitle').value = nb ? nb.title : '';
    const n = nbPages(nbView.nb).length;
    $('nbCount').textContent = `${n} ${plural(n, 'страница', 'страницы', 'страниц')}`;
    $('nbDelete').hidden = board.notebooks.length <= 1;
  }
  function selectNotebook(id) {
    if (!nbView || nbView.nb === id) return;
    nbView.nb = id;
    const pg = page();
    nbView.focus = pg.nb === id ? nbPages(id).indexOf(pg) : 0;
    for (const c of $('nbShelf').querySelectorAll('.nb-card')) c.style.animation = 'none';
    renderShelf(false);
    renderFlow(true);
    const act = $('nbShelf').querySelector('.nb-card.active');
    if (act) act.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }
  function newNotebook() {
    const nb = { id: uid(8), title: `Блокнот ${board.notebooks.length + 1}` };
    const pg = { id: uid(8), nb: nb.id, bg: page() ? page().bg : 'grid', objects: [] };
    board.notebooks.push(nb);
    board.pages.push(pg);
    send({ t: 'nb-add', nb, pageData: pg, index: board.notebooks.length - 1 });
    scheduleBackup();
    nbView.nb = nb.id;
    nbView.focus = 0;
    renderShelf(false);
    const cards = $('nbShelf').querySelectorAll('.nb-card');
    const fresh = cards[board.notebooks.length - 1];
    if (fresh) {
      fresh.style.animation = '';
      fresh.style.animationDelay = '0ms';
      fresh.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    renderFlow(true);
    const ti = $('nbTitle');
    ti.focus();
    ti.select();
  }
  let nbTitleTimer;
  $('nbTitle').addEventListener('input', (e) => {
    if (!nbView) return;
    const nb = nbById(nbView.nb);
    if (!nb) return;
    nb.title = e.target.value.slice(0, 80);
    const idx = board.notebooks.indexOf(nb);
    const lbl = $('nbShelf').querySelectorAll('.nb-card')[idx];
    if (lbl) lbl.querySelector('b').textContent = nb.title || 'Без названия';
    updatePageUI();
    clearTimeout(nbTitleTimer);
    nbTitleTimer = setTimeout(() => {
      send({ t: 'nb-update', nb: { id: nb.id, title: nb.title } });
      scheduleBackup();
    }, 350);
  });
  $('nbTitle').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
  });
  $('nbDelete').onclick = () => {
    if (!nbView || board.notebooks.length <= 1) return;
    const nb = nbById(nbView.nb);
    const n = nbPages(nb.id).length;
    if (!confirm(`Удалить блокнот «${nb.title || 'Без названия'}» (${n} ${plural(n, 'страница', 'страницы', 'страниц')}) для всех участников? Отменить это нельзя.`)) return;
    const wasHere = page().nb === nb.id;
    board.notebooks = board.notebooks.filter((x) => x !== nb);
    board.pages = board.pages.filter((p) => p.nb !== nb.id);
    send({ t: 'nb-remove', nb: nb.id });
    scheduleBackup();
    if (wasHere) goToPage(nbPages(board.notebooks[0].id)[0].id);
    nbView.nb = page().nb;
    nbView.focus = nbPages(nbView.nb).indexOf(page());
    renderShelf(false);
    renderFlow(true);
  };

  function renderFlow(animate) {
    const flow = $('nbFlow');
    flow.innerHTML = '';
    const pages = nbPages(nbView.nb);
    const mobile = isMobile();
    const tw = mobile ? 250 : 360, th = mobile ? 160 : 230;
    flowCards = pages.map((pg, i) => {
      const card = document.createElement('button');
      card.className = 'page-card' + (pg.id === pageId ? ' current' : '');
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.append(pageThumb(pg, tw, th));
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = `Страница ${i + 1}`;
      card.append(sheet, cap);
      card.onclick = () => cardClick(i);
      flow.append(card);
      return card;
    });
    const add = document.createElement('button');
    add.className = 'page-card add';
    add.innerHTML = `<div class="sheet">${ICON_PLUS}<span>Новая страница</span></div><span class="cap">&nbsp;</span>`;
    add.onclick = () => cardClick(pages.length);
    flow.append(add);
    flowCards.push(add);
    // точки-индикаторы
    const dots = $('nbDots');
    dots.innerHTML = '';
    flowCards.forEach((_, i) => {
      const d = document.createElement('button');
      d.title = i < pages.length ? `Страница ${i + 1}` : 'Новая страница';
      d.onclick = () => setFocus(i);
      dots.append(d);
    });
    if (animate) {
      flowCards.forEach((c, i) => {
        const ad = Math.abs(i - nbView.focus);
        c.style.transition = 'none';
        c.style.opacity = '0';
        c.style.transform = cardTransform(i, nbView.focus) + ' translateY(46px) scale(.9)';
        c.dataset.delay = Math.min(ad, 6) * 55;
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          flowCards.forEach((c) => {
            c.style.transition = '';
            c.style.transitionDelay = c.dataset.delay + 'ms';
          });
          layoutFlow();
          setTimeout(() => flowCards.forEach((c) => (c.style.transitionDelay = '0ms')), 700);
        })
      );
    } else layoutFlow();
  }
  function cardTransform(i, f) {
    const d = i - f;
    const ad = Math.abs(d);
    const mobile = isMobile();
    const first = mobile ? 165 : 270, next = mobile ? 62 : 120;
    const x = d === 0 ? 0 : Math.sign(d) * (first + (ad - 1) * next);
    const z = d === 0 ? 40 : -110 - ad * 70;
    const ry = d === 0 ? 0 : -Math.sign(d) * 48;
    return `translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg)`;
  }
  function layoutFlow() {
    if (!nbView) return;
    const f = nbView.focus;
    flowCards.forEach((c, i) => {
      const ad = Math.abs(i - f);
      c.style.transform = cardTransform(i, f);
      c.style.opacity = ad > 5 ? '0' : String(1 - ad * 0.1);
      c.style.zIndex = String(100 - ad);
      c.style.filter = ad ? `brightness(${1 - Math.min(ad, 4) * 0.07})` : '';
      c.style.pointerEvents = ad > 5 ? 'none' : '';
      c.classList.toggle('focus', i === f);
    });
    [...$('nbDots').children].forEach((d, i) => d.classList.toggle('on', i === f));
    $('nbPrev').disabled = f <= 0;
    $('nbNext').disabled = f >= flowCards.length - 1;
  }
  function setFocus(i) {
    if (!nbView) return;
    nbView.focus = clamp(i, 0, flowCards.length - 1);
    layoutFlow();
  }
  let suppressClick = false;
  function cardClick(i) {
    if (suppressClick) return;
    if (i !== nbView.focus) return setFocus(i);
    openFlowCard(i);
  }
  function openFlowCard(i) {
    const pages = nbPages(nbView.nb);
    const card = flowCards[i];
    let target;
    if (i >= pages.length) {
      const last = pages[pages.length - 1];
      target = addPage(nbView.nb, last && last.id, last ? last.bg : 'grid');
    } else target = pages[i];
    if (card) {
      card.classList.add('opening');
      card.style.transform = cardTransform(i, i) + ' scale(1.12)';
    }
    setTimeout(() => {
      goToPage(target.id);
      closeNotebooks();
    }, 170);
  }
  $('nbPrev').onclick = () => setFocus(nbView.focus - 1);
  $('nbNext').onclick = () => setFocus(nbView.focus + 1);
  // листание колесом и свайпом
  let wheelAcc = 0;
  let wheelLock = 0;
  $('nbFlow').addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelAcc += d;
      const t = now();
      if (t < wheelLock) return;
      if (Math.abs(wheelAcc) > 40) {
        setFocus(nbView.focus + Math.sign(wheelAcc));
        wheelAcc = 0;
        wheelLock = t + 140;
      }
    },
    { passive: false }
  );
  let flowDrag = null;
  $('nbFlow').addEventListener('pointerdown', (e) => {
    flowDrag = { x: e.clientX, moved: false, id: e.pointerId };
    suppressClick = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!flowDrag || e.pointerId !== flowDrag.id || !nbView) return;
    const dx = e.clientX - flowDrag.x;
    if (Math.abs(dx) > 8) {
      flowDrag.moved = true;
      $('nbFlow').classList.add('dragging');
    }
    const stepPx = isMobile() ? 60 : 90;
    if (Math.abs(dx) > stepPx) {
      setFocus(nbView.focus - Math.sign(dx));
      flowDrag.x = e.clientX;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!flowDrag || e.pointerId !== flowDrag.id) return;
    if (flowDrag.moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 50);
    }
    $('nbFlow').classList.remove('dragging');
    flowDrag = null;
  });
  function notebookKeys(e) {
    if (document.activeElement === $('nbTitle')) return;
    const list = board.notebooks;
    const idx = list.findIndex((n) => n.id === nbView.nb);
    switch (e.key) {
      case 'Escape':
        closeNotebooks();
        break;
      case 'ArrowLeft':
        setFocus(nbView.focus - 1);
        break;
      case 'ArrowRight':
        setFocus(nbView.focus + 1);
        break;
      case 'ArrowUp':
        if (idx > 0) selectNotebook(list[idx - 1].id);
        break;
      case 'ArrowDown':
        if (idx < list.length - 1) selectNotebook(list[idx + 1].id);
        break;
      case 'Enter':
        openFlowCard(nbView.focus);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

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
    if (act === 'theme') {
      themeSetting = { auto: 'light', light: 'dark', dark: 'auto' }[themeSetting] || 'auto';
      store.set('wb:theme', themeSetting);
      applyTheme();
      return; // меню не закрываем, чтобы было удобно перебирать
    }
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
      const pg = page();
      const list = nbPages(pg.nb);
      if (list.length <= 1) return toast('Это единственная страница в блокноте');
      if (!confirm('Удалить эту страницу для всех участников? Отменить это нельзя.')) return;
      const i = list.indexOf(pg);
      board.pages.splice(board.pages.indexOf(pg), 1);
      send({ t: 'page-remove', page: pg.id });
      goToPage(list[i + 1 < list.length ? i + 1 : i - 1].id);
      scheduleBackup();
    }
  });

  // ================== Файлы, печать, копия в браузере ==================
  function saveToFile() {
    const data = JSON.stringify({ app: 'math-board', version: 2, title: board.title || '', notebooks: board.notebooks, pages: board.pages });
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
    // всё из файла добавляется новыми блокнотами — текущая доска не меняется
    const srcNbs = Array.isArray(data.notebooks) && data.notebooks.length ? data.notebooks : [{ id: '_', title: data.title || file.name.replace(/\.json$/i, '') }];
    let firstPage = null;
    for (const snb of srcNbs) {
      const pages = data.pages.filter((p) => p && Array.isArray(p.objects) && (srcNbs.length === 1 || p.nb === snb.id));
      if (!pages.length) continue;
      const nb = { id: uid(8), title: String(snb.title || 'Из файла').slice(0, 80) };
      const conv = pages.map((p) => ({
        id: uid(8), nb: nb.id, bg: BGS.includes(p.bg) ? p.bg : 'grid',
        objects: p.objects.filter((o) => o && typeof o.id === 'string' && o.type),
      }));
      board.notebooks.push(nb);
      board.pages.push(conv[0]);
      send({ t: 'nb-add', nb, pageData: conv[0], index: board.notebooks.length - 1 });
      for (const p of conv.slice(1)) {
        board.pages.push(p);
        send({ t: 'page-add', pageData: p, index: board.pages.length - 1 });
      }
      firstPage = firstPage || conv[0].id;
    }
    if (firstPage) {
      goToPage(firstPage);
      toast('Блокноты из файла добавлены в доску');
      scheduleBackup();
    }
  };

  function printBoard() {
    commitText();
    const area = $('printArea');
    area.innerHTML = '';
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
      const kx = el.querySelector('.katex');
      const rk = kx ? kx.getBoundingClientRect() : r;
      const top = Math.min(r.top, rk.top), bottom = Math.max(r.bottom, rk.bottom);
      measured.set(o.id, el);
      return { x: o.x, y: o.y + (top - r.top), w: r.width, h: bottom - top };
    };
    let printed = 0;
    const loads = [];
    // печатаем блокнот, в котором сейчас находимся
    for (const pg of nbPages(page().nb)) {
      const b = contentBounds(pg, measure);
      if (!b) continue;
      const pad = G;
      const bx = b.x - pad, by = b.y - pad, bw = b.w + 2 * pad, bh = b.h + 2 * pad;
      const q = Math.min(2, 4000 / bw, 4000 / bh);
      const c = document.createElement('canvas');
      c.width = Math.ceil(bw * q);
      c.height = Math.ceil(bh * q);
      renderScene(c.getContext('2d'), pg, { x: bx, y: by, w: bw, h: bh, s: q }, 1, pg.objects, false);
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
        el.style.cssText = `position:absolute;left:${o.x}px;top:${o.y}px;font-size:${o.size}px;color:${adaptColor(o.color, false)}`;
        if (!measured.has(o.id)) renderTex(el, o.tex);
        layer.append(el);
      }
      block.append(layer);
      area.append(block);
      printed++;
    }
    meas.remove();
    requestRender();
    if (!printed) return toast('В этом блокноте пока ничего нет');
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
      const data = { title: board.title || '', notebooks: board.notebooks, pages: board.pages, at: Date.now() };
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
  const KEYS = {
    v: 'select', h: 'hand', p: 'pen', m: 'marker', e: 'eraser', k: 'laser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse',
    y: 'triangle', c: 'plot', d: 'point', b: 'curve', t: 'text', f: 'math', g: 'graph',
  };
  window.addEventListener('keydown', (e) => {
    if (!board) return;
    if (nbView) return notebookKeys(e);
    if (isTyping() || anyModal()) return;
    // e.code не зависит от раскладки: русская «я» и английская «z» — одна клавиша
    const key = e.code && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (curveDraft && !mod) {
      if (e.key === 'Enter') return finishCurve();
      if (e.key === 'Escape') return cancelCurve();
      if (e.key === 'Backspace') {
        e.preventDefault();
        curveDraft.pts.splice(-2, 2);
        if (!curveDraft.pts.length) cancelCurve();
        return requestRender();
      }
    }
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
      duplicateSelection();
      return;
    }
    if (mod) return;
    if (e.key === ' ' && !spaceDown) {
      spaceDown = true;
      setCursor();
      e.preventDefault();
      return;
    }
    if (e.key === 'PageDown') return stepPage(1);
    if (e.key === 'PageUp') return stepPage(-1);
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

  function duplicateSelection() {
    const orig = originals();
    const plotIds = new Map();
    const copies = [];
    for (const o of orig) {
      if (o.type === 'graph' && o.plot) continue; // графики копируются вместе с плоскостью
      const c = { ...transformObj(o, (x) => x + G, (y) => y + G, 1), id: uid() };
      if (o.type === 'graph') continue;
      if (o.type === 'plot') plotIds.set(o.id, c.id);
      copies.push(c);
    }
    for (const g of page().objects) {
      if (g.type === 'graph' && plotIds.has(g.plot)) copies.push({ ...g, id: uid(), plot: plotIds.get(g.plot) });
    }
    if (!copies.length) return;
    doAdd(copies);
    selected.clear();
    copies.forEach((o) => o.type !== 'graph' && selected.add(o.id));
  }

  // ================== Запуск ==================
  window.addEventListener('resize', resize);
  // когда шрифты формул догрузились, размеры формул меняются — перерисовываем
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', requestRender);
    document.fonts.ready.then(requestRender);
  }
  resize();
  applyTheme();
  setTool('pen');
  updateUndoButtons();
  updateVoiceUI();
  if (!me.name) askName();
  connect();

  // для автоматических проверок
  window.__board = {
    get board() { return board; },
    get cam() { return cam; },
    get pageId() { return pageId; },
    get myUid() { return myUid; },
    voice,
    setTool,
  };
})();
