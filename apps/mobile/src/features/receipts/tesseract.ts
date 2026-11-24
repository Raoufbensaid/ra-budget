/**
 * Tesseract (open source, gratuit), chargé depuis le CDN jsDelivr à des
 * versions exactes, avec une empreinte de contrôle (SRI) sur le script
 * principal : le navigateur refuse un fichier modifié.
 *
 * La lecture tourne toujours dans un contexte isolé, sans accès à la session
 * Ra Budget :
 * - sur iPhone et Android, une WebView cachée (séparée de l'application) ;
 * - sur le web, un cadre « sandbox » sans même origine que l'application.
 * La photo ne part vers aucun service de lecture.
 */
const TESSERACT_VERSION = "5.1.1";
export const TESSERACT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
/** Empreinte SHA-384 de tesseract.min.js 5.1.1 (66 695 octets). */
export const TESSERACT_SRI =
  "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";
const WORKER_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_URL = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1";
export const OCR_LANGUAGE = "fra";

/**
 * Page de lecture. Elle reçoit { type: "recognize", id, dataUrl } (message
 * du cadre parent sur le web, injection de script sur mobile) et répond
 * { id, text } ou { id, error }. Au chargement, elle envoie { ready: true }.
 */
export const OCR_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script src="${TESSERACT_URL}" integrity="${TESSERACT_SRI}" crossorigin="anonymous"></script>
</head><body><script>
var workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("${OCR_LANGUAGE}", 1, {
      workerPath: "${WORKER_URL}",
      corePath: "${CORE_URL}"
    });
  }
  return workerPromise;
}
function send(m) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m));
  else window.parent.postMessage(m, "*");
}
window.recognize = function (id, dataUrl) {
  if (typeof Tesseract === "undefined") { send({ id: id, error: "tesseract_unavailable" }); return; }
  getWorker()
    .then(function (w) { return w.recognize(dataUrl); })
    .then(function (r) { send({ id: id, text: r.data.text }); })
    .catch(function (e) { send({ id: id, error: String(e && e.message || e) }); });
};
window.addEventListener("message", function (e) {
  if (e.source !== window.parent) return;
  var d = e.data;
  if (d && d.type === "recognize" && typeof d.id === "string" && typeof d.dataUrl === "string") {
    window.recognize(d.id, d.dataUrl);
  }
});
send({ ready: true });
</script></body></html>`;

/** Réponse attendue de la page de lecture. */
export interface OcrMessage {
  ready?: boolean;
  id?: string;
  text?: string;
  error?: string;
}

/** Vérifie la forme d'un message reçu de la page de lecture. */
export function asOcrMessage(value: unknown): OcrMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (m.ready === true) return { ready: true };
  if (typeof m.id !== "string") return null;
  if (typeof m.text === "string") return { id: m.id, text: m.text.slice(0, 20000) };
  if (typeof m.error === "string") return { id: m.id, error: m.error.slice(0, 200) };
  return null;
}
