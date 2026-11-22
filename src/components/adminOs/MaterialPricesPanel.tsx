import { useEffect, useState } from 'react';
import { SlabInventoryPanel } from './SlabInventoryPanel';
import { readPricesXml, starterPrices, writePricesXml, type BoardPrice } from './materialPricesXml';

type SlabPrice = {
  id: string; number: string; species: string; category: string;
  widthCm: number; lengthCm: number; thicknessCm: number;
  priceMinor: number; available: boolean;
};
type Catalogue = { version: number; boards: BoardPrice[]; slabs: SlabPrice[] };
const url = '/api/admin/slab-tables/material-prices';
const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH' });
const sections = [
  ['boards', 'ДСП і фанера'], ['slabs', 'Ціни слебів Marketplace'], ['facades', 'Фасадні слеби'],
] as const;

export function MaterialPricesPanel() {
  const [tab, setTab] = useState<(typeof sections)[number][0]>('boards');
  const [current, setCurrent] = useState<Catalogue | null>(null);
  const [xml, setXml] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);

  async function load(signal?: AbortSignal) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(url, { signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Не вдалося завантажити ціни.');
      setCurrent(result);
      setXml(writePricesXml(result.boards));
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Помилка завантаження.');
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  async function save() {
    if (!current) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const boards = readPricesXml(xml);
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: current.version, boards }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Не вдалося опублікувати довідник.');
      setCurrent({ ...current, ...result });
      setXml(writePricesXml(result.boards));
      setNotice(`Довідник опубліковано. Версія ${result.version}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Помилка публікації.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const link = document.createElement('a');
    const href = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
    link.href = href;
    link.download = 'material-prices.xml';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <section className="space-y-4">
      <nav aria-label="Довідники матеріалів" className="flex flex-wrap gap-2">
        {sections.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key}
            className={`rounded-lg border border-slate-500 px-3 py-2 text-sm ${tab === key ? 'bg-slate-600 font-semibold' : 'bg-slate-800'}`}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      {notice && <p role="status" className="text-emerald-300">{notice}</p>}
      {busy && <p role="status">Завантажуємо ціни…</p>}
      {tab === 'boards' && (
        <div className="space-y-3">
          {current && (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="pb-2 text-left">Опублікований довідник плит · версія {current.version}</caption>
                <thead className="sticky top-0 bg-slate-800">
                  <tr><th>Матеріал / декор</th><th>Розміри, мм</th><th>Ціна</th></tr>
                </thead>
                <tbody>
                  {current.boards.map((row) => (
                    <tr key={row.id} className="border-b border-slate-700">
                      <td className="py-2">{row.name}{row.decor && <small className="ml-2">{row.decor}</small>}</td>
                      <td>{row.lengthMm} × {row.widthMm} × {row.thicknessMm}</td>
                      <td>{row.priceMinor === null ? 'Не задано' :
                        `${money.format(row.priceMinor / 100)} / ${row.unit === 'sheet' ? 'лист' : 'м²'}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {current.boards.length === 0 && <p className="py-2 text-sm">Довідник ще порожній. Додайте приклади або імпортуйте файл.</p>}
            </div>
          )}
          <label className="block" htmlFor="material-prices-xml">Довідник плит XML · UAH</label>
          <p className="text-sm text-slate-300">
            Розміри задаються в мм, priceMinor — у копійках за лист (sheet) або за м² (m2).
            Порожнє значення означає, що ціну ще не встановлено.
          </p>
          <textarea id="material-prices-xml" spellCheck={false} rows={9} value={xml} disabled={busy}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 p-3 font-mono text-sm"
            onChange={(event) => setXml(event.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || !current}
              onClick={() => {
                // Add examples only when neither is already in the editor.
                try {
                  const rows = readPricesXml(xml);
                  setXml(writePricesXml([...rows, ...starterPrices.filter((sample) => !rows.some((row) => row.id === sample.id))]));
                  setError('');
                } catch (failure) {
                  setError(failure instanceof Error ? failure.message : 'Помилка XML.');
                }
              }}>Додати зразки</button>
            <label className="text-sm">
              Імпорт XML
              <input type="file" accept=".xml,application/xml,text/xml" disabled={busy} className="ml-2"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  if (file.size > 250_000) { setError('Файл XML перевищує 250 КБ.'); return; }
                  try {
                    const contents = await file.text();
                    readPricesXml(contents);
                    setXml(contents);
                    setError('');
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : 'Не вдалося прочитати XML.');
                  }
                }} />
            </label>
            <button type="button" disabled={!xml} onClick={download}>Завантажити XML</button>
            <button type="button" disabled={busy || !current}
              className="rounded-lg bg-sky-700 px-3 py-2 font-semibold"
              onClick={() => void save()}>Опублікувати ціни плит</button>
          </div>
        </div>
      )}
      {tab === 'slabs' && current && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="pb-2 text-left">Активні позиції складу · {current.slabs.length}</caption>
            <thead className="border-b border-slate-600"><tr><th>Номер</th><th>Порода</th><th>Призначення</th><th>Розміри, см</th><th>Ціна за слеб</th><th>Стан</th></tr></thead>
            <tbody>
              {current.slabs.map((slab) => (
                <tr key={slab.id} className="border-b border-slate-700">
                  <td className="py-2">{slab.number}</td><td>{slab.species}</td>
                  <td>{slab.category === 'cabinet_facade' ? 'Фасади' : slab.category === 'table' ? 'Столи' : slab.category}</td>
                  <td>{slab.lengthCm} × {slab.widthCm} × {slab.thicknessCm}</td>
                  <td>{money.format(slab.priceMinor / 100)}</td>
                  <td>{slab.available ? 'Доступний' : 'Зарезервовано'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {current.slabs.length === 0 && <p>Активних слебів немає.</p>}
        </div>
      )}
      {tab === 'facades' && <SlabInventoryPanel category="cabinet_facade" inventoryOnly />}
      {tab !== 'facades' && (
        <button type="button" disabled={busy}
          onClick={() => {
            if (current && xml !== writePricesXml(current.boards) &&
                !window.confirm('Завантажити останні ціни й замінити незбережений XML?')) return;
            void load();
          }}>Оновити з Marketplace</button>
      )}
    </section>
  );
}
