// Saves the collection and settings in this browser (localStorage).

const KEY = "myshelf.collection.v1";
const SETTINGS = "myshelf.settings.v1";

export function loadCollection() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function saveCollection(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS, JSON.stringify(s));
}

// Download the collection as a backup file.
export function exportFile(items) {
  const blob = new Blob([JSON.stringify({ app: "Discindex", version: 1, exported: new Date().toISOString(), items }, null, 1)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `discindex-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Read a backup file. Returns the list of items.
export async function readFile(file) {
  const data = JSON.parse(await file.text());
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) throw new Error("This doesn't look like a Discindex backup file.");
  return items;
}
