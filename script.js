/* ---------- Limits ----------
   Warn above the WARN values, refuse above the MAX values.
   File size and pixel count are checked separately: a small PNG can still
   have a huge number of pixels, and pixels are what use up memory. */
const MB = 1024 * 1024;
const WARN_BYTES = 10 * MB;       // warn above 10MB
const MAX_BYTES = 25 * MB;        // refuse above 25MB
const WARN_PIXELS = 16_000_000;   // warn above 16 megapixels (e.g. 4608 x 3456)
const MAX_PIXELS = 50_000_000;    // refuse above 50 megapixels (covers 48MP phone photos)
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const imageInput = document.getElementById('image-input');
const uploadZone = document.getElementById('upload-zone');
const statusLine = document.getElementById('status-line');
const statusText = document.getElementById('status-text');
const warningLine = document.getElementById('warning-line');
const emptyPreview = document.getElementById('empty-preview');
const outputImage = document.getElementById('output-image');
const actions = document.getElementById('actions');
const downloadLink = document.getElementById('download-link');
const resultArea = document.getElementById('result-area');
const bgButton = document.getElementById('bg-button');
const bgMenu = document.getElementById('bg-menu');
const bgDot = document.getElementById('bg-dot');
const bgCustom = document.getElementById('bg-custom');

let outputUrl = null;
let enginePromise = null;
let busy = false;

/* Background colour state */
let currentBlob = null;       // the transparent cutout from the engine
let bgColor = 'transparent';  // 'transparent' or a hex colour
let coloredUrl = null;        // object URL of the cutout flattened onto bgColor
let applyToken = 0;           // guards against out-of-order async renders

/* ---------- Theme toggle ---------- */
function setTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('localcut-theme', theme); } catch (e) {}
}
document.getElementById('theme-light').addEventListener('click', () => setTheme('light'));
document.getElementById('theme-dark').addEventListener('click', () => setTheme('dark'));

/* ---------- Status and warning helpers ---------- */
function setStatus(message, type = 'idle') {
  statusText.textContent = message;
  statusLine.classList.remove('is-idle', 'is-error', 'is-success');
  statusLine.classList.add(`is-${type}`);
}

function setWarning(message) {
  warningLine.textContent = message;
  warningLine.hidden = false;
}

function clearWarning() {
  warningLine.textContent = '';
  warningLine.hidden = true;
}

/* ---------- Image size helpers ---------- */
function getImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

const formatMB = (bytes) => (bytes / MB).toFixed(1);
const formatMP = (pixels) => (pixels / 1_000_000).toFixed(1);

/* ---------- Background-removal engine ----------
   Loads @imgly/background-removal on first use. The AI model runs in
   your browser; the image itself is never uploaded. */
function loadEngine() {
  if (!enginePromise) {
    enginePromise = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
  }
  return enginePromise;
}

