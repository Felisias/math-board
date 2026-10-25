// Безопасный разбор выражений вида «x^2 - 2x + 1» для построения графиков.
// Без eval: выражение превращается в дерево функций.
(function (global) {
  'use strict';

  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
    cot: (x) => 1 / Math.tan(x), ctg: (x) => 1 / Math.tan(x),
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, arctg: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
    ln: Math.log, log: Math.log10, lg: Math.log10, log2: Math.log2,
    sign: Math.sign, sgn: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    cbrt: Math.cbrt,
  };
  const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };
  // имена ищем от длинных к коротким, чтобы «arcsin» не разобралось как «a r c sin»
  const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);

  function normalize(src) {
    return src
      .toLowerCase()
      .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/, '')
      .replace(/[−–—]/g, '-')
      .replace(/[×·∙]/g, '*')
      .replace(/[÷:]/g, '/')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/√/g, 'sqrt')
      .replace(/,/g, '.')
      .replace(/\*\*/g, '^');
  }

  function tokenize(src) {
    const s = normalize(src);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const num = Number(s.slice(i, j));
        if (!Number.isFinite(num)) throw new Error('Не понял число «' + s.slice(i, j) + '»');
        out.push({ k: 'num', v: num });
        i = j;
        continue;
      }
      if ('+-*/^()|'.includes(c)) { out.push({ k: c }); i++; continue; }
      const name = NAMES.find((n) => s.startsWith(n, i));
      if (name) {
        if (name === 'x') out.push({ k: 'x' });
        else if (name in CONSTS) out.push({ k: 'num', v: CONSTS[name] });
        else out.push({ k: 'fn', v: name });
        i += name.length;
        continue;
      }
      throw new Error('Непонятный символ «' + c + '»');
    }
    return out;
  }

  function compile(src) {
    const toks = tokenize(src);
    if (!toks.length) throw new Error('Пустое выражение');
    let p = 0;
    let absDepth = 0;
    const peek = () => toks[p];
    const eat = (k) => {
      const t = toks[p];
      if (!t || t.k !== k) throw new Error(k === ')' ? 'Не хватает закрывающей скобки' : 'Ошибка в выражении');
      p++;
      return t;
    };

    function startsPrimary(t) {
      if (!t) return false;
      if (t.k === '|') return absDepth === 0; // открывающий модуль
      return t.k === 'num' || t.k === 'x' || t.k === 'fn' || t.k === '(';
    }

    function expr() {
      let left = term();
      while (peek() && (peek().k === '+' || peek().k === '-')) {
        const op = toks[p++].k;
        const a = left, b = term();
        left = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
      }
      return left;
    }

    function term() {
      let left = unary();
      for (;;) {
        const t = peek();
        if (t && (t.k === '*' || t.k === '/')) {
          p++;
          const a = left, b = unary();
          left = t.k === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
        } else if (startsPrimary(t)) {
          // неявное умножение: 2x, 3(x+1), x sin(x)
          const a = left, b = power();
          left = (x) => a(x) * b(x);
        } else break;
      }
      return left;
    }

    function unary() {
      const t = peek();
      if (t && t.k === '-') { p++; const a = unary(); return (x) => -a(x); }
      if (t && t.k === '+') { p++; return unary(); }
      return power();
    }

    function power() {
      const base = primary();
      if (peek() && peek().k === '^') {
        p++;
        const e = unary();
        return (x) => Math.pow(base(x), e(x));
      }
      return base;
    }

    function primary() {
      const t = toks[p++];
      if (!t) throw new Error('Выражение оборвалось');
      if (t.k === 'num') { const v = t.v; return () => v; }
      if (t.k === 'x') return (x) => x;
      if (t.k === '(') { const e = expr(); eat(')'); return e; }
      if (t.k === '|') {
        absDepth++;
        const e = expr();
        absDepth--;
        eat('|');
        return (x) => Math.abs(e(x));
      }
      if (t.k === 'fn') {
        const f = FUNCS[t.v];
        let arg;
        if (peek() && peek().k === '(') { p++; arg = expr(); eat(')'); }
        else arg = power(); // sin x, sqrt x
        // sin^2(x) не поддерживаем — пишите (sin(x))^2
        return (x) => f(arg(x));
      }
      throw new Error('Ошибка в выражении');
    }

    const fn = expr();
    if (p < toks.length) {
      throw new Error(toks[p].k === ')' ? 'Лишняя закрывающая скобка' : 'Ошибка в выражении');
    }
    return fn;
  }

  // Красивая запись для подписи графика
  function pretty(src) {
    return src
      .replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
      .replace(/\*\*/g, '^')
      .replace(/\^2(?![0-9])/g, '²')
      .replace(/\^3(?![0-9])/g, '³')
      .replace(/\*/g, '·')
      .replace(/-/g, '−')
      .replace(/sqrt/g, '√')
      .replace(/pi/g, 'π')
      .trim();
  }

  global.MathParse = { compile, pretty };
})(window);
