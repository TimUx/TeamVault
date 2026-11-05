/** Client-side offline vault snapshot (ciphertext only, Zero-Knowledge). */
(function (global) {
  const DB_NAME = "teamvault-offline";
  const DB_VERSION = 1;
  const SNAPSHOT_VERSION = 2;
  const CACHE_FORMAT = "teamvault-offline";
  const CACHE_PROFILE = "STANDARD";
  const CACHE_POLICY_VERSION = 2;
  const LEGACY_CACHE_POLICY_VERSION = 1;
  const EFFECTIVE_POLICY = "offline_cache_allowed=true;profile=STANDARD;required_factors=master_password,software_key";
  const TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const OPTIN_KEY = "tv-offline-optin";
  const REQUIRED_FACTORS = ["master_password", "software_key"];
  const encoder = new TextEncoder();

  function supportedSnapshot(snapshot) {
    return snapshot?.format === CACHE_FORMAT && [SNAPSHOT_VERSION, 3].includes(snapshot.version);
  }

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
    if (!supportedSnapshot(snapshot)) return true;
    const created = Date.parse(snapshot.created_at);
    const expires = Date.parse(snapshot.expires_at);
    if (!Number.isFinite(created) || !Number.isFinite(expires)) return true;
    return expires - created !== TTL_MS || Date.now() >= expires;
  }

  function expiresAt(createdAt) {
    const created = Date.parse(createdAt);
    if (!Number.isFinite(created)) return null;
    return new Date(created + TTL_MS).toISOString();
  }

  function b64enc(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return global.btoa(binary);
  }

  function b64dec(text) {
    const binary = global.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function validateSoftwareKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      throw new Error("Software-Key muss genau 256 Bit enthalten");
    }
    return key;
  }

  function generateSoftwareKey() {
    if (!global.crypto?.getRandomValues || !global.crypto?.subtle) {
      throw new Error("Sichere Offline-Kryptografie ist in diesem Browser nicht verfügbar");
    }
    return global.crypto.getRandomValues(new Uint8Array(32));
  }

  function softwareKeyFile(key) {
    validateSoftwareKey(key);
    return JSON.stringify({
      format: "teamvault-offline-key",
      version: 1,
      key_b64: b64enc(key),
    }, null, 2) + "\n";
  }

  function parseSoftwareKey(text) {
    let key;
    try {
      key = b64dec(String(text).trim());
    } catch (_) {
      throw new Error("Software-Key ist kein gültiges Base64");
    }
    if (key.length !== 32 || b64enc(key) !== String(text).trim()) {
      key.fill(0);
      throw new Error("Software-Key muss ein kanonischer 256-Bit-Key sein");
    }
    return key;
  }

  function parseSoftwareKeyFile(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error("Software-Key-Datei ist kein gültiges JSON");
    }
    if (data?.format !== "teamvault-offline-key" || data.version !== 1 || typeof data.key_b64 !== "string") {
      throw new Error("Unbekanntes Software-Key-Dateiformat");
    }
    return parseSoftwareKey(data.key_b64);
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

  function offlineCacheAAD(cache) {
    const fields = [
      cache.format,
      String(cache.version),
      cache.profile,
      cache.tenant_id,
      cache.tenant_slug,
      cache.tenant_name || "",
      cache.user_id,
      cache.username,
      cache.origin,
      cache.created_at,
      cache.expires_at,
      String(cache.policy_version),
      cache.effective_policy,
      cache.required_factors.join(","),
      cache.keyslot_id,
      cache.keyslot_kind,
      String(cache.keyslot_version),
      cache.kdf,
      cache.snapshot_algorithm,
      cache.salt_b64,
      cache.wrapped_dek_nonce_b64,
      cache.snapshot_nonce_b64,
      String(cache.secret_count),
    ];
    if (cache.policy_version === CACHE_POLICY_VERSION) fields.push(cache.server_requirement);
    let aad = "TVOSV2\u0000";
    for (const field of fields) {
      const value = String(field);
      aad += `${encoder.encode(value).length}:${value}`;
    }
    return encoder.encode(aad);
  }

  function offlineKEKInfo(cache) {
    const fields = [
      cache.format,
      String(cache.version),
      cache.profile,
      cache.tenant_id,
      cache.user_id,
      cache.origin,
      cache.keyslot_id,
      String(cache.keyslot_version),
    ];
    let info = "TVOSK2\u0000";
    for (const field of fields) {
      const value = String(field);
      info += `${encoder.encode(value).length}:${value}`;
    }
    return encoder.encode(info);
  }

  async function deriveKEK(softwareKey, salt, cache) {
    validateSoftwareKey(softwareKey);
    const material = await global.crypto.subtle.importKey("raw", softwareKey, "HKDF", false, ["deriveKey"]);
    return global.crypto.subtle.deriveKey({
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: offlineKEKInfo(cache),
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function sealSnapshot(snapshot, softwareKey, origin, serverRequirement) {
    validateSoftwareKey(softwareKey);
    if (!["ANY", "SOFTWARE"].includes(serverRequirement)) {
      throw new Error("Offline-Sicherheitsprofil entspricht nicht der Administratorrichtlinie");
    }
    if (!global.crypto?.subtle || !origin || snapshot.version !== SNAPSHOT_VERSION ||
        !snapshot.tenant_id || !snapshot.user_id || !snapshot.username) {
      throw new Error("Offline-Snapshot oder Browser-Kryptografie ungültig");
    }
    const dek = global.crypto.getRandomValues(new Uint8Array(32));
    const salt = global.crypto.getRandomValues(new Uint8Array(32));
    const wrappedNonce = global.crypto.getRandomValues(new Uint8Array(12));
    const snapshotNonce = global.crypto.getRandomValues(new Uint8Array(12));
    const createdAt = snapshot.synced_at;
    const cache = {
      format: CACHE_FORMAT,
      version: SNAPSHOT_VERSION,
      profile: CACHE_PROFILE,
      tenant_id: snapshot.tenant_id,
      tenant_slug: snapshot.tenant_slug || "",
      tenant_name: snapshot.tenant_name || "",
      user_id: snapshot.user_id,
      username: snapshot.username,
      origin,
      created_at: createdAt,
      expires_at: expiresAt(createdAt),
      policy_version: CACHE_POLICY_VERSION,
      effective_policy: EFFECTIVE_POLICY,
      server_requirement: serverRequirement,
      required_factors: REQUIRED_FACTORS.slice(),
      keyslot_id: "software-key-v1",
      keyslot_kind: "software",
      keyslot_version: 1,
      kdf: "HKDF-SHA-256",
      snapshot_algorithm: "AES-256-GCM",
      salt_b64: b64enc(salt),
      wrapped_dek_nonce_b64: b64enc(wrappedNonce),
      snapshot_nonce_b64: b64enc(snapshotNonce),
      secret_count: snapshot.secrets.length,
    };
    const aad = offlineCacheAAD(cache);
    let kek;
    try {
      kek = await deriveKEK(softwareKey, salt, cache);
      const dekKey = await global.crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["encrypt"]);
      cache.wrapped_dek_b64 = b64enc(new Uint8Array(await global.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: wrappedNonce, additionalData: aad, tagLength: 128 },
        kek,
        dek
      )));
      cache.ciphertext_b64 = b64enc(new Uint8Array(await global.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: snapshotNonce, additionalData: aad, tagLength: 128 },
        dekKey,
        encoder.encode(JSON.stringify(snapshot))
      )));
      return cache;
    } finally {
      dek.fill(0);
      salt.fill(0);
      wrappedNonce.fill(0);
      snapshotNonce.fill(0);
      if (kek) kek = null;
    }
  }

  async function openSnapshot(cache, softwareKey, expectedOrigin) {
    validateSoftwareKey(softwareKey);
    const policyValid = cache && ((cache.policy_version === LEGACY_CACHE_POLICY_VERSION &&
      !Object.prototype.hasOwnProperty.call(cache, "server_requirement")) ||
      (cache.policy_version === CACHE_POLICY_VERSION &&
        ["ANY", "SOFTWARE"].includes(cache.server_requirement)));
    if (!global.crypto?.subtle || isExpired(cache) || cache.profile !== CACHE_PROFILE ||
        !policyValid ||
        cache.effective_policy !== EFFECTIVE_POLICY ||
        JSON.stringify(cache.required_factors) !== JSON.stringify(REQUIRED_FACTORS) ||
        cache.keyslot_id !== "software-key-v1" || cache.keyslot_kind !== "software" ||
        cache.keyslot_version !== 1 || cache.kdf !== "HKDF-SHA-256" ||
        cache.snapshot_algorithm !== "AES-256-GCM" ||
        cache.origin !== expectedOrigin || !cache.tenant_id || !cache.user_id) {
      throw new Error("Offline-Kopie ist ungültig, veraltet oder gehört zu einem anderen Server");
    }
    let salt;
    let wrappedNonce;
    let snapshotNonce;
    let dek;
    try {
      salt = b64dec(cache.salt_b64);
      wrappedNonce = b64dec(cache.wrapped_dek_nonce_b64);
      snapshotNonce = b64dec(cache.snapshot_nonce_b64);
      if (salt.length !== 32 || wrappedNonce.length !== 12 || snapshotNonce.length !== 12) {
        throw new Error("Offline-Keyslot-Metadaten sind ungültig");
      }
      const kek = await deriveKEK(softwareKey, salt, cache);
      const aad = offlineCacheAAD(cache);
      dek = new Uint8Array(await global.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: wrappedNonce, additionalData: aad, tagLength: 128 },
        kek,
        b64dec(cache.wrapped_dek_b64)
      ));
      if (dek.length !== 32) throw new Error("Ungültiger Offline-Datenschlüssel");
      const dekKey = await global.crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["decrypt"]);
      const plain = new Uint8Array(await global.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: snapshotNonce, additionalData: aad, tagLength: 128 },
        dekKey,
        b64dec(cache.ciphertext_b64)
      ));
      try {
        const snapshot = JSON.parse(new TextDecoder().decode(plain));
        if (snapshot.version !== SNAPSHOT_VERSION ||
            snapshot.tenant_id !== cache.tenant_id ||
            snapshot.tenant_slug !== cache.tenant_slug ||
            (snapshot.tenant_name || "") !== (cache.tenant_name || "") ||
            snapshot.user_id !== cache.user_id ||
            snapshot.username !== cache.username ||
            snapshot.synced_at !== cache.created_at ||
            snapshot.secrets.length !== cache.secret_count) {
          throw new Error("Offline-Snapshot stimmt nicht mit den authentifizierten Metadaten überein");
        }
        return snapshot;
      } finally {
        plain.fill(0);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Offline-")) throw e;
      throw new Error("Software-Key falsch oder Offline-Kopie beschädigt");
    } finally {
      if (salt) salt.fill(0);
      if (wrappedNonce) wrappedNonce.fill(0);
      if (snapshotNonce) snapshotNonce.fill(0);
      if (dek) dek.fill(0);
    }
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
    const obsoleteKeys = rows
      .filter((s) => s && s.tenant_id && s.user_id && s.version === 1)
      .map((s) => snapshotKey(s.tenant_id, s.user_id));
    if (obsoleteKeys.length) await deleteSnapshotKeys(obsoleteKeys);
    const out = rows
      .filter((s) => s && s.tenant_id && s.user_id && supportedSnapshot(s))
      .map((s) => ({
        ...s,
        key: snapshotKey(s.tenant_id, s.user_id),
        expired: isExpired(s),
      }));
    return validOnly ? out.filter((s) => !s.expired) : out;
  }

  function deleteSnapshotKeys(keys) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB cleanup failed"));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB cleanup aborted"));
      };
      const store = tx.objectStore("snapshots");
      for (const key of keys) store.delete(key);
    }));
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

  function sameSnapshot(first, second) {
    if (!first || !second) return !first && !second;
    if (first.storage_revision || second.storage_revision) {
      return typeof first.storage_revision === "string" &&
        first.storage_revision === second.storage_revision;
    }
    const firstRecord = { ...first };
    const secondRecord = { ...second };
    delete firstRecord.key;
    delete firstRecord.expired;
    delete secondRecord.key;
    delete secondRecord.expired;
    return JSON.stringify(firstRecord) === JSON.stringify(secondRecord);
  }

  async function putSnapshot(snapshot, expectedSnapshot) {
    if (arguments.length !== 2) throw new Error("Offline-Snapshot benötigt einen bekannten Ausgangszustand");
    if (!snapshot?.tenant_id || !snapshot?.user_id || !supportedSnapshot(snapshot) || isExpired(snapshot)) {
      throw new Error("Geschützter Offline-Snapshot unvollständig oder ungültig");
    }
    const key = snapshotKey(snapshot.tenant_id, snapshot.user_id);
    const stored = { ...snapshot, storage_revision: b64enc(global.crypto.getRandomValues(new Uint8Array(16))) };
    await withStore("readwrite", (store) => {
      return new Promise((resolve, reject) => {
        const read = store.get(key);
        read.onsuccess = () => {
          if (!sameSnapshot(read.result || null, expectedSnapshot)) {
            reject(new Error("Offline-Kopie wurde in einem anderen Tab geändert. Seite neu laden und erneut versuchen."));
            return;
          }
          const write = store.put(stored, key);
          write.onsuccess = () => resolve();
          write.onerror = () => reject(write.error || new Error("IndexedDB write failed"));
        };
        read.onerror = () => reject(read.error || new Error("IndexedDB read failed"));
      });
    });
    return stored;
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
    generateSoftwareKey,
    softwareKeyFile,
    parseSoftwareKey,
    parseSoftwareKeyFile,
    sealSnapshot,
    openSnapshot,
    listSnapshots,
    getSnapshot,
    getSnapshotRaw,
    putSnapshot,
    sameSnapshot,
    deleteSnapshot,
    isAvailable() {
      return !!global.indexedDB;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
