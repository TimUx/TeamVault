/** Client-side offline vault snapshot (ciphertext only, Zero-Knowledge). */
(function (global) {
  const DB_NAME = "teamvault-offline";
  const DB_VERSION = 1;
  const SNAPSHOT_VERSION = 1;
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const OPTIN_KEY = "tv-offline-optin";

  function snapshotKey(tenantId, userId) {
    return `${tenantId}:${userId}`;
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB nicht verfügbar"));
        return;
      }
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          db.createObjectStore("snapshots");
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  function withStore(mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("snapshots", mode);
          const store = tx.objectStore("snapshots");
          Promise.resolve(fn(store))
            .then((val) => {
              tx.oncomplete = () => {
                db.close();
                resolve(val);
              };
              tx.onerror = () => {
                db.close();
                reject(tx.error || new Error("IndexedDB transaction failed"));
              };
              tx.onabort = () => {
                db.close();
                reject(tx.error || new Error("IndexedDB transaction aborted"));
              };
            })
            .catch((err) => {
              try {
                tx.abort();
              } catch (_) {}
              db.close();
              reject(err);
            });
        })
    );
  }

  function isExpired(snapshot) {
    if (!snapshot || !snapshot.synced_at) return true;
    const synced = Date.parse(snapshot.synced_at);
    if (!Number.isFinite(synced)) return true;
    return Date.now() - synced > TTL_MS;
  }

  function expiresAt(syncedAt) {
    const synced = Date.parse(syncedAt);
    if (!Number.isFinite(synced)) return null;
    return new Date(synced + TTL_MS).toISOString();
  }

  function getOptIn() {
    try {
      return global.localStorage.getItem(OPTIN_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setOptIn(enabled) {
    try {
      global.localStorage.setItem(OPTIN_KEY, enabled ? "1" : "0");
    } catch (_) {}
  }

  function hasOptInChoice() {
    try {
      return global.localStorage.getItem(OPTIN_KEY) !== null;
    } catch (_) {
      return false;
    }
  }

  function buildSnapshot({ me, keys, params, secrets }) {
    const syncedAt = new Date().toISOString();
    return {
      version: SNAPSHOT_VERSION,
      tenant_id: me.tenant_id,
      tenant_slug: me.tenant_slug || "",
      tenant_name: me.tenant_name || "",
      user_id: me.user_id,
      username: me.username,
      synced_at: syncedAt,
      expires_at: expiresAt(syncedAt),
      keys: {
        salt_b64: keys.salt_b64,
        encrypted_private_key_nonce_b64: keys.encrypted_private_key_nonce_b64,
        encrypted_private_key_b64: keys.encrypted_private_key_b64,
      },
      crypto_params: params,
      secrets: secrets || [],
    };
  }

  async function listSnapshots(opts = {}) {
    const validOnly = !!opts.validOnly;
    const rows = await withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      });
    });
    const out = rows
      .filter((s) => s && s.tenant_id && s.user_id)
      .map((s) => ({
        ...s,
        key: snapshotKey(s.tenant_id, s.user_id),
        expired: isExpired(s),
      }));
    return validOnly ? out.filter((s) => !s.expired) : out;
  }

  async function getSnapshot(tenantId, userId) {
    const key = snapshotKey(tenantId, userId);
    const snap = await withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      });
    });
    if (!snap) return null;
    if (isExpired(snap)) return null;
    return snap;
  }

  async function putSnapshot(snapshot) {
    if (!snapshot?.tenant_id || !snapshot?.user_id) {
      throw new Error("Snapshot unvollständig");
    }
    const key = snapshotKey(snapshot.tenant_id, snapshot.user_id);
    await withStore("readwrite", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.put(snapshot, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error("IndexedDB write failed"));
      });
    });
    return snapshot;
  }

  async function deleteSnapshot(tenantId, userId) {
    const key = snapshotKey(tenantId, userId);
    await withStore("readwrite", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
      });
    });
  }

  global.TVOfflineStore = {
    TTL_MS,
    snapshotKey,
    isExpired,
    expiresAt,
    getOptIn,
    setOptIn,
    hasOptInChoice,
    buildSnapshot,
    listSnapshots,
    getSnapshot,
    putSnapshot,
    deleteSnapshot,
    isAvailable() {
      return !!global.indexedDB;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
