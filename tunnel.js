// Доступ к доске из интернета, когда она запущена на своём компьютере.
// Туннель даёт временный https-адрес, который ведёт на этот компьютер.
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function cloudflaredAsset() {
  const a = process.arch;
  if (process.platform === 'win32') {
    return { name: a === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe', exe: 'cloudflared.exe' };
  }
  if (process.platform === 'darwin') {
    return { name: a === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz', exe: 'cloudflared', tgz: true };
  }
  const m = { x64: 'amd64', arm64: 'arm64', arm: 'arm' }[a] || 'amd64';
  return { name: `cloudflared-linux-${m}`, exe: 'cloudflared' };
}

function createTunnel({ port, binDir }) {
  let child = null;
  let timer = null;
  let st = { state: 'off', provider: null, url: null, error: null };
  const set = (patch) => (st = { ...st, ...patch });

  async function ensureCloudflared() {
    if (process.env.CLOUDFLARED && fs.existsSync(process.env.CLOUDFLARED)) return process.env.CLOUDFLARED;
    const asset = cloudflaredAsset();
    const local = path.join(binDir, asset.exe);
    if (fs.existsSync(local)) return local;
    try {
      if (spawnSync('cloudflared', ['--version'], { windowsHide: true }).status === 0) return 'cloudflared';
    } catch {
      /* нет в системе — скачаем */
    }
    set({ state: 'downloading' });
    fs.mkdirSync(binDir, { recursive: true });
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.name}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Не удалось скачать программу-туннель (код ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (asset.tgz) {
      const tgz = path.join(binDir, asset.name);
      fs.writeFileSync(tgz, buf);
      const r = spawnSync('tar', ['-xzf', tgz, '-C', binDir]);
      fs.rmSync(tgz, { force: true });
      if (r.status !== 0 || !fs.existsSync(local)) throw new Error('Не удалось распаковать программу-туннель');
    } else {
      const tmp = local + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, local);
    }
    if (process.platform !== 'win32') fs.chmodSync(local, 0o755);
    return local;
  }

  async function start(provider = 'cloudflare') {
    if (['starting', 'downloading', 'on'].includes(st.state)) return st;
    set({ state: 'starting', provider, url: null, error: null });
    try {
      let cmd, args, re, readyRe;
      if (provider === 'lhr') {
        cmd = 'ssh';
        args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes',
          '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run'];
        re = /https:\/\/[a-z0-9-]+\.lhr\.life/;
      } else {
        cmd = await ensureCloudflared();
        if (st.state === 'off') return st; // пока качали — отменили
        set({ state: 'starting' });
        args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
        re = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
        readyRe = /Registered tunnel connection/;
      }
      const proc = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child = proc;
      let log = '';
      let url = null;
      const goOn = () => {
        if (child === proc && url && st.state === 'starting') set({ state: 'on', url });
      };
      const onData = (d) => {
        log = (log + d.toString()).slice(-6000);
        if (!url) {
          const m = log.match(re);
          if (m) {
            url = m[0];
            if (!readyRe) goOn();
            else setTimeout(goOn, 8000); // на случай, если строки готовности не будет
          }
        }
        if (url && readyRe && readyRe.test(log)) goOn();
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (e) => {
        if (child !== proc) return;
        child = null;
        clearTimeout(timer);
        set({
          state: 'error', url: null,
          error: e.code === 'ENOENT' && provider === 'lhr' ? 'На компьютере не найдена программа ssh' : 'Не удалось запустить туннель: ' + e.message,
        });
      });
      proc.on('exit', () => {
        if (child !== proc) return;
        child = null;
        clearTimeout(timer);
        if (st.state !== 'off') set({ state: 'error', url: null, error: 'Туннель закрылся. Проверьте интернет и включите его снова.' });
      });
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (child === proc && st.state === 'starting') {
          set({ state: 'error', error: 'Не получилось получить адрес за 45 секунд. Возможно, сеть блокирует этот способ.' });
          child = null;
          proc.kill();
        }
      }, 45000);
    } catch (e) {
      set({ state: 'error', url: null, error: e.message || String(e) });
    }
    return st;
  }

  function stop() {
    clearTimeout(timer);
    const proc = child;
    child = null;
    set({ state: 'off', url: null, error: null });
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
    return st;
  }

  return { start, stop, status: () => st };
}

module.exports = { createTunnel };
