/** FIDO2 PRF protection for the browser's offline vault. */
(function (global) {
  const FORMAT = "teamvault-offline";
  const VERSION = 3;
  const POLICY_VERSION = 1;
  const KEY_KIND = "fido2-prf";
  const MAX_KEYS = 32;
  const encoder = new TextEncoder();

  function encode(bytes) {
    let value = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return global.btoa(value);
  }

  function decode(value, min, max = min) {
    if (typeof value !== "string" || value.length > Math.ceil(max / 3) * 4) {
      throw new Error("Ungültige Hardware-Key-Metadaten");
    }
    let binary;
    try {
      binary = global.atob(value);
    } catch (_) {
      throw new Error("Ungültige Hardware-Key-Metadaten");
    }
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (bytes.length < min || bytes.length > max || encode(bytes) !== value) {
      throw new Error("Ungültige Hardware-Key-Metadaten");
    }
    return bytes;
  }

  function random(length) {
    if (!global.crypto?.getRandomValues || !global.crypto?.subtle) {
      throw new Error("Sichere Offline-Kryptografie ist nicht verfügbar");
    }
    return global.crypto.getRandomValues(new Uint8Array(length));
  }

  function factors(profile) {
    if (profile === "HARDWARE") return ["master_password", "hardware_key"];
    if (profile === "COMBINED") return ["master_password", "software_key", "hardware_key"];
    throw new Error("Unbekanntes Offline-Sicherheitsprofil");
  }

  function policy(profile) {
    return `offline_cache_allowed=true;profile=${profile};required_factors=${factors(profile).join(",")}`;
  }

  function keysetFields(cache) {
    return [
      cache.format, cache.version, cache.profile, cache.tenant_id, cache.tenant_slug,
      cache.tenant_name || "", cache.user_id, cache.username, cache.origin,
      cache.policy_version, cache.effective_policy, cache.required_factors.join(","),
      cache.keyset_id,
    ];
  }

  function context(prefix, fields) {
    let result = prefix + "\u0000";
    for (const field of fields) {
      const value = String(field);
      result += `${encoder.encode(value).length}:${value}`;
    }
    return encoder.encode(result);
  }

  function slotFields(slot) {
    return [
      slot.id, slot.kind, slot.version, slot.label, slot.credential_id_b64,
      slot.prf_salt_b64, slot.wrap_salt_b64, slot.wrap_nonce_b64,
    ];
  }

  function slotAAD(cache, slot) {
    return context("TVHWS3", [...keysetFields(cache), ...slotFields(slot)]);
  }

  function snapshotAAD(cache) {
    const fields = [
      ...keysetFields(cache), cache.created_at, cache.expires_at,
      cache.snapshot_algorithm, cache.dek_nonce_b64, cache.snapshot_nonce_b64,
      cache.secret_count,
    ];
    if (cache.snapshot_policy_version === 1 || cache.snapshot_policy_version === 2) {
      fields.push(cache.snapshot_policy_version, cache.server_requirement);
    }
    if (cache.snapshot_policy_version === 2) {
      fields.push(cache.keyslots.length);
      for (const slot of cache.keyslots) fields.push(...slotFields(slot), slot.wrapped_root_b64);
    }
    return context("TVHWD3", fields);
  }

  function requirementAllowed(profile, requirement) {
    if (!["ANY", "SOFTWARE", "HARDWARE", "COMBINED"].includes(requirement)) return false;
    return profile === "COMBINED" ||
      (profile === "HARDWARE" && (requirement === "ANY" || requirement === "HARDWARE"));
  }

  function validateSnapshotPolicy(cache) {
    const legacy = !Object.prototype.hasOwnProperty.call(cache, "snapshot_policy_version") &&
      !Object.prototype.hasOwnProperty.call(cache, "server_requirement");
    if (!legacy && (![1, 2].includes(cache.snapshot_policy_version) ||
        !requirementAllowed(cache.profile, cache.server_requirement))) {
      throw new Error("Offline-Kopie entspricht nicht der gespeicherten Administratorrichtlinie");
    }
  }

  function validateKeyset(cache, expectedOrigin, allowEmpty = false) {
    if (!cache || cache.format !== FORMAT || cache.version !== VERSION ||
        !["HARDWARE", "COMBINED"].includes(cache.profile) ||
        cache.policy_version !== POLICY_VERSION || cache.effective_policy !== policy(cache.profile) ||
        JSON.stringify(cache.required_factors) !== JSON.stringify(factors(cache.profile)) ||
        cache.origin !== expectedOrigin ||
        !cache.tenant_id || !cache.tenant_slug || !cache.user_id || !cache.username) {
      throw new Error("Offline-Kopie ist ungültig oder gehört zu einem anderen Server");
    }
    decode(cache.keyset_id, 32);
    if (!Array.isArray(cache.keyslots) || cache.keyslots.length > MAX_KEYS ||
        (!allowEmpty && !cache.keyslots.length)) {
      throw new Error("Offline-Kopie enthält keine gültigen Hardware-Keys");
    }
    const ids = new Set();
    const credentials = new Set();
    for (const slot of cache.keyslots) {
      if (!slot || slot.kind !== KEY_KIND || slot.version !== 1 ||
          typeof slot.label !== "string" || !slot.label.trim() || slot.label.length > 80 ||
          ids.has(slot.id) || credentials.has(slot.credential_id_b64)) {
        throw new Error("Ungültiger Hardware-Keyslot");
      }
      decode(slot.id, 16);
      decode(slot.credential_id_b64, 1, 1024);
      decode(slot.prf_salt_b64, 32);
      decode(slot.wrap_salt_b64, 32);
      decode(slot.wrap_nonce_b64, 12);
      decode(slot.wrapped_root_b64, 48);
      ids.add(slot.id);
      credentials.add(slot.credential_id_b64);
    }
  }

  function checkSoftwareKey(cache, softwareKey) {
    if (cache.profile === "COMBINED" &&
        (!(softwareKey instanceof Uint8Array) || softwareKey.length !== 32)) {
      throw new Error("Für COMBINED sind Software-Key und Hardware-Key erforderlich");
    }
  }

  async function slotKey(cache, slot, prf, softwareKey) {
    if (!(prf instanceof Uint8Array) || prf.length !== 32) {
      throw new Error("FIDO2-Key lieferte kein gültiges PRF-Ergebnis");
    }
    checkSoftwareKey(cache, softwareKey);
    const material = new Uint8Array(cache.profile === "COMBINED" ? 64 : 32);
    material.set(prf);
    if (cache.profile === "COMBINED") material.set(softwareKey, 32);
    try {
      const key = await global.crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
      return await global.crypto.subtle.deriveKey({
        name: "HKDF",
        hash: "SHA-256",
        salt: decode(slot.wrap_salt_b64, 32),
        info: context("TVHWK3", [...keysetFields(cache), slot.id, slot.kind, slot.version]),
      }, key, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    } finally {
      material.fill(0);
    }
  }

  async function wrapRoot(cache, slot, root, prf, softwareKey) {
    const key = await slotKey(cache, slot, prf, softwareKey);
    return encode(new Uint8Array(await global.crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: decode(slot.wrap_nonce_b64, 12),
      additionalData: slotAAD(cache, slot),
      tagLength: 128,
    }, key, root)));
  }

  function webauthnRP(cache) {
    if (!global.isSecureContext || !global.navigator?.credentials?.create ||
        !global.navigator?.credentials?.get || !global.location ||
        global.location.origin !== cache.origin) {
      throw new Error("FIDO2 benötigt einen sicheren Browser-Kontext und denselben Server-Origin");
    }
    const hostname = global.location.hostname;
    if (!hostname || hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      throw new Error("FIDO2 benötigt einen DNS-Namen oder localhost statt einer IP-Adresse");
    }
    return hostname;
  }

  async function checkAuthenticatorData(data, rpID) {
    if (!data) throw new Error("FIDO2-Authentifikatordaten fehlen");
    const bytes = new Uint8Array(data);
    if (bytes.length < 37) throw new Error("FIDO2-Authentifikatordaten sind ungültig");
    const expected = new Uint8Array(await global.crypto.subtle.digest("SHA-256", encoder.encode(rpID)));
    if (!expected.every((byte, i) => byte === bytes[i]) || (bytes[32] & 0x05) !== 0x05) {
      throw new Error("FIDO2-Benutzerpräsenz und Benutzerverifikation sind erforderlich");
    }
    if (bytes[32] & 0x08) {
      throw new Error("Synchronisierbare Passkeys sind kein gerätegebundener Hardware-Key");
    }
  }

  async function getPRF(cache, slot) {
    const rpID = webauthnRP(cache);
    const assertion = await global.navigator.credentials.get({
      publicKey: {
        rpId: rpID,
        challenge: random(32),
        timeout: 60000,
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: decode(slot.credential_id_b64, 1, 1024) }],
        extensions: { prf: { eval: { first: decode(slot.prf_salt_b64, 32) } } },
      },
    });
    if (!assertion || encode(new Uint8Array(assertion.rawId)) !== slot.credential_id_b64) {
      throw new Error("Der gewählte FIDO2-Key wurde nicht bestätigt");
    }
    if (assertion.authenticatorAttachment && assertion.authenticatorAttachment !== "cross-platform") {
      throw new Error("Ein externer FIDO2-Security-Key ist erforderlich");
    }
    await checkAuthenticatorData(assertion.response?.authenticatorData, rpID);
    const result = assertion.getClientExtensionResults()?.prf?.results?.first;
    if (!result || result.byteLength !== 32) {
      throw new Error("Dieser FIDO2-Key oder Browser unterstützt WebAuthn-PRF nicht");
    }
    return new Uint8Array(result);
  }

  function createKeyset(me, origin, profile) {
    if (!me?.tenant_id || !me?.tenant_slug || !me?.user_id || !me?.username || !origin) {
      throw new Error("Offline-Konto ist unvollständig");
    }
    const keyset = {
      format: FORMAT,
      version: VERSION,
      profile,
      tenant_id: me.tenant_id,
      tenant_slug: me.tenant_slug,
      tenant_name: me.tenant_name || "",
      user_id: me.user_id,
      username: me.username,
      origin,
      policy_version: POLICY_VERSION,
      effective_policy: policy(profile),
      required_factors: factors(profile),
      keyset_id: encode(random(32)),
      keyslots: [],
    };
    return { keyset, root: random(32) };
  }

  async function registerKey(cache, root, label, softwareKey) {
    validateKeyset(cache, global.location?.origin, true);
    checkSoftwareKey(cache, softwareKey);
    if (!(root instanceof Uint8Array) || root.length !== 32) {
      throw new Error("Offline-Schlüssel ist nicht geladen");
    }
    const name = String(label || "").trim();
    if (!name || name.length > 80) throw new Error("Bitte einen Namen mit höchstens 80 Zeichen eingeben");
    if (cache.keyslots.length >= MAX_KEYS) throw new Error("Zu viele Hardware-Keys registriert");
    const rpID = webauthnRP(cache);
    const credential = await global.navigator.credentials.create({
      publicKey: {
        rp: { id: rpID, name: "TeamVault Offline-Vault" },
        user: { id: random(32), name: cache.username, displayName: cache.username },
        challenge: random(32),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
          { type: "public-key", alg: -8 },
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "cross-platform",
          residentKey: "discouraged",
          userVerification: "required",
        },
        excludeCredentials: cache.keyslots.map((slot) => ({
          type: "public-key",
          id: decode(slot.credential_id_b64, 1, 1024),
        })),
        extensions: { prf: {} },
      },
    });
    if (!credential || !credential.rawId ||
        (credential.authenticatorAttachment && credential.authenticatorAttachment !== "cross-platform")) {
      throw new Error("Ein externer FIDO2-Security-Key ist erforderlich");
    }
    await checkAuthenticatorData(credential.response?.getAuthenticatorData?.(), rpID);
    if (credential.getClientExtensionResults()?.prf?.enabled !== true) {
      throw new Error("Dieser FIDO2-Key oder Browser unterstützt WebAuthn-PRF nicht");
    }
    const credentialID = encode(new Uint8Array(credential.rawId));
    if (cache.keyslots.some((slot) => slot.credential_id_b64 === credentialID)) {
      throw new Error("Dieser FIDO2-Key ist bereits registriert");
    }
    const slot = {
      id: encode(random(16)),
      kind: KEY_KIND,
      version: 1,
      label: name,
      credential_id_b64: credentialID,
      prf_salt_b64: encode(random(32)),
      wrap_salt_b64: encode(random(32)),
      wrap_nonce_b64: encode(random(12)),
    };
    let prf;
    try {
      prf = await getPRF(cache, slot);
      slot.wrapped_root_b64 = await wrapRoot(cache, slot, root, prf, softwareKey);
      return slot;
    } finally {
      if (prf) prf.fill(0);
    }
  }

  async function rotateKeyset(cache, keepIDs, softwareKey, onKey) {
    validateKeyset(cache, global.location?.origin);
    checkSoftwareKey(cache, softwareKey);
    if (!Array.isArray(keepIDs)) throw new Error("Ungültige Hardware-Key-Auswahl");
    const keep = new Set(keepIDs);
    if (!keep.size || keep.size !== keepIDs.length ||
        [...keep].some((id) => !cache.keyslots.some((slot) => slot.id === id))) {
      throw new Error("Mindestens ein registrierter Hardware-Key muss erhalten bleiben");
    }
    const next = { ...cache, keyset_id: encode(random(32)), keyslots: [] };
    const nextRoot = random(32);
    let previousRoot;
    try {
      for (const oldSlot of cache.keyslots.filter((slot) => keep.has(slot.id))) {
        if (onKey) onKey(oldSlot.label);
        let prf;
        let priorRoot;
        try {
          prf = await getPRF(cache, oldSlot);
          const priorKey = await slotKey(cache, oldSlot, prf, softwareKey);
          priorRoot = new Uint8Array(await global.crypto.subtle.decrypt({
            name: "AES-GCM",
            iv: decode(oldSlot.wrap_nonce_b64, 12),
            additionalData: slotAAD(cache, oldSlot),
            tagLength: 128,
          }, priorKey, decode(oldSlot.wrapped_root_b64, 48)));
          if (priorRoot.length !== 32) throw new Error("Ungültiger Offline-Schlüssel");
          if (!previousRoot) {
            if (cache.ciphertext_b64) await verifyRoot(cache, priorRoot, cache.origin);
            previousRoot = priorRoot;
            priorRoot = null;
          } else if (!priorRoot.every((byte, i) => byte === previousRoot[i])) {
            throw new Error("FIDO2-Key passt nicht zur bisherigen Offline-Kopie");
          }
          const slot = {
            ...oldSlot,
            id: encode(random(16)),
            wrap_salt_b64: encode(random(32)),
            wrap_nonce_b64: encode(random(12)),
          };
          slot.wrapped_root_b64 = await wrapRoot(next, slot, nextRoot, prf, softwareKey);
          next.keyslots.push(slot);
        } finally {
          if (prf) prf.fill(0);
          if (priorRoot) priorRoot.fill(0);
        }
      }
      return { keyset: next, root: nextRoot, previousRoot };
    } catch (e) {
      nextRoot.fill(0);
      if (previousRoot) previousRoot.fill(0);
      throw e;
    }
  }

  async function unlockRoot(cache, slotID, softwareKey, expectedOrigin) {
    validateKeyset(cache, expectedOrigin);
    checkSoftwareKey(cache, softwareKey);
    const slot = cache.keyslots.find((item) => item.id === slotID);
    if (!slot) throw new Error("Bitte einen registrierten FIDO2-Key auswählen");
    let prf;
    try {
      prf = await getPRF(cache, slot);
      const key = await slotKey(cache, slot, prf, softwareKey);
      let root;
      try {
        root = new Uint8Array(await global.crypto.subtle.decrypt({
          name: "AES-GCM",
          iv: decode(slot.wrap_nonce_b64, 12),
          additionalData: slotAAD(cache, slot),
          tagLength: 128,
        }, key, decode(slot.wrapped_root_b64, 48)));
      } catch (_) {
        throw new Error("Hardware-Key oder Software-Key falsch, oder Offline-Kopie beschädigt");
      }
      if (root.length !== 32) {
        root.fill(0);
        throw new Error("Ungültiger Offline-Schlüssel");
      }
      return root;
    } finally {
      if (prf) prf.fill(0);
    }
  }

  async function sealSnapshot(keyset, root, snapshot, serverRequirement) {
    validateKeyset(keyset, global.location?.origin);
    if (!requirementAllowed(keyset.profile, serverRequirement)) {
      throw new Error("Offline-Sicherheitsprofil entspricht nicht der Administratorrichtlinie");
    }
    if (!(root instanceof Uint8Array) || root.length !== 32 ||
        snapshot.tenant_id !== keyset.tenant_id || snapshot.tenant_slug !== keyset.tenant_slug ||
        (snapshot.tenant_name || "") !== (keyset.tenant_name || "") ||
        snapshot.user_id !== keyset.user_id || snapshot.username !== keyset.username ||
        !Array.isArray(snapshot.secrets)) {
      throw new Error("Offline-Snapshot passt nicht zum Hardware-Key");
    }
    const cache = {
      ...keyset,
      keyslots: keyset.keyslots.map((slot) => ({ ...slot })),
      snapshot_policy_version: 2,
      server_requirement: serverRequirement,
      created_at: snapshot.synced_at,
      expires_at: global.TVOfflineStore.expiresAt(snapshot.synced_at),
      snapshot_algorithm: "AES-256-GCM",
      dek_nonce_b64: encode(random(12)),
      snapshot_nonce_b64: encode(random(12)),
      secret_count: snapshot.secrets.length,
    };
    if (!cache.expires_at) throw new Error("Ungültiger Offline-Synchronisationszeitpunkt");
    const aad = snapshotAAD(cache);
    const dek = random(32);
    const plain = encoder.encode(JSON.stringify({ ...snapshot, version: VERSION }));
    try {
      const wrapKey = await global.crypto.subtle.importKey("raw", root, "AES-GCM", false, ["encrypt"]);
      const dataKey = await global.crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["encrypt"]);
      cache.wrapped_dek_b64 = encode(new Uint8Array(await global.crypto.subtle.encrypt({
        name: "AES-GCM", iv: decode(cache.dek_nonce_b64, 12), additionalData: aad, tagLength: 128,
      }, wrapKey, dek)));
      cache.ciphertext_b64 = encode(new Uint8Array(await global.crypto.subtle.encrypt({
        name: "AES-GCM", iv: decode(cache.snapshot_nonce_b64, 12), additionalData: aad, tagLength: 128,
      }, dataKey, plain)));
      return cache;
    } finally {
      dek.fill(0);
      plain.fill(0);
    }
  }

  async function verifyRoot(cache, root, expectedOrigin) {
    validateKeyset(cache, expectedOrigin);
    validateSnapshotPolicy(cache);
    if (!(root instanceof Uint8Array) || root.length !== 32 ||
        cache.snapshot_algorithm !== "AES-256-GCM") {
      throw new Error("Offline-Kopie oder Hardware-Key ungültig");
    }
    let dek;
    try {
      const wrapKey = await global.crypto.subtle.importKey("raw", root, "AES-GCM", false, ["decrypt"]);
      dek = new Uint8Array(await global.crypto.subtle.decrypt({
        name: "AES-GCM", iv: decode(cache.dek_nonce_b64, 12),
        additionalData: snapshotAAD(cache), tagLength: 128,
      }, wrapKey, decode(cache.wrapped_dek_b64, 48)));
      if (dek.length !== 32) throw new Error("Ungültiger Offline-Datenschlüssel");
    } catch (_) {
      throw new Error("Hardware-Key passt nicht zu dieser Offline-Kopie");
    } finally {
      if (dek) dek.fill(0);
    }
  }

  async function openSnapshot(cache, root, expectedOrigin) {
    validateKeyset(cache, expectedOrigin);
    validateSnapshotPolicy(cache);
    if (!(root instanceof Uint8Array) || root.length !== 32 ||
        global.TVOfflineStore.isExpired(cache) || cache.snapshot_algorithm !== "AES-256-GCM" ||
        !Number.isSafeInteger(cache.secret_count) || cache.secret_count < 0) {
      throw new Error("Offline-Kopie ist ungültig oder abgelaufen");
    }
    const aad = snapshotAAD(cache);
    let dek;
    let plain;
    try {
      const wrapKey = await global.crypto.subtle.importKey("raw", root, "AES-GCM", false, ["decrypt"]);
      dek = new Uint8Array(await global.crypto.subtle.decrypt({
        name: "AES-GCM", iv: decode(cache.dek_nonce_b64, 12), additionalData: aad, tagLength: 128,
      }, wrapKey, decode(cache.wrapped_dek_b64, 48)));
      if (dek.length !== 32) throw new Error("Ungültiger Offline-Datenschlüssel");
      const dataKey = await global.crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["decrypt"]);
      const ciphertext = decode(cache.ciphertext_b64, 16, 128 * 1024 * 1024);
      plain = new Uint8Array(await global.crypto.subtle.decrypt({
        name: "AES-GCM", iv: decode(cache.snapshot_nonce_b64, 12), additionalData: aad, tagLength: 128,
      }, dataKey, ciphertext));
      const snapshot = JSON.parse(new TextDecoder().decode(plain));
      if (snapshot.version !== VERSION || snapshot.tenant_id !== cache.tenant_id ||
          snapshot.tenant_slug !== cache.tenant_slug || (snapshot.tenant_name || "") !== (cache.tenant_name || "") ||
          snapshot.user_id !== cache.user_id || snapshot.username !== cache.username ||
          snapshot.synced_at !== cache.created_at || !Array.isArray(snapshot.secrets) ||
          snapshot.secrets.length !== cache.secret_count) {
        throw new Error("Offline-Snapshot stimmt nicht mit den Metadaten überein");
      }
      return snapshot;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Offline-")) throw e;
      throw new Error("Offline-Kopie ist beschädigt oder der Hardware-Key passt nicht");
    } finally {
      if (dek) dek.fill(0);
      if (plain) plain.fill(0);
    }
  }

  global.TVOfflineHardware = {
    VERSION,
    createKeyset,
    registerKey,
    unlockRoot,
    rotateKeyset,
    verifyRoot,
    sealSnapshot,
    openSnapshot,
  };
})(typeof window !== "undefined" ? window : globalThis);
