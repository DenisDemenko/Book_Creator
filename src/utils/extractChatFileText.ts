/**
 * Витягання тексту з файлів, прикріплених у чаті з AI-асистентом
 * (src/components/QuickAiModal.tsx, кнопка-скріпка). Для .txt/.md текст
 * читається напряму; для .pdf — через pdfjs-dist (динамічний імпорт, лише
 * в браузері, той самий прийом, що й mammoth для .docx у KnowledgeView.tsx).
 */

let workerConfigured = false;

async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!workerConfigured) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjsLib;
}

/** Максимум символів тексту, які має сенс тягнути з одного PDF (захист від велетенських файлів). */
const MAX_PDF_CHARS = 100_000;

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts: string[] = [];
  let total = 0;
  for (let pageNum = 1; pageNum <= doc.numPages && total < MAX_PDF_CHARS; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');
    parts.push(pageText);
    total += pageText.length;
  }
  return parts.join('\n\n').slice(0, MAX_PDF_CHARS);
}

/** Текстовий вміст файлу (.txt/.md напряму, .pdf через pdfjs-dist). Кидає для інших форматів. */
export async function extractChatFileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type === 'text/plain' || file.type === 'text/markdown') {
    return await file.text();
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return await extractPdfText(file);
  }
  throw new Error('unsupported');
}

/** Base64 (без префіксу `data:...;base64,`) для зображень, що йдуть у vision-запит. */
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