async function processImage(file) {
  if (!file || busy) return;
  busy = true;

  let isLarge = false;

  try {
    clearWarning();

    /* 1. File type */
    if (!ALLOWED.includes(file.type)) {
      setStatus('Please choose a JPG, PNG or WEBP image.', 'error');
      return;
    }

    /* 2. File size (cheap check first) */
    if (file.size > MAX_BYTES) {
      setStatus(
        `That file is ${formatMB(file.size)}MB. The limit is ${MAX_BYTES / MB}MB, so please choose a smaller image.`,
        'error'
      );
      return;
    }

    /* 3. Pixel count */
    let size;
    try {
      size = await getImageSize(file);
    } catch (e) {
      setStatus('That image could not be read. It may be damaged or too large for this browser.', 'error');
      return;
    }
    const pixels = size.width * size.height;

    if (pixels > MAX_PIXELS) {
      setStatus(
        `That image is ${formatMP(pixels)} megapixels (${size.width} × ${size.height}). The limit is ${MAX_PIXELS / 1_000_000} megapixels, so please resize it and try again.`,
        'error'
      );
      return;
    }

    /* 4. Warn (but carry on) for large images */
    const bigFile = file.size > WARN_BYTES;
    const bigPixels = pixels > WARN_PIXELS;
    isLarge = bigFile || bigPixels;

    if (isLarge) {
      const details = [];
      if (bigFile) details.push(`${formatMB(file.size)}MB`);
      if (bigPixels) details.push(`${formatMP(pixels)} megapixels`);
      setWarning(
        `This is a large image (${details.join(', ')}). It will take longer to process, and phones or older devices may run out of memory. If it fails, try a smaller version.`
      );
    }

    /* 5. Process */
    actions.hidden = true;
    closeBgMenu();
    outputImage.style.display = 'none';
    emptyPreview.style.display = '';
    setStatus('Loading the background remover (first time only, this can take a moment)...');

    const lib = await loadEngine();
    const removeBackground = lib.removeBackground || lib.default;
    setStatus('Removing background...');

    const blob = await removeBackground(file, {
      progress: (key, current, total) => {
        if (total) setStatus(`Working... ${Math.round((current / total) * 100)}%`);
      }
    });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    currentBlob = blob;
    outputUrl = URL.createObjectURL(blob);
    outputImage.src = outputUrl;
    outputImage.style.display = 'block';
    emptyPreview.style.display = 'none';
    actions.hidden = false;
    await applyBackground();
    setStatus('Done! Your background has been removed.', 'success');
  } catch (error) {
    console.error(error);
    enginePromise = null; // allow a retry
    if (isLarge) {
      setStatus('This image was too big for your device to process. Try a smaller version.', 'error');
    } else {
      setStatus('Something went wrong loading the remover. Check your connection and try again.', 'error');
    }
  } finally {
    busy = false;
  }
}

/* ---------- Background colour ---------- */
async function applyBackground() {
  const token = ++applyToken;
  const isTransparent = bgColor === 'transparent';

  // Preview
  resultArea.classList.toggle('checkerboard', isTransparent);
  resultArea.style.backgroundColor = isTransparent ? '' : bgColor;

  // Button dot + active swatch
  bgDot.classList.toggle('has-color', !isTransparent);
  bgDot.style.backgroundColor = isTransparent ? '' : bgColor;
  bgMenu.querySelectorAll('.swatch[data-color]').forEach((s) => {
    s.classList.toggle('is-active', s.dataset.color === bgColor);
  });

  if (!currentBlob) return;

  // Transparent: download the original cutout
  if (isTransparent) {
    downloadLink.href = outputUrl;
    downloadLink.download = 'localcut-result.png';
    return;
  }

  // Coloured: draw the cutout over the colour and export that
  try {
    const bitmap = await createImageBitmap(currentBlob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();

    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (token !== applyToken || !out) return; // a newer choice replaced this one

    if (coloredUrl) URL.revokeObjectURL(coloredUrl);
    coloredUrl = URL.createObjectURL(out);
    downloadLink.href = coloredUrl;
    downloadLink.download = 'localcut-result-background.png';
  } catch (e) {
    console.error(e);
    setStatus('Could not apply that background colour. Try a smaller image.', 'error');
  }
}

function closeBgMenu() {
  bgMenu.hidden = true;
  bgButton.setAttribute('aria-expanded', 'false');
}

bgButton.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = bgMenu.hidden;
  bgMenu.hidden = !open;
  bgButton.setAttribute('aria-expanded', String(open));
});

bgMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const swatch = e.target.closest('.swatch[data-color]');
  if (!swatch) return;
  bgColor = swatch.dataset.color;
  applyBackground();
  closeBgMenu();
});

bgCustom.addEventListener('input', () => {
  bgColor = bgCustom.value;
  applyBackground();
});

document.addEventListener('click', closeBgMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBgMenu(); });

/* ---------- Events ---------- */
imageInput.addEventListener('change', (e) => {
  processImage(e.target.files && e.target.files[0]);
  imageInput.value = '';
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) processImage(file);
});

window.addEventListener('beforeunload', () => {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  if (coloredUrl) URL.revokeObjectURL(coloredUrl);
});
