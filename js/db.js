// Thin promise wrapper around IndexedDB.
const DB_NAME = 'budget-app';
const DB_VERSION = 1;
export const STORES = ['transactions', 'categories', 'rules', 'recurring', 'settings'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, items) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const item of items) os.put(item);
  return done(tx);
}

export async function remove(store, ids) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const id of ids) os.delete(id);
  return done(tx);
}

/** Replace the content of every store in one atomic transaction (used by backup import). */
export async function replaceAll(data) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const os = tx.objectStore(name);
    os.clear();
    for (const item of data[name] || []) os.put(item);
  }
  return done(tx);
}
