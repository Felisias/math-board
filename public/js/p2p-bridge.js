// Страница-мост: держит прямые соединения WebRTC и не закрывается при переходах между досками.
// У учителя: каждое соединение ученика превращается в обычное подключение к серверу доски
// на этом компьютере. У ученика: передаёт сообщения между страницей доски и учителем.
(() => {
  'use strict';
  const bc = window.P2P._bus;
  if (!bc) return;

  // Только один мост на программу: если мост уже работает, новый экземпляр молчит
  let active = true;
  const myId = Math.random().toString(36).slice(2);
  bc.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.to !== 'bridges' || m.id === myId) return;
    if (m.q === 'who' && active) bc.postMessage({ to: 'bridges', id: myId, q: 'me' });
    if (m.q === 'me' && Date.now() - born < 1000) active = false;
  });
  const born = Date.now();
  bc.postMessage({ to: 'bridges', id: myId, q: 'who' });

  const EXTRA_STUN = [{ urls: 'stun:stun.sipnet.ru:3478' }, { urls: 'stun:stun.nextcloud.com:443' }];
  const CHUNK = 30000; // символов в одном куске (ограничение канала — 256 КБ)
  const HIGH_WATER = 2 * 1024 * 1024;

  let iceServers = null;
  async function loadIce() {
    if (iceServers) return iceServers;
    try {
      const j = await (await fetch('/api/ice', { cache: 'no-store' })).json();
      iceServers = [...(Array.isArray(j.iceServers) ? j.iceServers : []), ...EXTRA_STUN];
    } catch {
      iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, ...EXTRA_STUN];
    }
    return iceServers;
  }

  const rnd = (n = 8) => {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (const b of crypto.getRandomValues(new Uint8Array(n))) s += a[b % a.length];
    return s;
  };

  // Ждём, пока браузер соберёт адреса для соединения (они попадают прямо в код)
  function gathered(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let soft = 0;
      const done = () => {
        clearTimeout(soft);
        clearTimeout(hard);
        pc.removeEventListener('icegatheringstatechange', check);
        pc.removeEventListener('icecandidate', onCand);
        resolve();
      };
      const check = () => pc.iceGatheringState === 'complete' && done();
      const onCand = (e) => {
        // внешний адрес уже известен — ещё немного ждём остальные и хватит
        if (e.candidate && / typ srflx/.test(e.candidate.candidate) && !soft) soft = setTimeout(done, 1500);
      };
      const hard = setTimeout(done, 7000);
      pc.addEventListener('icegatheringstatechange', check);
      pc.addEventListener('icecandidate', onCand);
    });
  }

  // Канал: сообщения любого размера режутся на куски; кадр = «c|op|данные»
  function wire(dc, onFrame) {
    const queue = [];
    let acc = '';
    dc.bufferedAmountLowThreshold = 256 * 1024;
    function pump() {
      while (queue.length && dc.readyState === 'open' && dc.bufferedAmount < HIGH_WATER) {
        try {
          dc.send(queue.shift());
        } catch {
          return;
        }
      }
    }
    dc.onbufferedamountlow = pump;
    dc.onmessage = (e) => {
      const s = e.data;
      if (typeof s !== 'string' || !s) return;
      acc += s.slice(1);
      if (s[0] === '1') return;
      const frame = acc;
      acc = '';
      const i = frame.indexOf('|');
      const j = frame.indexOf('|', i + 1);
      if (i < 0 || j < 0) return;
      onFrame(frame.slice(0, i), frame.slice(i + 1, j), frame.slice(j + 1));
    };
    return (c, op, data = '') => {
      const frame = c + '|' + op + '|' + data;
      for (let p = 0; p < frame.length || p === 0; p += CHUNK) {
        queue.push((p + CHUNK < frame.length ? '1' : '0') + frame.slice(p, p + CHUNK));
      }
      pump();
    };
  }

  // =================== учитель ===================
  const sessions = new Map(); // n -> { n, num, board, title, pc, dc, send, state, code, conns: Map c -> ws }
  let counter = 0;

  function dropSession(s, state = 'closed') {
    if (!sessions.has(s.n)) return;
    sessions.delete(s.n);
    s.state = state;
    for (const ws of s.conns.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    s.conns.clear();
    try {
      s.pc.close();
    } catch {
      /* ignore */
    }
    announce();
  }

  async function hostOffer(m) {
    if (typeof m.board !== 'string' || !/^[a-z0-9]{6,20}$/.test(m.board)) return { error: 'bad' };
    // незавершённых приглашений держим немного
    const pending = [...sessions.values()].filter((s) => s.state === 'waiting');
    if (pending.length >= 6) dropSession(pending[0]);

    const pc = new RTCPeerConnection({ iceServers: await loadIce() });
    const dc = pc.createDataChannel('board', { ordered: true });
    const s = { n: rnd(6), num: ++counter, board: m.board, title: String(m.title || '').slice(0, 120), pc, dc, state: 'waiting', code: '', conns: new Map(), send: null };
    sessions.set(s.n, s);

    s.send = wire(dc, (c, op, data) => {
      if (op === 'o') {
        if (s.conns.size >= 8 || s.conns.has(c)) return s.send(c, 'x');
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const cid = /^[a-z0-9]{6,20}$/.test(data) ? data : '';
        const ws = new WebSocket(`${proto}://${location.host}/ws?board=${s.board}&cid=${cid}`);
        s.conns.set(c, ws);
        ws.onopen = () => s.send(c, 'O');
        ws.onmessage = (e) => typeof e.data === 'string' && s.send(c, 'm', e.data);
        ws.onclose = () => {
          if (s.conns.get(c) === ws) {
            s.conns.delete(c);
            s.send(c, 'x');
          }
        };
      } else if (op === 'm') {
        const ws = s.conns.get(c);
        if (ws && ws.readyState === 1) ws.send(data);
      } else if (op === 'x') {
        const ws = s.conns.get(c);
        s.conns.delete(c);
        if (ws) ws.close();
      }
    });
    dc.onopen = () => {
      s.state = 'connected';
      announce();
    };
    dc.onclose = () => dropSession(s);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropSession(s, s.state === 'connected' ? 'closed' : 'failed');
    };

    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    s.code = await P2P.encode({ k: 'o', n: s.n, b: s.board, t: s.title, s: pc.localDescription.sdp });
    announce();
    return { n: s.n, code: s.code };
  }

  async function hostAnswer(m) {
    const a = await P2P.decode(m.code);
    if (!a) return { error: 'badcode' };
    if (a.k !== 'a') return { error: 'notanswer' };
    const s = sessions.get(a.n);
    if (!s) return { error: 'unknown' };
    if (s.state !== 'waiting' || s.pc.remoteDescription) return { error: 'used' };
    try {
      await s.pc.setRemoteDescription({ type: 'answer', sdp: a.s });
    } catch {
      return { error: 'badcode' };
    }
    s.state = 'connecting';
    announce();
    // не соединилось за 25 секунд — сеть не пускает
    setTimeout(() => {
      if (sessions.get(s.n) === s && s.state === 'connecting') dropSession(s, 'failed');
    }, 25000);
    return { ok: true, n: s.n };
  }

  // =================== ученик ===================
  let link = null; // { board, title, pc, dc, send, state }
  let lastFail = null;

  function dropLink(state = 'closed') {
    if (!link) return;
    const l = link;
    link = null;
    lastFail = { board: l.board, title: l.title, state, wasConnected: l.state === 'connected' };
    try {
      l.pc.close();
    } catch {
      /* ignore */
    }
    for (const c of l.socks) bc.postMessage({ to: 'ui', ev: 'sock', c, op: 'close' });
    announce();
  }

  async function guestJoin(m) {
    const o = await P2P.decode(m.code);
    if (!o) return { error: 'badcode' };
    if (o.k !== 'o' || typeof o.b !== 'string' || !/^[a-z0-9]{6,20}$/.test(o.b)) return { error: 'notoffer' };
    if (link) dropLink();
    lastFail = null;
    const pc = new RTCPeerConnection({ iceServers: await loadIce() });
    const l = { board: o.b, title: String(o.t || ''), pc, dc: null, send: null, state: 'waiting', socks: new Set() };
    link = l;
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      l.dc = dc;
      l.send = wire(dc, (c, op, data) => {
        if (!l.socks.has(c)) return;
        if (op === 'O') bc.postMessage({ to: 'ui', ev: 'sock', c, op: 'open' });
        else if (op === 'm') bc.postMessage({ to: 'ui', ev: 'sock', c, op: 'msg', d: data });
        else if (op === 'x') {
          l.socks.delete(c);
          bc.postMessage({ to: 'ui', ev: 'sock', c, op: 'close' });
        }
      });
      dc.onopen = () => {
        l.state = 'connected';
        announce();
      };
      dc.onclose = () => link === l && dropLink();
      if (dc.readyState === 'open') dc.onopen();
    };
    pc.onconnectionstatechange = () => {
      if (link === l && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) dropLink(l.state === 'connected' ? 'closed' : 'failed');
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: o.s });
      await pc.setLocalDescription(await pc.createAnswer());
    } catch {
      if (link === l) dropLink('failed');
      return { error: 'badcode' };
    }
    await gathered(pc);
    const code = await P2P.encode({ k: 'a', n: o.n, s: pc.localDescription.sdp });
    announce();
    return { code, board: l.board, title: l.title };
  }

  // =================== общее ===================
  function snapshot() {
    return {
      sessions: [...sessions.values()].map((s) => ({ n: s.n, num: s.num, board: s.board, state: s.state, code: s.code })),
      link: link ? { board: link.board, title: link.title, state: link.state } : null,
      lastFail,
    };
  }
  function announce() {
    const st = snapshot();
    bc.postMessage({ to: 'ui', ev: 'state', ...st });
    const on = st.sessions.filter((s) => s.state === 'connected').length;
    const info = document.getElementById('info');
    if (info) info.textContent = st.link ? `Связь с учителем: ${st.link.state === 'connected' ? 'есть' : 'устанавливается'}.` : on ? `Подключено учеников: ${on}.` : 'Соединений нет.';
  }

  const ops = {
    status: async () => snapshot(),
    'host-offer': hostOffer,
    'host-answer': hostAnswer,
    'host-drop': async (m) => {
      const s = sessions.get(m.n);
      if (s) dropSession(s);
      return { ok: true };
    },
    'guest-join': guestJoin,
    'guest-leave': async () => {
      dropLink();
      lastFail = null;
      announce();
      return { ok: true };
    },
  };

  bc.addEventListener('message', async (e) => {
    const m = e.data;
    if (!active || !m || m.to !== 'bridge') return;
    if (m.op === 'sock-open') {
      if (!link || link.state !== 'connected' || link.board !== m.board) return bc.postMessage({ to: 'ui', ev: 'sock', c: m.c, op: 'close' });
      link.socks.add(m.c);
      return link.send(m.c, 'o', String(m.cid || ''));
    }
    if (m.op === 'sock-send') {
      if (link && link.socks.has(m.c) && typeof m.d === 'string') link.send(m.c, 'm', m.d);
      return;
    }
    if (m.op === 'sock-close') {
      if (link && link.socks.delete(m.c) && link.send) link.send(m.c, 'x');
      return;
    }
    const fn = ops[m.op];
    if (!fn || !m.rid) return;
    let res;
    try {
      res = await fn(m);
    } catch (err) {
      console.warn('p2p', m.op, err);
      res = { error: 'fail' };
    }
    bc.postMessage({ ...res, to: 'ui', rid: m.rid });
  });

  // при выходе из программы сразу сообщаем другой стороне
  window.addEventListener('pagehide', () => {
    for (const s of sessions.values()) {
      try {
        s.pc.close();
      } catch {
        /* ignore */
      }
    }
    if (link) {
      try {
        link.pc.close();
      } catch {
        /* ignore */
      }
    }
  });

  window.__bridge = { snapshot };
})();
