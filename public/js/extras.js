// Дополнения к доске: подсказки, чат, приглашение (в том числе при запуске со своего компьютера),
// импорт PDF и перетаскивание файлов.
(() => {
  'use strict';
  const WB = window.WB;
  if (!WB) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n[k] = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };

  // ================== Подсказки с горячими клавишами ==================
  const tip = el('div', { id: 'tip' });
  tip.hidden = true;
  document.body.append(tip);
  let tipTimer = 0;
  let tipEl = null;
  function hideTip() {
    clearTimeout(tipTimer);
    tip.hidden = true;
    tipEl = null;
  }
  function showTip(target) {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    const m = text.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    tip.innerHTML = '';
    tip.append(el('span', { text: m ? m[1] : text }));
    if (m) tip.append(el('kbd', { text: m[2] }));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x, y;
    if (target.closest('#toolbar') && window.innerWidth > 760) {
      x = r.right + 10;
      y = r.top + r.height / 2 - th / 2;
    } else {
      x = r.left + r.width / 2 - tw / 2;
      y = r.bottom + 8;
      if (y + th > window.innerHeight - 6) y = r.top - th - 8;
    }
    tip.style.left = Math.max(6, Math.min(x, window.innerWidth - tw - 6)) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const target = e.target.closest ? e.target.closest('[title],[data-tip]') : null;
    if (target === tipEl) return;
    hideTip();
    if (!target || target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
    if (target.title) {
      target.dataset.tip = target.title;
      target.removeAttribute('title');
    }
    tipEl = target;
    tipTimer = setTimeout(() => showTip(target), 450);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
  window.addEventListener('blur', hideTip);

  // ================== Справка ==================
  WB.on('help', () => WB.showModal('helpModal'));

  // ================== Чат ==================
  const panel = $('chatPanel');
  const list = $('chatList');
  const badge = $('chatBadge');
  let msgs = [];
  let unread = 0;
  let lastUid = null;

  function setUnread(n) {
    unread = n;
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
  }
  function linkify(text, into) {
    const re = /(https?:\/\/[^\s<>"']+)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) into.append(text.slice(last, m.index));
      into.append(el('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer', text: m[1] }));
      last = m.index + m[1].length;
    }
    if (last < text.length) into.append(text.slice(last));
  }
  function addMsg(m) {
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();
    const mine = m.uid === WB.myUid();
    const box = el('div', { class: 'msg' + (mine ? ' mine' : '') });
    if (m.uid !== lastUid) {
      const who = el('div', { class: 'who' });
      const name = el('b', { text: mine ? 'Вы' : m.name });
      name.style.color = WB.adaptColor(m.color);
      who.append(name, el('time', { text: new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }));
      box.append(who);
    }
    lastUid = m.uid;
    const txt = el('div', { class: 'txt' });
    linkify(m.text, txt);
    box.append(txt);
    list.append(box);
    list.scrollTop = list.scrollHeight;
  }
  function renderChat() {
    list.innerHTML = '';
    lastUid = null;
    if (!msgs.length) list.append(el('div', { class: 'empty', text: 'Сообщений пока нет. Чат пригодится, если у кого-то не работает звук.' }));
    for (const m of msgs) addMsg(m);
  }
  function openChat() {
    panel.hidden = false;
    setUnread(0);
    list.scrollTop = list.scrollHeight;
    if (window.innerWidth > 760) setTimeout(() => $('chatInput').focus(), 30);
  }
  $('chatBtn').onclick = () => (panel.hidden ? openChat() : (panel.hidden = true));
  $('chatClose').onclick = () => (panel.hidden = true);
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    if (!WB.ready()) return WB.toast('Нет связи с сервером — сообщение не отправлено');
    WB.send({ t: 'chat', text });
    $('chatInput').value = '';
  };
  $('chatInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') panel.hidden = true;
  });
  WB.on('init', (m) => {
    if (Array.isArray(m.chat)) {
      msgs = m.chat.slice();
      renderChat();
    }
  });
  WB.on('msg:chat', (m) => {
    if (!m.msg || msgs.some((x) => x.id === m.msg.id)) return;
    msgs.push(m.msg);
    addMsg(m.msg);
    if (panel.hidden && m.msg.uid !== WB.myUid()) {
      setUnread(unread + 1);
      WB.toast(`${m.msg.name}: ${m.msg.text.slice(0, 90)}`, 3500);
    }
  });
  renderChat();

  // ================== Приглашение ==================
  let host = { local: false };
  let pollTimer = 0;
  const boardPath = '/b/' + WB.boardId;

  async function loadHost() {
    try {
      const r = await fetch('/api/host', { cache: 'no-store' });
      host = await r.json();
    } catch {
      host = { local: false };
    }
  }
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Скопировано';
      setTimeout(() => (btn.textContent = old), 1400);
    }
  }
  function linkRow(url, primary) {
    const input = el('input', { readonly: '' });
    input.value = url;
    input.onfocus = () => input.select();
    const btn = el('button', { class: primary ? 'primary-btn' : 'secondary-btn', type: 'button', text: 'Копировать' });
    btn.onclick = () => copyText(url, btn);
    return el('div', { class: 'copy-row' }, input, btn);
  }
  async function tunnelCmd(action, provider) {
    try {
      await fetch('/api/host/tunnel', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-host-token': host.token },
        body: JSON.stringify({ action, provider }),
      });
    } catch {
      /* состояние покажет следующий опрос */
    }
    await loadHost();
    renderInvite();
  }
  function renderInvite() {
    const body = $('inviteBody');
    const keepProvider = body.querySelector('select') ? body.querySelector('select').value : 'cloudflare';
    body.innerHTML = '';
    clearTimeout(pollTimer);
    if (!host.local) {
      body.append(el('p', { class: 'hint', text: 'Все, у кого есть эта ссылка, могут рисовать на доске.' }), linkRow(location.origin + boardPath, true));
      return;
    }
    body.append(el('p', { class: 'hint', text: 'Доска запущена на этом компьютере. Она доступна другим, пока компьютер включён и программа открыта.' }));

    // --- через интернет ---
    const t = host.tunnel || { state: 'off' };
    const net = el('div', { class: 'inv-block' }, el('h5', { text: 'Через интернет' }));
    if (t.state === 'on') {
      net.append(
        el('p', { text: 'Отправьте эту ссылку ученику. Адрес временный: после перезапуска он будет другим.' }),
        linkRow(t.url + boardPath, true)
      );
      const off = el('button', { class: 'link-btn', type: 'button', text: 'Выключить доступ из интернета' });
      off.onclick = () => tunnelCmd('stop');
      net.append(el('p', {}, off));
    } else if (t.state === 'starting' || t.state === 'downloading') {
      net.append(
        el('div', { class: 'wait' }, el('span', { class: 'spinner' }),
          el('span', { text: t.state === 'downloading' ? 'Скачиваю программу-туннель (один раз, около 40 МБ)…' : 'Подключаю…' }))
      );
      const cancel = el('button', { class: 'link-btn', type: 'button', text: 'Отменить' });
      cancel.onclick = () => tunnelCmd('stop');
      net.append(el('p', {}, cancel));
      pollTimer = setTimeout(async () => {
        await loadHost();
        if (!$('inviteModal').hidden) renderInvite();
      }, 1000);
    } else {
      net.append(el('p', { text: 'Создаёт временный защищённый адрес, по которому доска открывается из любой сети. Голосовая связь работает только по такой ссылке.' }));
      if (t.state === 'error' && t.error) net.append(el('p', { class: 'err', text: t.error }));
      const sel = el('select', {},
        el('option', { value: 'cloudflare', text: 'Cloudflare (основной)' }),
        el('option', { value: 'lhr', text: 'localhost.run (запасной)' }));
      sel.value = keepProvider;
      const on = el('button', { class: 'primary-btn', type: 'button', text: 'Включить' });
      on.onclick = () => tunnelCmd('start', sel.value);
      net.append(el('div', { class: 'row' }, sel, on));
    }
    body.append(net);

    // --- в локальной сети ---
    const lan = el('div', { class: 'inv-block' }, el('h5', { text: 'В этой сети (тот же Wi-Fi)' }));
    if (host.lan && host.lan.length) {
      lan.append(el('p', { text: 'Работает без интернета для устройств в одной сети с вами. Если Windows спросит про доступ к сети — разрешите.' }));
      for (const u of host.lan) lan.append(linkRow(u + boardPath, false));
    } else lan.append(el('p', { text: 'Компьютер сейчас не подключён к сети.' }));
    body.append(lan);
  }
  $('invite').onclick = async () => {
    await loadHost();
    renderInvite();
    WB.showModal('inviteModal');
    const first = $('inviteBody').querySelector('input');
    if (first && !host.local) setTimeout(() => first.select(), 30);
  };

  // ================== Импорт PDF и перетаскивание ==================
  let pdfBusy = false;
  async function importPdf(file) {
    if (pdfBusy) return;
    pdfBusy = true;
    try {
      WB.toast('Открываю PDF…', 60000);
      const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const n = Math.min(doc.numPages, 40);
      const pages = [];
      for (let i = 1; i <= n; i++) {
        WB.toast(`PDF: страница ${i} из ${n}…`, 60000);
        const pg = await doc.getPage(i);
        const base = pg.getViewport({ scale: 1 });
        const scale = Math.min(2.2, 1500 / Math.max(base.width, base.height));
        const vp = pg.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const c = canvas.getContext('2d');
        c.fillStyle = '#fff';
        c.fillRect(0, 0, canvas.width, canvas.height);
        await pg.render({ canvasContext: c, viewport: vp, canvas }).promise;
        pages.push({ src: canvas.toDataURL('image/jpeg', 0.82), w: canvas.width, h: canvas.height });
      }
      WB.addImagePages(pages, file.name.replace(/\.pdf$/i, ''));
      WB.toast(doc.numPages > n ? `Добавлены первые ${n} страниц из ${doc.numPages}` : `PDF добавлен отдельным блокнотом: ${n} стр.`, 4000);
    } catch (e) {
      console.warn('pdf', e);
      WB.toast('Не получилось открыть PDF. Возможно, файл повреждён или защищён паролем.', 5000);
    } finally {
      pdfBusy = false;
    }
  }
  WB.on('pdf', () => $('pdfFile').click());
  $('pdfFile').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importPdf(f);
  };

  const stage = $('stage');
  const dropHint = $('dropHint');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  stage.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropHint.hidden = false;
  });
  stage.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  stage.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.hidden = true;
  });
  stage.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropHint.hidden = true;
    for (const f of e.dataTransfer.files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) await importPdf(f);
      else if (f.type.startsWith('image/')) await WB.addImageFile(f);
    }
  });
  // чтобы случайно брошенный мимо файл не открылся вместо доски
  window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  window.addEventListener('drop', (e) => hasFiles(e) && e.preventDefault());
})();
