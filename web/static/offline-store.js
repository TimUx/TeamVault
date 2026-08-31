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

  function secretRevision(entry) {
    if (!entry || !entry.id) return "";
    const e = entry.envelope || {};
    return [
      entry.id,
      entry.key_version || 0,
      e.key_version || 0,
      entry.title_ciphertext_b64 || "",
      entry.title_nonce_b64 || "",
      e.ephemeral_pub_b64 || "",
      e.nonce_b64 || "",
      e.wrapped_dk_b64 || "",
    ].join("|");
  }

  function indexSecrets(secrets) {
    const m = new Map();
    for (const s of secrets || []) {
      if (s && s.id) m.set(s.id, s);
    }
    return m;
  }

  function needsDetailFetch(listItem, cached) {
    if (!listItem?.has_access || !listItem.envelope) return false;
    if (!cached || !cached.ciphertext_b64 || !cached.nonce_b64) return true;
    return secretRevision(listItem) !== secretRevision(cached);
  }

  function buildSecretEntry(listItem, det) {
    return {
      id: listItem.id,
      title_ciphertext_b64: det.title_ciphertext_b64,
      title_nonce_b64: det.title_nonce_b64,
      ciphertext_b64: det.ciphertext_b64,
      nonce_b64: det.nonce_b64,
      key_version: det.key_version,
      envelope: det.envelope,
      created_by: listItem.created_by,
      created_by_username: det.created_by_username,
      shared_groups: det.shared_groups || listItem.shared_groups,
      recipients: det.recipients,
      has_access: true,
    };
  }

  /** Plan delta sync: reuse unchanged ciphertext rows, fetch detail only when needed. */
  function planSync(listItems, cachedSecrets) {
    const byId = indexSecrets(cachedSecrets);
    const toFetch = [];
    const reuse = [];
    const accessible = (listItems || []).filter((it) => it.has_access && it.envelope);
    for (const it of accessible) {
      const cached = byId.get(it.id);
      if (needsDetailFetch(it, cached)) toFetch.push(it);
      else reuse.push(cached);
    }
    return {
      toFetch,
      reuse,
      expectedIds: accessible.map((it) => it.id),
      expectedCount: accessible.length,
    };
  }

  function assembleSecrets(reuse, fetchedEntries, expectedIds) {
    const byId = indexSecrets([...(reuse || []), ...(fetchedEntries || [])]);
    const out = [];
    for (const id of expectedIds || []) {
      const s = byId.get(id);
      if (!s || !s.ciphertext_b64 || !s.nonce_b64 || !s.envelope) return null;
      out.push(s);
    }
    return out;
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

  async function readSnapshotKey(key) {
    return withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      });
    });
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
    const snap = await getSnapshotRaw(tenantId, userId);
    if (!snap || isExpired(snap)) return null;
    return snap;
  }

  async function getSnapshotRaw(tenantId, userId) {
    const key = snapshotKey(tenantId, userId);
    return readSnapshotKey(key);
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
    secretRevision,
    needsDetailFetch,
    buildSecretEntry,
    planSync,
    assembleSecrets,
    buildSnapshot,
    listSnapshots,
    getSnapshot,
    getSnapshotRaw,
    putSnapshot,
    deleteSnapshot,
    isAvailable() {
      return !!global.indexedDB;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
