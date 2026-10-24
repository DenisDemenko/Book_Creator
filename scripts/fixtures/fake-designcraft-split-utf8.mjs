/**
 * Підставний `designcraft-cli`, який рве вивід ПОСЕРЕДИНІ символу.
 *
 * Справжній бінарник теж так робить — не зловмисно, а тому що потік
 * віддається чанками по довільній кількості байт, і двобайтова кирилиця
 * просто трапляється на межі. Відтворити це випадково не вийде, тож тут
 * розрив ставиться точно: на байті-продовженні (0x80..0xBF) усередині «м».
 *
 * Аргумент — скільки разів рвати (типово 1).
 */
const splits = Math.max(1, Number(process.argv[2] || 1));

const text = `Глава 1. Проба\n${'Земли и ее суеты, я нашел покой. '.repeat(400)}[[FLIMG:img1:BEGIN]]\n[[FLIMG:img1:END]]\nГлава 2. Проба\n`;
const buf = Buffer.from(JSON.stringify({ completed: 1, results: [{ text }] }), 'utf8');

// Позиції розривів — лише там, де байт є продовженням символу.
const cuts = [];
for (let n = 1; n <= splits; n += 1) {
  let p = Math.floor((buf.length * n) / (splits + 1));
  while (p < buf.length && (buf[p] & 0xc0) !== 0x80) p += 1;
  if (p < buf.length) cuts.push(p);
}
if (cuts.length !== splits) {
  process.stderr.write(`не знайшлося ${splits} розривів усередині символу\n`);
  process.exit(3);
}

// Кожен фрагмент — окремою подією `data`: між записами треба віддати цикл.
const parts = [];
let from = 0;
for (const c of [...cuts, buf.length]) { parts.push(buf.subarray(from, c)); from = c; }

for (const part of parts) {
  process.stdout.write(part);
  await new Promise((r) => setTimeout(r, 20));
}
