// Простой ввод формул: «x^2/3», «sqrt(x+1)», «a <= b» превращаются в LaTeX.
// Готовый LaTeX (\frac{a}{b} и т. п.) проходит без изменений, их можно смешивать.
(function (global) {
  'use strict';

  const FUNCS = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', tg: '\\operatorname{tg}', ctg: '\\operatorname{ctg}', cot: '\\cot',
    arcsin: '\\arcsin', arccos: '\\arccos', arctg: '\\operatorname{arctg}', arctan: '\\arctan',
    ln: '\\ln', lg: '\\lg', log: '\\log', lim: '\\lim', min: '\\min', max: '\\max', exp: '\\exp',
  };
  const NAMES = {
    pi: '\\pi', alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', delta: '\\delta', phi: '\\varphi', lambda: '\\lambda',
    mu: '\\mu', omega: '\\omega', theta: '\\theta', sigma: '\\sigma', inf: '\\infty', oo: '\\infty', Delta: '\\Delta',
  };
  const WORDS = [...Object.keys(FUNCS), ...Object.keys(NAMES), 'sqrt', 'root'].sort((a, b) => b.length - a.length);
  const SYMS = [
    ['<=>', '\\Leftrightarrow '], ['...', '\\dots '], ['<=', '\\le '], ['>=', '\\ge '], ['!=', '\\ne '], ['+-', '\\pm '],
    ['->', '\\to '], ['=>', '\\Rightarrow '], ['~=', '\\approx '], ['*', '\\cdot '],
    ['≤', '\\le '], ['≥', '\\ge '], ['≠', '\\ne '], ['±', '\\pm '], ['≈', '\\approx '], ['·', '\\cdot '], ['×', '\\times '],
    ['÷', '\\div '], ['π', '\\pi '], ['∞', '\\infty '], ['°', '^\\circ '], ['%', '\\%'], ['−', '-'], ['²', '^{2}'], ['³', '^{3}'],
  ];

  // читает сбалансированную группу, начиная с открывающей скобки
  function balanced(s, i, open, close) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') {
        j++;
        continue;
      }
      if (s[j] === open) depth++;
      else if (s[j] === close && --depth === 0) return j + 1;
    }
    return s.length;
  }

  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const rest = s.slice(i);
      let m;
      if (/\s/.test(c)) {
        while (i < s.length && /\s/.test(s[i])) i++;
        out.push({ k: 'ws' });
        continue;
      }
      if (c === '\\') {
        if ((m = rest.match(/^\\(left|right)\s*(\\[a-zA-Z]+|\\.|.)?/))) {
          out.push({ k: 'raw', v: m[0] });
          i += m[0].length;
          continue;
        }
        if ((m = rest.match(/^\\[a-zA-Z]+/))) {
          let j = i + m[0].length;
          while (s[j] === '{' || s[j] === '[') j = balanced(s, j, s[j], s[j] === '{' ? '}' : ']');
          let v = s.slice(i, j);
          if (j === i + m[0].length) v += ' ';
          out.push({ k: 'raw', v });
          i = j;
          continue;
        }
        out.push({ k: 'raw', v: s.slice(i, i + 2) });
        i += 2;
        continue;
      }
      if (c === '{') {
        const j = balanced(s, i, '{', '}');
        out.push({ k: 'raw', v: s.slice(i, j), braced: true });
        i = j;
        continue;
      }
      if ((m = rest.match(/^\d+(?:[.,]\d+)?/))) {
        out.push({ k: 'num', v: m[0].replace(',', '{,}') });
        i += m[0].length;
        continue;
      }
      if ((m = rest.match(/^[А-Яа-яЁё]+(?:[ ]+[А-Яа-яЁё]+)*[:.,!?]?/))) {
        const sp = s[i + m[0].length] === ' ' ? ' ' : '';
        out.push({ k: 'raw', v: `\\text{${m[0]}${sp}}` });
        i += m[0].length;
        continue;
      }
      if (/[a-zA-Z]/.test(c)) {
        const w = WORDS.find((x) => rest.startsWith(x));
        if (w) {
          out.push({ k: 'word', v: w });
          i += w.length;
        } else {
          out.push({ k: 'id', v: c });
          i++;
        }
        continue;
      }
      if (c === '√') {
        out.push({ k: 'word', v: 'sqrt' });
        i++;
        continue;
      }
      const sym = SYMS.find((x) => rest.startsWith(x[0]));
      if (sym) {
        out.push({ k: 'sym', v: sym[1] });
        i += sym[0].length;
        continue;
      }
      if ('/^_()'.includes(c)) out.push({ k: c });
      else out.push({ k: 'sym', v: c });
      i++;
    }
    return out;
  }

  function convertLine(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const skipWs = () => {
      while (toks[p] && toks[p].k === 'ws') p++;
    };
    const strip = (n) => (n.inner != null ? n.inner : n.braced ? n.tex.slice(1, -1) : n.tex);

    function seq(inGroup) {
      let out = '';
      while (p < toks.length) {
        const t = toks[p];
        if (t.k === ')' && inGroup) break;
        if (t.k === 'ws') {
          out += ' ';
          p++;
          continue;
        }
        out += item().tex;
      }
      return out;
    }

    function item() {
      let left = factor();
      for (;;) {
        const save = p;
        skipWs();
        if (peek() && peek().k === '/') {
          p++;
          skipWs();
          if (!peek() || peek().k === ')') {
            left = { tex: left.tex + '/' };
            break;
          }
          const right = factor();
          left = { tex: `\\frac{${strip(left)}}{${strip(right)}}` };
        } else {
          p = save;
          break;
        }
      }
      return left;
    }

    function factor() {
      let base = atom();
      while (peek() && (peek().k === '^' || peek().k === '_')) {
        const op = toks[p++].k;
        let arg;
        if (peek() && peek().k === 'sym' && peek().v === '-') {
          p++;
          arg = { tex: '-' + (peek() ? strip(atom()) : '') };
        } else if (peek() && peek().k !== 'ws') arg = atom();
        else arg = { tex: '' };
        base = { tex: `${base.tex}${op}{${strip(arg)}}` };
      }
      return base;
    }

    function group() {
      p++; // (
      const inner = seq(true);
      if (peek() && peek().k === ')') p++;
      return { tex: `\\left(${inner}\\right)`, inner };
    }

    function atom() {
      const t = toks[p++];
      if (!t) return { tex: '' };
      switch (t.k) {
        case 'num':
        case 'id':
          return { tex: t.v };
        case 'raw':
          return { tex: t.v, braced: t.braced };
        case 'sym':
          return { tex: t.v };
        case '(':
          p--;
          return group();
        case 'word': {
          if (t.v === 'sqrt') {
            skipWs();
            const arg = peek() && peek().k !== ')' ? atom() : { tex: '' };
            return { tex: `\\sqrt{${strip(arg)}}` };
          }
          if (t.v === 'root') {
            const n = peek() && peek().k === '(' ? group() : { tex: '' };
            const x = peek() && peek().k === '(' ? group() : { tex: '' };
            return { tex: `\\sqrt[${strip(n)}]{${strip(x)}}` };
          }
          if (FUNCS[t.v]) {
            let tex = FUNCS[t.v];
            // степень функции: sin^2(x)
            while (peek() && (peek().k === '^' || peek().k === '_')) {
              const op = toks[p++].k;
              tex += `${op}{${peek() ? strip(atom()) : ''}}`;
            }
            if (peek() && peek().k === '(') tex += group().tex;
            else tex += ' ';
            return { tex };
          }
          return { tex: NAMES[t.v] + ' ' };
        }
        default:
          return { tex: t.k }; // одиночные / ^ _ )
      }
    }

    return seq(false).replace(/ {2,}/g, ' ').trim();
  }

  function toTex(src) {
    src = String(src || '').replace(/\r/g, '').trim();
    if (!src) return '';
    const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && !/\\begin\b/.test(src)) {
      return '\\begin{aligned} ' + lines.map((l) => '& ' + convertLine(l)).join(' \\\\ ') + ' \\end{aligned}';
    }
    return convertLine(lines.join(' '));
  }

  global.AsciiMath = { toTex };
})(typeof window !== 'undefined' ? window : globalThis);
