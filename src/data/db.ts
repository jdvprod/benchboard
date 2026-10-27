/** Tiny IndexedDB wrapper. Falls back to memory if the browser blocks storage. */
import { STORES, StoreName } from "./model";

const DB_NAME = "bench-stats", DB_VERSION = 1;
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

export async function isPersistent() { return !!(await open()); }

export async function loadAll(): Promise<Record<StoreName, any[]>> {
  const out = Object.fromEntries(STORES.map((s) => [s, []])) as unknown as Record<StoreName, any[]>;
  const db = await open(); if (!db) return out;
  await Promise.all(STORES.map((s) => new Promise<void>((res) => {
    try {
      const r = db.transaction(s, "readonly").objectStore(s).getAll();
      r.onsuccess = () => { out[s] = r.result || []; res(); };
      r.onerror = () => res();
    } catch { res(); }
  })));
  return out;
}

/* Writes are queued per record so rapid taps never race. */
const pending = new Map<string, { store: StoreName; value: any; del: boolean }>();
let flushTimer: any = null;
let onError: (msg: string) => void = () => {};
export function setStorageErrorHandler(fn: (msg: string) => void) { onError = fn; }

export function put(store: StoreName, value: any) { pending.set(store + "\u0000" + value.id, { store, value, del: false }); schedule(); }
export function del(store: StoreName, id: string) { pending.set(store + "\u0000" + id, { store, value: { id }, del: true }); schedule(); }
function schedule() { if (!flushTimer) flushTimer = setTimeout(flush, 60); }

export async function flush() {
  flushTimer = null;
  if (!pending.size) return;
  const batch = Array.from(pending.values()); pending.clear();
  const db = await open(); if (!db) return;
  await new Promise<void>((res) => {
    try {
      const stores = Array.from(new Set(batch.map((b) => b.store)));
      const tx = db.transaction(stores, "readwrite");
      for (const b of batch) { const os = tx.objectStore(b.store); if (b.del) os.delete(b.value.id); else os.put(b.value); }
      tx.oncomplete = () => res();
      tx.onerror = () => { onError("Couldn't save on this device. Storage may be full."); res(); };
      tx.onabort = () => { onError("Couldn't save on this device. Storage may be full."); res(); };
    } catch { onError("Couldn't save on this device."); res(); }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { flush(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}

/** Ask the browser not to clear our data when space runs low. */
export async function requestPersistence() { try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* optional */ } }

/** Erase everything Benchboard keeps on this device (all stores, settings, sign-in and sync queue). */
export async function eraseDevice() {
  const db = await open(); db?.close(); dbp = null;
  await new Promise<void>((done) => { try { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => done(); } catch { done(); } });
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("bs-") || k.startsWith("bench")) localStorage.removeItem(k); } catch { /* storage blocked */ }
  try { sessionStorage.clear(); } catch { /* storage blocked */ }
}
