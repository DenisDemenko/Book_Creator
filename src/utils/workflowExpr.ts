/**
 * Умови вузла CONDITION (Т5.4 В1; ТЗ Graph Studio §16 «Confidence Routing»,
 * §39 №11 «поріг редагується без зміни коду»): маленька безпечна мова виразів
 * над станом процесу — без `eval` і без доступу до чогось, крім `state`.
 *
 *   state.confidence >= 0.7
 *   state.validation.ok && state.findings.length > 0
 *   !(state.output.reply == "") || state.input.force == true
 *
 * Оператори: `||`, `&&`, `!`, `==`, `!=`, `>`, `>=`, `<`, `<=`, дужки;
 * значення: числа, рядки в лапках, `true`, `false`, `null`, шляхи `state.…`
 * (`.length` масиву чи рядка). Модуль чистий: ним користуються і рушій, і
 * перевірка процесу в Graph Studio.
 */

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'lp' | 'rp' | 'dot'; v: string };

export type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; p: string[] }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr };

export class ExprError extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp', v: c }); i++; continue; }
    if (c === '.' && !/[0-9]/.test(src[i + 1] ?? '')) { out.push({ t: 'dot', v: c }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '>=', '<='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (['>', '<', '!'].includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) { s += src[j] === '\\' && j + 1 < src.length ? src[++j] : src[j]; j++; }
      if (j >= src.length) throw new ExprError('Незакриті лапки');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^-?(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num && (c !== '-' || !out.length || ['op', 'lp'].includes(out[out.length - 1].t))) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new ExprError(`Незрозумілий символ «${c}»`);
  }
  return out;
}

export function parseExpr(src: string): Expr {
  if (typeof src !== 'string' || !src.trim()) throw new ExprError('Порожня умова');
  if (src.length > 500) throw new ExprError('Умова — до 500 символів');
  const toks = lex(src);
  let pos = 0;
  const peek = () => toks[pos];
  const take = () => toks[pos++];
  const term = (): Expr => {
    const t = take();
    if (!t) throw new ExprError('Умова обривається');
    if (t.t === 'lp') {
      const e = or();
      if (take()?.t !== 'rp') throw new ExprError('Бракує «)»');
      return e;
    }
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v !== 'state') throw new ExprError(`Невідоме ім'я «${t.v}» — шлях починається з «state.»`);
      const p: string[] = [];
      while (peek()?.t === 'dot') {
        take();
        const n = take();
        if (n?.t !== 'id') throw new ExprError('Після «.» — ім\'я поля');
        if (['__proto__', 'constructor', 'prototype'].includes(n.v)) throw new ExprError(`Заборонене поле «${n.v}»`);
        p.push(n.v);
      }
      if (!p.length) throw new ExprError('Потрібне поле стану: state.<поле>');
      return { k: 'path', p };
    }
    throw new ExprError(`Неочікуване «${t.v}»`);
  };
  const not = (): Expr => (peek()?.t === 'op' && peek().v === '!' ? (take(), { k: 'not', e: not() }) : cmp());
  const cmp = (): Expr => {
    const a = term();
    const t = peek();
    if (t?.t === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.v)) {
      take();
      return { k: 'bin', op: t.v, a, b: term() };
    }
    return a;
  };
  const and = (): Expr => {
    let e = not();
    while (peek()?.t === 'op' && peek().v === '&&') { take(); e = { k: 'bin', op: '&&', a: e, b: not() }; }
    return e;
  };
  const or = (): Expr => {
    let e = and();
    while (peek()?.t === 'op' && peek().v === '||') { take(); e = { k: 'bin', op: '||', a: e, b: and() }; }
    return e;
  };
  const e = or();
  if (pos < toks.length) throw new ExprError(`Зайве «${toks[pos].v}»`);
  return e;
}

function lookup(state: unknown, p: string[]): unknown {
  let cur: unknown = state;
  for (const k of p) {
    if (cur == null) return undefined;
    if (k === 'length' && (Array.isArray(cur) || typeof cur === 'string')) { cur = (cur as { length: number }).length; continue; }
    if (typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function evalNode(e: Expr, state: unknown): unknown {
  switch (e.k) {
    case 'lit': return e.v;
    case 'path': return lookup(state, e.p);
    case 'not': return !evalNode(e.e, state);
    case 'bin': {
      if (e.op === '&&') return !!evalNode(e.a, state) && !!evalNode(e.b, state);
      if (e.op === '||') return !!evalNode(e.a, state) || !!evalNode(e.b, state);
      const a = evalNode(e.a, state);
      const b = evalNode(e.b, state);
      switch (e.op) {
        case '==': return a === b || (a == null && b == null);
        case '!=': return !(a === b || (a == null && b == null));
        default: {
          if (typeof a !== 'number' || typeof b !== 'number') return false;
          return e.op === '>' ? a > b : e.op === '>=' ? a >= b : e.op === '<' ? a < b : a <= b;
        }
      }
    }
  }
}

/** Обчислити умову над станом; помилка розбору — ExprError. */
export function evalCondition(src: string, state: unknown): boolean {
  return !!evalNode(parseExpr(src), state ?? {});
}

/** Для перевірки процесу: null — умова правильна, інакше текст помилки. */
export function exprError(src: unknown): string | null {
  try {
    parseExpr(String(src ?? ''));
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
