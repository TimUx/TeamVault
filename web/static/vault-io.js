/** Client-side vault export / encrypted backup helpers (Zero-Knowledge). */
(function (global) {
  function toExportItems(rows) {
    return (rows || []).map((it) => {
      const p = it.payload || {};
      const urls = Array.isArray(p.urls) ? p.urls.filter(Boolean) : p.url ? [p.url] : [];
      return {
        title: it.title || "Secret",
        collection_id: it.collection_id || "",
        username: p.username || "",
        password: p.password || "",
        urls,
        notes: p.notes || "",
        totp_seed: p.totp_seed || p.totp || "",
        tags: Array.isArray(p.tags) ? p.tags : [],
        favorite: !!p.favorite,
        extra: Array.isArray(p.extra) ? p.extra : [],
      };
    });
  }

  function toTeamVaultJSON(rows) {
    return {
      kind: "teamvault-export",
      version: 1,
      exported_at: new Date().toISOString(),
      items: toExportItems(rows),
    };
  }

  function toBitwardenJSON(rows) {
    const folders = [];
    const folderIds = {};
    let n = 0;
    const items = toExportItems(rows).map((it) => {
      let folderId = null;
      if (it.collection_id) {
        if (!folderIds[it.collection_id]) {
          folderIds[it.collection_id] = "f" + ++n;
          folders.push({ id: folderIds[it.collection_id], name: it.collection_id });
        }
        folderId = folderIds[it.collection_id];
      }
      return {
        type: 1,
        name: it.title,
        folderId,
        favorite: !!it.favorite,
        notes: it.notes || "",
        login: {
          username: it.username || "",
          password: it.password || "",
          totp: it.totp_seed || null,
          uris: (it.urls || []).map((u) => ({ uri: u })),
        },
      };
    });
    return { encrypted: false, folders, items };
  }

  function csvEscape(s) {
    return `"${String(s ?? "").replace(/"/g, '""')}"`;
  }

  function toCSV(rows) {
    const header = "title,username,password,url,urls,folder,notes,totp,tags,favorite";
    const lines = [header];
    for (const it of toExportItems(rows)) {
      lines.push(
        [
          it.title,
          it.username,
          it.password,
          it.urls[0] || "",
          (it.urls || []).join(";"),
          it.collection_id,
          it.notes,
          it.totp_seed,
          (it.tags || []).join(","),
          it.favorite ? "1" : "0",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    return lines.join("\n");
  }

  function backupParams(params) {
    const p = params || {};
    return {
      Time: p.Time || p.time || 3,
      Memory: p.Memory || p.memory || 65536,
      Threads: p.Threads || p.threads || 1,
      KeyLen: p.KeyLen || p.keyLen || 32,
    };
  }

  async function wrapBackup(exportObj, password, params) {
    if (!global.TVCrypto) throw new Error("Crypto-Modul nicht geladen");
    if (!password || password.length < 12) throw new Error("Backup-Passwort mindestens 12 Zeichen");
    const kdf = backupParams(params);
    const pt = new TextEncoder().encode(JSON.stringify(exportObj));
    const wrapped = await TVCrypto.wrapWithPassword(pt, password, kdf);
    return {
      kind: "teamvault-backup",
      version: 1,
      kdf: "argon2id",
      kdf_params: kdf,
      salt_b64: TVCrypto.b64enc(wrapped.salt),
      nonce_b64: TVCrypto.b64enc(wrapped.nonce),
      ciphertext_b64: TVCrypto.b64enc(wrapped.ciphertext),
    };
  }

  async function unwrapBackup(obj, password) {
    if (!global.TVCrypto) throw new Error("Crypto-Modul nicht geladen");
    if (!obj || obj.kind !== "teamvault-backup") throw new Error("Keine TeamVault-Sicherung");
    const pt = await TVCrypto.unwrapWithPassword(
      TVCrypto.b64dec(obj.ciphertext_b64),
      TVCrypto.b64dec(obj.nonce_b64),
      TVCrypto.b64dec(obj.salt_b64),
      password,
      obj.kdf_params || {}
    );
    const data = JSON.parse(new TextDecoder().decode(pt));
    if (!data || data.kind !== "teamvault-export") throw new Error("Sicherung ungültig");
    return data;
  }

  global.TVVaultIO = { toExportItems, toTeamVaultJSON, toBitwardenJSON, toCSV, wrapBackup, unwrapBackup };
})(typeof window !== "undefined" ? window : globalThis);
