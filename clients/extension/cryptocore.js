/* TeamVault browser cryptocore — client-side only (Zero-Knowledge).
 * Uses vendored tweetnacl + hash-wasm argon2 + WebCrypto AES-GCM.
 * Must never send master password to server.
 */
(function (global) {
  function b64enc(u8) {
    let s = "";
    u8.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  }
  function b64dec(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat(a, b) {
    const o = new Uint8Array(a.length + b.length);
    o.set(a, 0);
    o.set(b, a.length);
    return o;
  }
  function u32be(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, false);
    return b;
  }

  async function argon2id(password, salt, params) {
    const time = params.Time || params.time || 3;
    const mem = params.Memory || params.memory || 65536;
    const para = params.Threads || params.threads || 1;
    const hashLength = params.KeyLen || params.keyLen || 32;
    const hw = global.hashwasm || global.hashWasm;
    if (!hw || !hw.argon2id) throw new Error("argon2 library missing");
    const hex = await hw.argon2id({
      password,
      salt,
      parallelism: para,
      iterations: time,
      memorySize: mem,
      hashLength,
      outputType: "hex",
    });
    const out = new Uint8Array(hashLength);
    for (let i = 0; i < hashLength; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  async function createIdentity(masterPassword, params) {
    const salt = nacl.randomBytes(16);
    const mk = await argon2id(masterPassword, salt, params);
    const kp = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const sealed = nacl.secretbox(kp.secretKey, nonce, mk);
    mk.fill(0);
    return {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      salt,
      nonce,
      sealedPrivateKey: sealed,
    };
  }

  async function unlockPrivateKey(masterPassword, salt, nonce, sealed, params) {
    const mk = await argon2id(masterPassword, salt, params);
    const sk = nacl.secretbox.open(sealed, nonce, mk);
    mk.fill(0);
    if (!sk) throw new Error("wrong master password");
    return sk;
  }

  async function sealPrivateKey(secretKey, masterPassword, params) {
    const salt = nacl.randomBytes(16);
    const mk = await argon2id(masterPassword, salt, params);
    const nonce = nacl.randomBytes(24);
    const sealed = nacl.secretbox(secretKey, nonce, mk);
    mk.fill(0);
    return { salt, nonce, sealedPrivateKey: sealed };
  }

  async function sealWithRecoveryKit(secretKey, kitSecret, params) {
    const salt = nacl.randomBytes(16);
    const rk = await argon2id(kitSecret, salt, params);
    const nonce = nacl.randomBytes(24);
    const sealed = nacl.secretbox(secretKey, nonce, rk);
    rk.fill(0);
    return { salt, nonce, sealed };
  }

  function sealForEscrow(secretKey, escrowPub) {
    const eph = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const ct = nacl.box(secretKey, nonce, escrowPub, eph.secretKey);
    return concat(eph.publicKey, concat(nonce, ct));
  }

  function randomKitSecret() {
    return nacl.randomBytes(32);
  }

  function generateDataKey() {
    return nacl.randomBytes(32);
  }

  async function importAesKey(dk) {
    return crypto.subtle.importKey("raw", dk, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function encryptPayload(plaintextU8, dataKey, keyVersion) {
    const key = await importAesKey(dataKey);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const aad = u32be(keyVersion);
    const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, plaintextU8);
    return { nonce, ciphertext: new Uint8Array(ctBuf), keyVersion };
  }

  async function decryptPayload(ciphertextU8, nonce, dataKey, keyVersion) {
    const key = await importAesKey(dataKey);
    const aad = u32be(keyVersion);
    const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, ciphertextU8);
    return new Uint8Array(ptBuf);
  }

  async function encryptTitle(title, dataKey, keyVersion) {
    const enc = new TextEncoder().encode(title);
    return encryptPayload(enc, dataKey, keyVersion);
  }

  async function decryptTitle(ciphertextU8, nonce, dataKey, keyVersion) {
    const pt = await decryptPayload(ciphertextU8, nonce, dataKey, keyVersion);
    return new TextDecoder().decode(pt);
  }

  function sealDataKeyForRecipient(dataKey, recipientPub, keyVersion) {
    const eph = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const wrapped = nacl.box(dataKey, nonce, recipientPub, eph.secretKey);
    return {
      keyVersion,
      ephemeralPub: eph.publicKey,
      nonce,
      wrappedDK: wrapped,
    };
  }

  function openDataKeyEnvelope(ephemeralPub, nonce, wrappedDK, recipientPriv) {
    const dk = nacl.box.open(wrappedDK, nonce, ephemeralPub, recipientPriv);
    if (!dk) throw new Error("envelope open failed");
    return dk;
  }

  function envelopeToAPI(userId, env) {
    return {
      user_id: userId,
      key_version: env.keyVersion,
      wrapped_dk_b64: b64enc(env.wrappedDK),
      ephemeral_pub_b64: b64enc(env.ephemeralPub),
      nonce_b64: b64enc(env.nonce),
    };
  }

  function generateBoxKeyPair() {
    return nacl.box.keyPair();
  }

  global.TVCrypto = {
    b64enc,
    b64dec,
    createIdentity,
    unlockPrivateKey,
    sealPrivateKey,
    sealWithRecoveryKit,
    sealForEscrow,
    randomKitSecret,
    generateDataKey,
    generateBoxKeyPair,
    encryptPayload,
    decryptPayload,
    encryptTitle,
    decryptTitle,
    sealDataKeyForRecipient,
    openDataKeyEnvelope,
    envelopeToAPI,
  };
})(window);
