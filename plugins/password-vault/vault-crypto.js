"use strict";

// Password Vault: the cryptography and the vault file format. No Electron here,
// so all of it runs under plain Node in the tests.
//
// The model is Bitwarden's:
//   master password --Argon2id--> master key (32 bytes, never stored)
//   vault key: 32 random bytes, stored only wrapped (AES-256-GCM) by the master key
//   vault data: the whole vault as one JSON document, AES-256-GCM with the vault key
//
// The file header (format, version, Argon2 settings and salt) is bound to both
// ciphertexts as GCM additional data, with a different label for each, so
// editing the header or swapping the two blobs makes decryption fail.

const crypto = require("crypto");
const { argon2id } = require("./argon2.min.js");

const FORMAT = "msp-pp-vault";
const VERSION = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// Bitwarden's Argon2id defaults: 64 MiB, 3 passes, 4 lanes.
const DEFAULT_KDF = Object.freeze({ alg: "argon2id", v: 19, m: 65536, t: 3, p: 4 });

// What a vault file may ask for. The floor stops a doctored header from
// silently weakening a new key; the ceiling stops one from tying the app up.
const KDF_LIMITS = Object.freeze({
  m: [19456, 1048576], // KiB: 19 MiB (OWASP minimum) .. 1 GiB
  t: [2, 20],
  p: [1, 16],
});

class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

function unb64(s, expectLen) {
  if (typeof s !== "string" || s.length > 50 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new VaultError("bad-file", "Not valid base64");
  }
  const buf = Buffer.from(s, "base64");
  if (expectLen !== undefined && buf.length !== expectLen) throw new VaultError("bad-file", "Wrong length");
  return buf;
}

function randomBytes(n) {
  return crypto.randomBytes(n);
}

function checkKdf(kdf) {
  if (!kdf || typeof kdf !== "object") throw new VaultError("bad-file", "No key settings");
  if (kdf.alg !== "argon2id" || kdf.v !== 19) throw new VaultError("bad-file", "Unknown key derivation");
  for (const k of ["m", "t", "p"]) {
    const v = kdf[k];
    const [lo, hi] = KDF_LIMITS[k];
    if (!Number.isInteger(v) || v < lo || v > hi) throw new VaultError("bad-file", "Key settings out of range");
  }
  if (kdf.m < 8 * kdf.p) throw new VaultError("bad-file", "Key settings out of range");
  return { alg: "argon2id", v: 19, m: kdf.m, t: kdf.t, p: kdf.p, salt: unb64(kdf.salt, SALT_BYTES) };
}

// Master password + salt → 32-byte master key (a Buffer the caller wipes).
async function deriveKey(password, kdf) {
  if (typeof password !== "string" || password.length === 0) throw new VaultError("bad-password");
  const k = checkKdf(kdf);
  const pw = Buffer.from(password.normalize("NFC"), "utf8");
  try {
    const out = await argon2id({
      password: pw,
      salt: k.salt,
      parallelism: k.p,
      iterations: k.t,
      memorySize: k.m,
      hashLength: KEY_BYTES,
      outputType: "binary",
    });
    return Buffer.from(out);
  } finally {
    pw.fill(0);
  }
}

function seal(key, plaintext, aad) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce: b64(nonce), ct: b64(ct) };
}

// Throws VaultError("decrypt-failed") for a wrong key or any change to the data.
function open(key, box, aad) {
  if (!box || typeof box !== "object") throw new VaultError("bad-file", "Missing data");
  const nonce = unb64(box.nonce, NONCE_BYTES);
  const all = unb64(box.ct);
  if (all.length < TAG_BYTES) throw new VaultError("bad-file", "Data too short");
  const ct = all.subarray(0, all.length - TAG_BYTES);
  const tag = all.subarray(all.length - TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new VaultError("decrypt-failed");
  }
}

// The header as it is authenticated: a fixed key order, so the bytes are stable.
function headerAad(header, label) {
  const k = header.kdf;
  return Buffer.from(JSON.stringify([label, header.format, header.version, k.alg, k.v, k.m, k.t, k.p, k.salt]), "utf8");
}

function newHeader(kdfOverrides) {
  const kdf = Object.assign({}, DEFAULT_KDF, kdfOverrides || {});
  kdf.salt = b64(randomBytes(SALT_BYTES));
  return { format: FORMAT, version: VERSION, kdf };
}

// Parses and checks a vault file's text. Returns the header + the two boxes.
function parseFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new VaultError("bad-file", "Not a vault file");
  }
  if (!obj || obj.format !== FORMAT) throw new VaultError("bad-file", "Not a vault file");
  if (obj.version !== VERSION) throw new VaultError("bad-version", "Made by a newer version of the plugin");
  checkKdf(obj.kdf);
  return {
    header: { format: obj.format, version: obj.version, kdf: { alg: obj.kdf.alg, v: obj.kdf.v, m: obj.kdf.m, t: obj.kdf.t, p: obj.kdf.p, salt: obj.kdf.salt } },
    keyWrap: obj.keyWrap,
    data: obj.data,
  };
}

function serializeFile(file) {
  return JSON.stringify({
    format: file.header.format,
    version: file.header.version,
    kdf: file.header.kdf,
    keyWrap: file.keyWrap,
    data: file.data,
  }, null, 1);
}

function wrapVaultKey(masterKey, vaultKey, header) {
  return seal(masterKey, vaultKey, headerAad(header, "key"));
}

function unwrapVaultKey(masterKey, keyWrap, header) {
  const k = open(masterKey, keyWrap, headerAad(header, "key"));
  if (k.length !== KEY_BYTES) {
    k.fill(0);
    throw new VaultError("bad-file", "Bad key length");
  }
  return k;
}

function encryptPayload(vaultKey, payload, header) {
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  try {
    return seal(vaultKey, plain, headerAad(header, "data"));
  } finally {
    plain.fill(0);
  }
}

function decryptPayload(vaultKey, box, header) {
  const plain = open(vaultKey, box, headerAad(header, "data"));
  try {
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new VaultError("bad-file", "Damaged vault data");
  } finally {
    plain.fill(0);
  }
}

// Windows Hello: a signature from the Hello key (deterministic RSA) is turned
// into a wrapping key with HKDF. The challenge is the salt, so a new challenge
// gives a new key.
function helloKeyFromSignature(signature, challenge) {
  if (!Buffer.isBuffer(signature) || signature.length < 64) throw new VaultError("hello-failed", "Short signature");
  return Buffer.from(crypto.hkdfSync("sha256", signature, challenge, "msp-pp vault hello v1", KEY_BYTES));
}

function wrapWithHelloKey(helloKey, vaultKey) {
  return seal(helloKey, vaultKey, Buffer.from("msp-pp-vault-hello-1", "utf8"));
}

function unwrapWithHelloKey(helloKey, box) {
  const k = open(helloKey, box, Buffer.from("msp-pp-vault-hello-1", "utf8"));
  if (k.length !== KEY_BYTES) {
    k.fill(0);
    throw new VaultError("decrypt-failed");
  }
  return k;
}

module.exports = {
  FORMAT,
  VERSION,
  KEY_BYTES,
  DEFAULT_KDF,
  KDF_LIMITS,
  VaultError,
  b64,
  unb64,
  randomBytes,
  checkKdf,
  deriveKey,
  seal,
  open,
  headerAad,
  newHeader,
  parseFile,
  serializeFile,
  wrapVaultKey,
  unwrapVaultKey,
  encryptPayload,
  decryptPayload,
  helloKeyFromSignature,
  wrapWithHelloKey,
  unwrapWithHelloKey,
};
