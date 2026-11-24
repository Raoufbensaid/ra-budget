/**
 * Tesseract (open source, gratuit) chargé depuis le CDN jsDelivr, à une
 * version exacte. La reconnaissance se fait sur l'appareil : la photo ne
 * part vers aucun service de lecture.
 */
export const TESSERACT_URL =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
export const OCR_LANGUAGE = "fra";

/** Page de la fenêtre web cachée utilisée sur iPhone et Android. */
export const OCR_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script src="${TESSERACT_URL}"></script></head><body><script>
var workerPromise = null;
function getWorker() {
  if (!workerPromise) workerPromise = Tesseract.createWorker("${OCR_LANGUAGE}");
  return workerPromise;
}
function send(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
window.recognize = function (id, dataUrl) {
  getWorker()
    .then(function (w) { return w.recognize(dataUrl); })
    .then(function (r) { send({ id: id, text: r.data.text }); })
    .catch(function (e) { send({ id: id, error: String(e && e.message || e) }); });
};
send({ ready: true });
</script></body></html>`;
