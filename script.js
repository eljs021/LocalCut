const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const imageInput = document.getElementById('image-input');
const uploadZone = document.getElementById('upload-zone');
const statusLine = document.getElementById('status-line');
const statusText = document.getElementById('status-text');
const emptyPreview = document.getElementById('empty-preview');
const outputImage = document.getElementById('output-image');
const actions = document.getElementById('actions');
const downloadLink = document.getElementById('download-link');

let outputUrl = null;
let enginePromise = null;
let busy = false;

/* ---------- Theme toggle ---------- */
function setTheme(theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('localcut-theme', theme); } catch (e) {}
}
document.getElementById('theme-light').addEventListener('click', () => setTheme('light'));
document.getElementById('theme-dark').addEventListener('click', () => setTheme('dark'));

/* ---------- Status helper ---------- */
function setStatus(message, type = 'idle') {
  statusText.textContent = message;
  statusLine.classList.remove('is-idle', 'is-error', 'is-success');
  statusLine.classList.add(`is-${type}`);
}

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

  if (!ALLOWED.includes(file.type)) {
    setStatus('Please choose a JPG, PNG or WEBP image.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus('That file is over 10MB. Please choose a smaller image.', 'error');
    return;
  }

  busy = true;
  actions.hidden = true;
  outputImage.style.display = 'none';
  emptyPreview.style.display = '';
  setStatus('Loading the background remover (first time only, this can take a moment)...');

  try {
    const lib = await loadEngine();
    const removeBackground = lib.removeBackground || lib.default;
    setStatus('Removing background...');

    const blob = await removeBackground(file, {
      progress: (key, current, total) => {
        if (total) setStatus(`Working... ${Math.round((current / total) * 100)}%`);
      }
    });

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    outputImage.src = outputUrl;
    outputImage.style.display = 'block';
    emptyPreview.style.display = 'none';
    downloadLink.href = outputUrl;
    actions.hidden = false;
    setStatus('Done! Your background has been removed.', 'success');
  } catch (error) {
    console.error(error);
    enginePromise = null; // allow a retry
    setStatus('Something went wrong loading the remover. Check your connection and try again.', 'error');
  } finally {
    busy = false;
  }
}

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
});
