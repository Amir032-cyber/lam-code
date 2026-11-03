import type { VFile } from '../fs/vfs';
import { extname } from '../fs/paths';
import { truncate } from '../agent/policy';

const cache = new Map<string, string>();
const MAX_PDF_PAGES = 40;
const MAX_OCR_PAGES = 5;

function bytesOf(file: VFile): Uint8Array {
  if (file.encoding === 'utf8') return new TextEncoder().encode(file.content);
  const bin = atob(file.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function ocr(image: Blob | HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['fra', 'eng'], 1, {
    workerPath: '/vendor/tesseract/worker.min.js',
    corePath: '/vendor/tesseract/core',
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let n = 1; n <= count; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pages.push(text);
  }
  const total = pages.join('').length;
  if (total < 20 * count && typeof document !== 'undefined') {
    // PDF scanné : OCR des premières pages rendues sur un canvas.
    const ocrPages: string[] = [];
    for (let n = 1; n <= Math.min(count, MAX_OCR_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      ocrPages.push(`--- Page ${n} (OCR) ---\n${await ocr(canvas)}`);
    }
    return ocrPages.join('\n\n');
  }
  const suffix = doc.numPages > count ? `\n\n… ${doc.numPages - count} page(s) non extraites` : '';
  return pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n') + suffix;
}

/** Extrait le texte d'un fichier uploadé : PDF (pdf.js, OCR si scanné), image (OCR), texte brut. */
export async function extractText(file: VFile): Promise<string> {
  const key = `${file.path}:${file.updatedAt}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const ext = extname(file.path);
  let text: string;
  try {
    if (ext === 'pdf') text = await extractPdf(bytesOf(file));
    else if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext)) {
      text = await ocr(new Blob([bytesOf(file) as BlobPart], { type: file.mime }));
    } else if (file.encoding === 'utf8') text = file.content;
    else text = `(binaire ${file.mime}, ${file.size} o : aucun texte extractible)`;
  } catch (error) {
    text = `(extraction impossible : ${error instanceof Error ? error.message : String(error)})`;
  }
  const result = truncate(text || '(aucun texte détecté)');
  cache.set(key, result);
  return result;
}
