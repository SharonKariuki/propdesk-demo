/**
 * Storage drivers for the local data provider.
 *
 * The database keeps every table in memory and writes whole tables through a
 * driver. Two drivers ship: IndexedDB (the browser default, survives reloads)
 * and an in-memory one (tests, and the fallback when IndexedDB is blocked —
 * private windows in some browsers).
 */
export interface StorageDriver {
  /** Every stored table, keyed by name. */
  loadTables(): Promise<Record<string, unknown>>;
  saveTables(tables: Record<string, unknown>): Promise<void>;
  getFile(id: string): Promise<Blob | null>;
  putFile(id: string, blob: Blob): Promise<void>;
  deleteFile(id: string): Promise<void>;
  /** Drop everything (used by "Reset demo data"). */
  clear(): Promise<void>;
}

export class MemoryDriver implements StorageDriver {
  private tables: Record<string, unknown> = {};
  private files = new Map<string, Blob>();

  async loadTables() {
    return structuredClone(this.tables);
  }
  async saveTables(tables: Record<string, unknown>) {
    Object.assign(this.tables, structuredClone(tables));
  }
  async getFile(id: string) {
    return this.files.get(id) ?? null;
  }
  async putFile(id: string, blob: Blob) {
    this.files.set(id, blob);
  }
  async deleteFile(id: string) {
    this.files.delete(id);
  }
  async clear() {
    this.tables = {};
    this.files.clear();
  }
}

const DB_NAME = "propdesk-demo";
const DB_VERSION = 1;
const TABLES = "tables";
const FILES = "files";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbDriver implements StorageDriver {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES);
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbPromise;
  }

  async loadTables() {
    const db = await this.db();
    const tx = db.transaction(TABLES, "readonly");
    const store = tx.objectStore(TABLES);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll()),
    ]);
    const out: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      out[String(k)] = values[i];
    });
    return out;
  }

  async saveTables(tables: Record<string, unknown>) {
    const db = await this.db();
    const tx = db.transaction(TABLES, "readwrite");
    const store = tx.objectStore(TABLES);
    for (const [name, rows] of Object.entries(tables)) store.put(rows, name);
    await done(tx);
  }

  async getFile(id: string) {
    const db = await this.db();
    const result = await request(db.transaction(FILES, "readonly").objectStore(FILES).get(id));
    return (result as Blob | undefined) ?? null;
  }

  async putFile(id: string, blob: Blob) {
    const db = await this.db();
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).put(blob, id);
    await done(tx);
  }

  async deleteFile(id: string) {
    const db = await this.db();
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).delete(id);
    await done(tx);
  }

  async clear() {
    const db = await this.db();
    const tx = db.transaction([TABLES, FILES], "readwrite");
    tx.objectStore(TABLES).clear();
    tx.objectStore(FILES).clear();
    await done(tx);
  }
}

/** IndexedDB when the browser allows it, memory otherwise. */
export async function defaultDriver(): Promise<StorageDriver> {
  if (typeof indexedDB === "undefined") return new MemoryDriver();
  const driver = new IndexedDbDriver();
  try {
    await driver.loadTables();
    return driver;
  } catch {
    console.warn("[local data] IndexedDB unavailable — changes will last until the tab closes.");
    return new MemoryDriver();
  }
}
