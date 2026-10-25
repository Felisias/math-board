// Голосовая связь между участниками доски (WebRTC, каждый с каждым).
// Сервер доски только передаёт служебные сообщения; звук идёт напрямую между браузерами.
(function () {
  'use strict';

  window.createVoice = function (api) {
    // api: send(msg), myUid(), users(), toast(text, ms), changed()
    let on = false;
    let muted = false;
    let local = null;
    let ice = null;
    let ctx = null;
    const peers = new Map(); // uid -> { pc, audio, chain, cands, goneAt }
    const meters = new Map(); // uid -> { an, data, level }
    const pendingPlay = new Set();
    const GRACE_MS = 8000; // сколько ждать человека, пропавшего из списка (переподключение)

    async function loadIce() {
      if (ice) return ice;
      try {
        const r = await fetch('/api/ice', { cache: 'no-store' });
        const j = await r.json();
        ice = Array.isArray(j.iceServers) ? j.iceServers : [];
      } catch {
        ice = [{ urls: 'stun:stun.l.google.com:19302' }];
      }
      return ice;
    }

    function audioCtx() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (C) ctx = new C();
      }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }

    function meter(uid, stream) {
      const c = audioCtx();
      if (!c || !stream) return;
      try {
        const src = c.createMediaStreamSource(stream);
        const an = c.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        meters.set(uid, { an, src, data: new Uint8Array(an.fftSize), level: 0 });
      } catch {
        /* без индикатора — не страшно */
      }
    }

    function level(uid) {
      const m = meters.get(uid);
      if (!m) return 0;
      m.an.getByteTimeDomainData(m.data);
      let s = 0;
      for (const v of m.data) {
        const d = (v - 128) / 128;
        s += d * d;
      }
      const rms = Math.sqrt(s / m.data.length);
      m.level = m.level * 0.55 + rms * 0.45;
      return m.level;
    }

    function speaking(uid) {
      if (!on) return false;
      if (uid === api.myUid()) return !muted && level('me') > 0.03;
      const u = api.users().find((x) => x.id === uid);
      if (!u || !u.voice || u.muted) return false;
      return level(uid) > 0.025;
    }

    async function join() {
      if (on) return;
      if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        api.toast('Этот браузер не поддерживает голосовую связь');
        return;
      }
      if (!window.isSecureContext) {
        api.toast('Голосовая связь работает только по защищённому адресу (https)');
        return;
      }
      audioCtx();
      try {
        local = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        local = null;
        api.toast('Нет доступа к микрофону — вы будете только слушать. Разрешите микрофон в настройках браузера.', 5000);
      }
      await loadIce();
      on = true;
      muted = !local;
      if (local) meter('me', local);
      api.send({ t: 'voice', voice: true, muted });
      api.changed();
      syncPeers(api.users());
    }

    function leave() {
      if (!on) return;
      on = false;
      for (const uid of [...peers.keys()]) closePeer(uid);
      if (local) local.getTracks().forEach((t) => t.stop());
      local = null;
      meters.delete('me');
      api.send({ t: 'voice', voice: false, muted: false });
      api.changed();
    }

    function toggleMute() {
      if (!on) return;
      if (!local) {
        api.toast('Микрофон недоступен — разрешите его в настройках браузера');
        return;
      }
      muted = !muted;
      local.getAudioTracks().forEach((t) => (t.enabled = !muted));
      api.send({ t: 'voice', voice: true, muted });
      api.changed();
    }

    // Список участников изменился: подключаемся к новым, отключаемся от ушедших
    function syncPeers(users) {
      if (!on) return;
      const me = api.myUid();
      const present = new Map(users.map((u) => [u.id, u]));
      const now = Date.now();
      for (const [uid, p] of peers) {
        const u = present.get(uid);
        if (u && !u.voice) closePeer(uid); // сам вышел из голоса
        else if (!u) {
          // пропал из списка — возможно, переподключается; ждём немного
          if (!p.goneAt) {
            p.goneAt = now;
            setTimeout(() => syncPeers(api.users()), GRACE_MS + 200);
          } else if (now - p.goneAt > GRACE_MS) closePeer(uid);
        } else p.goneAt = 0;
      }
      for (const u of users) {
        // звонит тот, у кого id меньше — так двое не позвонят друг другу одновременно
        if (u.voice && u.id !== me && !peers.has(u.id) && me < u.id) call(u.id);
      }
    }

    function createPeer(uid) {
      const pc = new RTCPeerConnection({ iceServers: ice || [] });
      const p = { uid, pc, audio: null, chain: Promise.resolve(), cands: [], goneAt: 0, warned: false };
      peers.set(uid, p);
      if (local) for (const t of local.getTracks()) pc.addTrack(t, local);
      else pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.onicecandidate = (e) => {
        if (e.candidate) api.send({ t: 'rtc', to: uid, cand: e.candidate.toJSON() });
      };
      pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
        if (!p.audio) {
          p.audio = document.createElement('audio');
          p.audio.autoplay = true;
          p.audio.setAttribute('playsinline', '');
          p.audio.style.display = 'none';
          document.body.append(p.audio);
        }
        p.audio.srcObject = stream;
        p.audio.play().catch(() => {
          pendingPlay.add(p.audio);
          api.toast('Нажмите в любом месте, чтобы включить звук');
        });
        meter(uid, stream);
        api.changed();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && !p.warned) {
          p.warned = true;
          const u = api.users().find((x) => x.id === uid);
          api.toast(`Не получилось соединиться голосом с «${u ? u.name : 'участником'}». Скорее всего, мешает сеть.`, 6000);
        }
        api.changed();
      };
      return p;
    }

    function call(uid) {
      const p = createPeer(uid);
      p.chain = p.chain
        .then(async () => {
          await p.pc.setLocalDescription(await p.pc.createOffer());
          api.send({ t: 'rtc', to: uid, desc: p.pc.localDescription.toJSON() });
        })
        .catch((err) => console.warn('voice offer', err));
    }

    function closePeer(uid) {
      const p = peers.get(uid);
      if (!p) return;
      peers.delete(uid);
      try {
        p.pc.close();
      } catch {
        /* ignore */
      }
      if (p.audio) {
        p.audio.srcObject = null;
        p.audio.remove();
      }
      meters.delete(uid);
      api.changed();
    }

    function signal(m) {
      if (!on || typeof m.from !== 'string') return;
      const uid = m.from;
      let p = peers.get(uid);
      if (m.desc && m.desc.type === 'offer') {
        if (p && p.pc.signalingState !== 'stable') {
          closePeer(uid);
          p = null;
        }
        if (!p) p = createPeer(uid);
      }
      if (!p) return;
      p.chain = p.chain
        .then(async () => {
          if (m.desc) {
            await p.pc.setRemoteDescription(m.desc);
            if (m.desc.type === 'offer') {
              await p.pc.setLocalDescription(await p.pc.createAnswer());
              api.send({ t: 'rtc', to: uid, desc: p.pc.localDescription.toJSON() });
            }
            for (const c of p.cands.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
          } else if (m.cand) {
            if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.cand).catch(() => {});
            else p.cands.push(m.cand);
          }
        })
        .catch((err) => console.warn('voice signal', err));
    }

    // браузер не дал включить звук без нажатия — включаем при первом нажатии
    function unlock() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      for (const a of pendingPlay) a.play().catch(() => {});
      pendingPlay.clear();
    }

    function peerStates() {
      return [...peers.values()].map((p) => ({ uid: p.uid, state: p.pc.connectionState }));
    }

    return {
      join, leave, toggleMute, signal, syncPeers, unlock, speaking, peerStates,
      isOn: () => on,
      isMuted: () => muted,
      hasMic: () => !!local,
    };
  };
})();
