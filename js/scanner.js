// Camera barcode scanning, using the html5-qrcode library (loaded in index.html).

let scanner = null;

export async function startScanner(elementId, onCode) {
  if (!window.Html5Qrcode) throw new Error("The scanner couldn't load. Check your internet connection.");
  await stopScanner();
  const F = window.Html5QrcodeSupportedFormats;
  scanner = new window.Html5Qrcode(elementId, {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });
  let done = false;
  await scanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: (w, h) => ({ width: Math.min(320, w * 0.8), height: Math.min(140, h * 0.5) }) },
    text => { if (!done) { done = true; onCode(text); } },
    () => {}
  );
}

export async function stopScanner() {
  if (!scanner) return;
  try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch {}
  scanner = null;
}
