// On-device OCR via self-hosted Tesseract.js (§6). All assets are served from
// our own origin: UMD lib + worker in vendor/tesseract/, wasm cores in
// vendor/tesseract/core/, eng.traineddata.gz in vendor/tesseract/lang/.
import { loadScript } from './ui.js';

const TESS_BASE = new URL('../vendor/tesseract/', import.meta.url);

let workerPromise = null;
let currentOnProgress = null;

// Friendly labels for tesseract worker stages.
const STAGE_LABELS = {
  'loading tesseract core': 'Loading OCR engine…',
  'initializing tesseract': 'Starting OCR engine…',
  'loading language traineddata': 'Loading language data…',
  'initializing api': 'Preparing…',
  'recognizing text': 'Reading text…',
};

function reportProgress(m) {
  if (!currentOnProgress) return;
  const label = STAGE_LABELS[m.status] || 'Working…';
  // Setup stages fill 0–20%; recognition fills 20–100%.
  const pct =
    m.status === 'recognizing text' ? 20 + 80 * (m.progress || 0) : 20 * (m.progress || 0);
  currentOnProgress(pct, label);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(new URL('tesseract.min.js', TESS_BASE).href);
      return globalThis.Tesseract.createWorker('eng', 1, {
        workerPath: new URL('worker.min.js', TESS_BASE).href,
        corePath: new URL('core/', TESS_BASE).href,
        langPath: new URL('lang/', TESS_BASE).href,
        gzip: true,
        logger: reportProgress,
      });
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

// Recognizes text in an image blob. onProgress(pct 0-100, label) is optional.
// The worker is kept alive for subsequent captures.
export async function recognize(blob, onProgress) {
  currentOnProgress = onProgress || null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(blob);
    return cleanOcrText(data.text);
  } finally {
    currentOnProgress = null;
  }
}

// Cancels an in-flight recognition by tearing the worker down.
export async function cancelOcr() {
  const promise = workerPromise;
  workerPromise = null;
  currentOnProgress = null;
  if (promise) {
    try {
      (await promise).terminate();
    } catch {
      /* already dead */
    }
  }
}

// Book pages come out with hard line breaks and hyphenated line ends; rejoin
// them so the quote reads as flowing text (paragraph breaks are preserved).
export function cleanOcrText(text) {
  return text
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
