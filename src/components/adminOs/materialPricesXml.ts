export type BoardPrice = {
  id: string;
  kind: 'chipboard' | 'plywood';
  name: string;
  decor: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  grain: 'length' | 'width' | 'none';
  unit: 'sheet' | 'm2';
  priceMinor: number | null;
};

export const starterPrices: BoardPrice[] = [
  {
    id: 'egger-h1388-st40-18', kind: 'chipboard', name: 'EGGER H1388 ST40 Дуб Казелла пісочний',
    decor: 'H1388 ST40', lengthMm: 2800, widthMm: 2070, thicknessMm: 18,
    grain: 'length', unit: 'sheet', priceMinor: null,
  },
  {
    id: 'plywood-2500-1250-18', kind: 'plywood', name: 'Фанера 18 мм',
    decor: '', lengthMm: 2500, widthMm: 1250, thicknessMm: 18,
    grain: 'length', unit: 'm2', priceMinor: null,
  },
];

export function writePricesXml(boards: BoardPrice[]) {
  const doc = document.implementation.createDocument(null, 'material-prices');
  const root = doc.documentElement;
  root.setAttribute('version', '1');
  root.setAttribute('currency', 'UAH');
  for (const board of boards) {
    const element = doc.createElement('board');
    for (const [key, value] of Object.entries(board))
      element.setAttribute(key, value === null ? '' : String(value));
    root.append(doc.createTextNode('\n  '), element);
  }
  if (boards.length) root.append(doc.createTextNode('\n'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc) + '\n';
}

export function readPricesXml(xml: string): BoardPrice[] {
  if (xml.length > 250_000 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw Error('Перевірте розмір XML та приберіть службові оголошення DOCTYPE або ENTITY.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.tagName !== 'material-prices' ||
      root.getAttribute('version') !== '1' || root.getAttribute('currency') !== 'UAH')
    throw Error('Потрібен коректний XML material-prices версії 1 у гривнях.');
  return Array.from(root.children).map((node, index) => {
    if (node.tagName !== 'board' || node.children.length)
      throw Error(`Рядок ${index + 1}: очікується один елемент board з атрибутами.`);
    const attr = (name: string) => node.getAttribute(name) ?? '';
    const amount = node.getAttribute('priceMinor');
    if (amount === null) throw Error(`Рядок ${index + 1}: додайте атрибут priceMinor. Для ціни, яку ще не визначено, залиште його порожнім.`);
    const measure = (name: string) => {
      const content = attr(name).trim();
      if (!/^\d+(\.\d+)?$/.test(content) || !Number.isFinite(Number(content)))
        throw Error(`Рядок ${index + 1}: перевірте розмір ${name}.`);
      return Number(content);
    };
    if (amount.trim() && (!/^\d+$/.test(amount.trim()) || !Number.isSafeInteger(Number(amount))))
      throw Error(`Рядок ${index + 1}: введіть цілу кількість копійок.`);
    return {
      id: attr('id'), name: attr('name'), decor: attr('decor'),
      kind: attr('kind') as BoardPrice['kind'],
      lengthMm: measure('lengthMm'), widthMm: measure('widthMm'),
      thicknessMm: measure('thicknessMm'), grain: attr('grain') as BoardPrice['grain'],
      unit: attr('unit') as BoardPrice['unit'], priceMinor: amount.trim() === '' ? null : Number(amount),
    };
  });
}
