import React, { useState } from 'react';
import { X, KeyRound, Loader2, ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';

interface GammaKeyModalProps {
  /** Причина недоступності від сервера — те саме, що показано під переліком. */
  reasonUk?: string;
  onClose: () => void;
  /** Викликається після успішного підключення: перелік рушіїв треба перепитати. */
  onConnected: () => void;
}

/**
 * Вікно підключення ВЛАСНОЇ підписки Gamma.
 *
 * ЧОМУ ВОНО ІСНУЄ ОКРЕМО ВІД ПАНЕЛІ GAMMA. Автор зустрічає Gamma не в її
 * панелі, а в переліку «Чим верстати»: обирає рушій — і впирається у
 * вимкнену кнопку. Досі причина лежала текстом під переліком, а поле для
 * ключа — на іншому екрані, тож шлях «хочу цей рушій → можу ним верстати»
 * автор мусив добудовувати сам. Вікно робить цей шлях одним кроком.
 *
 * ЧОМУ КЛЮЧ САМЕ ВЛАСНИЙ, А НЕ СТУДІЇ. Кожна генерація списує кредити з
 * рахунку власника ключа. Дати авторам ключ студії означало б платити за
 * них з чужого гаманця й без їхнього відома; тому ключ студії доступний
 * лише адміністраторові, і це перевірено тестами (`test:gamma`).
 *
 * ПРО ЧЕСНІСТЬ ФОРМУЛЮВАНЬ. Спокуса — написати «ключ у повній безпеці».
 * Нижче натомість сказано рівно те, що робить код: перевірка живим викликом
 * до збереження, AES-256-GCM у спокої, назад ключ не віддається ніколи —
 * і окремо те, чого код НЕ робить: сервер розшифровує ключ, щоб звернутись
 * до Gamma від імені автора. Обіцяти більше, ніж є, — гірше, ніж не
 * обіцяти нічого: на цьому будується рішення довірити нам чужі гроші.
 */
export const GammaKeyModal: React.FC<GammaKeyModalProps> = ({
  reasonUk,
  onClose,
  onConnected,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/gamma/key', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        // Сервер уже сходив у Gamma й знає, ЩО саме не так: не той ключ,
        // тариф без доступу до API, немає чим шифрувати. Його текст
        // конкретніший за будь-який наш загальний, тож показуємо його.
        throw new Error(data?.error || `Помилка ${res.status}`);
      }
      // Поле не лишаємо заповненим ні на мить: ключ уже на сервері, а тут
      // він більше не потрібен нікому — ні нам, ні випадковому погляду.
      setApiKey('');
      onConnected();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося підключити.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl glass-panel-elevated shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">Верстка рушієм Gamma</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Закрити"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <p className="text-xs leading-relaxed text-slate-300">
            Gamma верстає книгу на своєму боці, і працює вона на{' '}
            <span className="text-slate-100 font-semibold">вашій власній підписці</span>. Причина
            проста: кожна генерація списує кредити з рахунку власника ключа. Тому ключ студії
            авторам не видається — інакше ви витрачали б чужі гроші, а студія платила б за
            генерації, яких не замовляла.
          </p>

          {reasonUk && (
            <p className="text-[11px] leading-relaxed text-slate-500 border-l-2 border-slate-700 pl-3">
              {reasonUk}
            </p>
          )}

          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-emerald-200">Що буде з вашим ключем</span>
            </div>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-300">
              <li>
                <span className="text-slate-100">Перевіримо до збереження.</span> Сервер одразу
                зробить справжній виклик до Gamma. Неробочий ключ не збережеться взагалі — ви
                дізнаєтесь про помилку тут, а не на першій верстці.
              </li>
              <li>
                <span className="text-slate-100">Зберігаємо зашифрованим.</span> AES-256-GCM,
                окремий секрет саме для ключів авторів. У базі лежить шифротекст, не ключ.
              </li>
              <li>
                <span className="text-slate-100">Назад не віддаємо ніколи.</span> Жоден екран і
                жоден запит не повертають ключ — лише короткий відбиток, щоб ви впізнали, який
                саме підключено.
              </li>
              <li>
                <span className="text-slate-100">Відключення — одна кнопка.</span> Ключ
                видаляється, зроблені раніше матеріали лишаються вашими.
              </li>
            </ul>
            <p className="text-[11px] leading-relaxed text-slate-400 border-t border-emerald-500/15 pt-2">
              Чесно про межу: щоб звернутись до Gamma від вашого імені, сервер розшифровує ключ у
              момент виклику. Це захист від витоку бази, а не таємниця від самої студії. Якщо такий
              рівень не влаштовує — верстайте рушієм Nova, Chromium або pandoc: їм ключі не
              потрібні взагалі.
            </p>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs font-semibold text-amber-200">Перш ніж підключати</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              Доступ до API Gamma дають лише тарифи Pro, Ultra, Teams і Business — на
              безкоштовному ключ буває дійсним, а виклик усе одно відмовляють.
            </p>
            <p className="text-[11px] leading-relaxed text-slate-300">
              Генерація коштує кредитів: дек на 9 карток зі звичайними ілюстраціями — приблизно
              27–162 кредити, без ілюстрацій 9–27. Верстка книги — теж генерація.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-semibold text-slate-300">
              Ключ API з кабінету Gamma
            </label>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && apiKey.trim() && !busy) void connect();
              }}
              placeholder="sk-gamma-…"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none"
            />
            <p className="text-[11px] leading-relaxed text-slate-400">
              Ключ береться в кабінеті Gamma:{' '}
              <a
                href="https://gamma.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-cyan-300/80 hover:text-cyan-200"
              >
                gamma.app
                <ExternalLink className="w-3 h-3" />
              </a>{' '}
              → Settings → API.
            </p>
          </div>

          {error && (
            <p className="text-[11px] leading-relaxed text-rose-300 border border-rose-500/25 bg-rose-500/[0.06] rounded-xl p-3">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-white/[0.06] shrink-0">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-xs text-slate-300 hover:bg-white/5 transition disabled:opacity-50"
          >
            Не зараз
          </button>
          <button
            onClick={() => void connect()}
            disabled={busy || !apiKey.trim()}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-500/15 border border-cyan-500/50 text-cyan-200 hover:bg-cyan-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            {busy ? 'Перевіряю ключ…' : 'Підключити'}
          </button>
        </div>
      </div>
    </div>
  );
};
