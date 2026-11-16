// Перед сборкой приложения копирует файлы доски в desktop/app
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['server.js', 'tunnel.js']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
console.log('Файлы доски скопированы в desktop/app');
