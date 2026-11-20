"use strict";

// Password Vault: the vault's state while the app runs. No Electron here, so the
// tests drive it directly with a fake clock and a fake Windows Hello.
//
// States:
//   none      no vault file yet
//   locked    nothing secret in memory; only the master password opens it
//   reprompt  re-prompt is due: the vault key and entries are wiped, but a copy
//             of the vault key wrapped by the Windows Hello key is kept, so
//             Windows Hello (or the master password) opens it again
//   unlocked  vault key and entries in memory
//
// The Hello-wrapped copy is stored inside the encrypted vault data, so it can
// only be read after the master password has opened the vault: Windows Hello
// can never open the vault after a restart, by construction.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const C = require("./vault-crypto");
const { VaultError } = C;

const MIN_PASSWORD = 12;
const MAX_PASSWORD = 1024;
const MAX_ENTRIES = 5000;
const REPROMPT_CHOICES = [0, 15, 60, 240, 480, -1]; // minutes; 0 = immediately, -1 = never until the app closes
const CLIPBOARD_CHOICES = [10, 30, 60, 120, 0]; // seconds; 0 = never clear
const MAX_REPROMPT_FAILURES = 5;
const FREE_FAILURES = 2; // the 3rd wrong try in a row starts the delays

const DEFAULT_SETTINGS = Object.freeze({
  repromptMinutes: 240,
  lockOnSleep: true,
  clipboardSeconds: 30,
});

const LIMITS = { name: 200, username: 500, password: 1000, url: 2048, notes: 10000, folder: 100 };

function str(v, max) {
  return typeof v === "string" ? v.substring(0, max) : "";
}

function newId() {
  return crypto.randomBytes(9).toString("hex");
}

function isoOr(v, fallback) {
  if (typeof v !== "string" || v.length > 40) return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

// Cleans one entry from the vault or the renderer. Returns null when unusable.
function sanitizeEntry(e, nowIso) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const name = str(e.name, LIMITS.name).trim();
  if (!name) return null;
  const id = typeof e.id === "string" && /^[a-z0-9-]{1,64}$/i.test(e.id) ? e.id : newId();
  return {
    id,
    name,
    username: str(e.username, LIMITS.username),
    password: str(e.password, LIMITS.password),
    url: str(e.url, LIMITS.url).trim(),
    match: e.match === "domain" ? "domain" : "host", // for auto-fill: this site only, or its subdomains too
    notes: str(e.notes, LIMITS.notes),
    folder: str(e.folder, LIMITS.folder).trim(),
    created: isoOr(e.created, nowIso),
    updated: isoOr(e.updated, nowIso),
  };
}

function sanitizeSettings(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  if (s && typeof s === "object") {
    if (REPROMPT_CHOICES.includes(s.repromptMinutes)) out.repromptMinutes = s.repromptMinutes;
    if (typeof s.lockOnSleep === "boolean") out.lockOnSleep = s.lockOnSleep;
    if (CLIPBOARD_CHOICES.includes(s.clipboardSeconds)) out.clipboardSeconds = s.clipboardSeconds;
  }
  return out;
}

// How strict a choice is, for "loosening needs the master password".
function repromptRank(m) {
  return m === -1 ? Infinity : m;
}
function clipboardRank(s) {
  return s === 0 ? Infinity : s;
}

function isLooser(oldS, newS) {
  return repromptRank(newS.repromptMinutes) > repromptRank(oldS.repromptMinutes) ||
    (oldS.lockOnSleep && !newS.lockOnSleep) ||
    clipboardRank(newS.clipboardSeconds) > clipboardRank(oldS.clipboardSeconds);
}

function sanitizeHello(h) {
  if (!h || typeof h !== "object") return null;
  try {
    C.unb64(h.challenge, 32);
    C.unb64(h.blob && h.blob.nonce, 12);
    C.unb64(h.blob && h.blob.ct);
  } catch {
    return null;
  }
  return { challenge: h.challenge, blob: { nonce: h.blob.nonce, ct: h.blob.ct } };
}

function sanitizePayload(p, nowIso) {
  const entries = [];
  const seen = new Set();
  const list = p && Array.isArray(p.entries) ? p.entries : [];
  for (const raw of list) {
    const e = sanitizeEntry(raw, nowIso);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(e);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return {
    version: 1,
    entries,
    settings: sanitizeSettings(p && p.settings),
    hello: sanitizeHello(p && p.hello),
  };
}

function checkNewPassword(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new VaultError("password-too-short");
  if (pw.length > MAX_PASSWORD) throw new VaultError("password-too-long");
}

let tmpCounter = 0;
async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  tmpCounter = (tmpCounter + 1) % 1e6;
  const tmp = file + "." + process.pid + "." + tmpCounter + ".tmp";
  await fsp.writeFile(tmp, text, "utf8");
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      // Windows: antivirus or a sync tool can hold the file for a moment.
      if (i < 3 && e && (e.code === "EPERM" || e.code === "EACCES" || e.code === "EBUSY")) {
        await new Promise((r) => setTimeout(r, 100 * (i + 1)));
        continue;
      }
      await fsp.unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

class VaultSession {
  // opts: { filePath, hello?, now?, kdf? (test overrides) }
  // hello: { sign(challenge: Buffer, { create }): Promise<Buffer> } or null
  constructor(opts) {
    this.filePath = opts.filePath;
    this.hello = opts.hello || null;
    this.now = opts.now || Date.now;
    this.kdfOverrides = opts.kdf || null;
    this.state = "locked";
    this._vaultKey = null;
    this._file = null; // parsed header + boxes of the file as last read or written
    this._payload = null;
    this._helloMem = null; // { challenge, blob } kept through a re-prompt
    this._unlockedAt = 0;
    this._failures = 0;
    this._retryAt = 0;
    this._repromptFailures = 0;
    this._busy = Promise.resolve();
  }

  // Runs fn after any operation already running, so two clicks can't interleave.
  _serial(fn) {
    const run = this._busy.then(fn, fn);
    this._busy = run.catch(() => {});
    return run;
  }

  async init() {
    try {
      await fsp.access(this.filePath);
      this.state = "locked";
    } catch {
      this.state = "none";
    }
    return this.status();
  }

  status() {
    this.tick();
    const s = {
      state: this.state,
      helloReady: this.state === "reprompt" && !!this._helloMem && !!this.hello,
      retryInMs: Math.max(0, this._retryAt - this.now()),
    };
    if (this.state === "unlocked") {
      s.settings = Object.assign({}, this._payload.settings);
      s.helloEnabled = !!this._payload.hello;
      s.repromptAt = this._repromptAt();
      s.count = this._payload.entries.length;
    }
    return s;
  }

  _repromptAt() {
    const m = this._payload ? this._payload.settings.repromptMinutes : -1;
    if (m <= 0) return null; // immediately is driven by the window, never by the clock
    return this._unlockedAt + m * 60000;
  }

  // Moves to re-prompt when its time has passed. Called on every operation.
  tick() {
    if (this.state !== "unlocked") return;
    const at = this._repromptAt();
    if (at !== null && this.now() >= at) this.reprompt("timer");
  }

  _wipeOpen() {
    if (this._vaultKey) this._vaultKey.fill(0);
    this._vaultKey = null;
    this._payload = null;
    this._file = null;
  }

  // Re-prompt: wipe the vault key and entries; keep the Hello-wrapped copy if any.
  reprompt() {
    if (this.state !== "unlocked") return this.state;
    const hello = this._payload && this._payload.hello;
    this._helloMem = hello && this.hello ? { challenge: hello.challenge, blob: hello.blob } : null;
    this._wipeOpen();
    this._repromptFailures = 0;
    this.state = this._helloMem ? "reprompt" : "locked";
    return this.state;
  }

  // Full lock: nothing kept. Hello can't answer until the master password is used.
  lock() {
    this._wipeOpen();
    this._helloMem = null;
    if (this.state !== "none") this.state = "locked";
    return this.state;
  }

  _requireUnlocked() {
    this.tick();
    if (this.state !== "unlocked") throw new VaultError("locked");
  }

  _checkRetry() {
    const wait = this._retryAt - this.now();
    if (wait > 0) throw Object.assign(new VaultError("wait"), { retryInMs: wait });
  }

  _recordFailure() {
    this._failures++;
    if (this._failures > FREE_FAILURES) {
      const secs = Math.min(30, Math.pow(2, this._failures - FREE_FAILURES));
      this._retryAt = this.now() + secs * 1000;
    }
    if (this.state === "reprompt") {
      this._repromptFailures++;
      if (this._repromptFailures >= MAX_REPROMPT_FAILURES) this.lock();
    }
  }

  _recordSuccess() {
    this._failures = 0;
    this._retryAt = 0;
    this._repromptFailures = 0;
  }

  async _readFile() {
    let text;
    try {
      text = await fsp.readFile(this.filePath, "utf8");
    } catch (e) {
      if (e && e.code === "ENOENT") throw new VaultError("no-vault");
      throw e;
    }
    return C.parseFile(text);
  }

  _open(vaultKey, file) {
    const payload = sanitizePayload(C.decryptPayload(vaultKey, file.data, file.header), new Date(this.now()).toISOString());
    this._vaultKey = vaultKey;
    this._file = file;
    this._payload = payload;
    this._helloMem = null;
    this._unlockedAt = this.now();
    this.state = "unlocked";
    this._recordSuccess();
  }

  async _persist() {
    const file = {
      header: this._file.header,
      keyWrap: this._file.keyWrap,
      data: C.encryptPayload(this._vaultKey, this._payload, this._file.header),
    };
    const text = C.serializeFile(file);
    // Keep the version being replaced as .bak, then swap the new one in.
    await fsp.copyFile(this.filePath, this.filePath + ".bak").catch(() => {});
    await writeAtomic(this.filePath, text);
    this._file = file;
  }

  create(password) {
    return this._serial(async () => {
      if (this.state !== "none") throw new VaultError("exists");
      checkNewPassword(password);
      const header = C.newHeader(this.kdfOverrides);
      const vaultKey = C.randomBytes(C.KEY_BYTES);
      const masterKey = await C.deriveKey(password, header.kdf);
      try {
        const payload = sanitizePayload({}, new Date(this.now()).toISOString());
        const file = {
          header,
          keyWrap: C.wrapVaultKey(masterKey, vaultKey, header),
          data: C.encryptPayload(vaultKey, payload, header),
        };
        await writeAtomic(this.filePath, C.serializeFile(file));
        this._vaultKey = vaultKey;
        this._file = file;
        this._payload = payload;
        this._unlockedAt = this.now();
        this.state = "unlocked";
        this._recordSuccess();
      } finally {
        masterKey.fill(0);
      }
      return this.status();
    });
  }

  // Master password → vault key, against the file's header. Counts a wrong try.
  async _keyFromPassword(password, file) {
    this._checkRetry();
    if (typeof password !== "string" || !password || password.length > MAX_PASSWORD) {
      this._recordFailure();
      throw new VaultError("wrong-password");
    }
    const masterKey = await C.deriveKey(password, file.header.kdf);
    try {
      return C.unwrapVaultKey(masterKey, file.keyWrap, file.header);
    } catch (e) {
      if (e.code === "decrypt-failed") {
        this._recordFailure();
        throw new VaultError("wrong-password");
      }
      throw e;
    } finally {
      masterKey.fill(0);
    }
  }

  unlock(password) {
    return this._serial(async () => {
      if (this.state === "unlocked") return this.status();
      if (this.state === "none") throw new VaultError("no-vault");
      const file = await this._readFile();
      const vaultKey = await this._keyFromPassword(password, file);
      try {
        this._open(vaultKey, file);
      } catch (e) {
        vaultKey.fill(0);
        throw e;
      }
      return this.status();
    });
  }

  unlockWithHello() {
    return this._serial(async () => {
      if (this.state === "unlocked") return this.status();
      if (this.state !== "reprompt" || !this._helloMem || !this.hello) throw new VaultError("hello-unavailable");
      const mem = this._helloMem;
      const challenge = C.unb64(mem.challenge, 32);
      const signature = await this.hello.sign(challenge, { create: false }); // throws hello-* errors
      // Re-check: a timer or Lock now may have run while Windows Hello was open.
      if (this.state !== "reprompt" || this._helloMem !== mem) {
        signature.fill(0);
        throw new VaultError("locked");
      }
      const helloKey = C.helloKeyFromSignature(signature, challenge);
      signature.fill(0);
      let vaultKey;
      try {
        vaultKey = C.unwrapWithHelloKey(helloKey, mem.blob);
      } catch {
        // A different Hello key (removed and re-created in Windows) or a signature
        // that isn't repeatable: Hello can't help this session any more.
        this.lock();
        throw new VaultError("hello-mismatch");
      } finally {
        helloKey.fill(0);
      }
      try {
        const file = await this._readFile();
        this._open(vaultKey, file);
      } catch (e) {
        vaultKey.fill(0);
        this.lock();
        throw e;
      }
      return this.status();
    });
  }

  // ---------- Entries (all need the vault unlocked) ----------

  listEntries() {
    this._requireUnlocked();
    return this._payload.entries.map((e) => ({
      id: e.id,
      name: e.name,
      username: e.username,
      url: e.url,
      match: e.match,
      folder: e.folder,
      hasPassword: e.password.length > 0,
      updated: e.updated,
    }));
  }

  getEntry(id) {
    this._requireUnlocked();
    const e = this._payload.entries.find((x) => x.id === id);
    if (!e) throw new VaultError("not-found");
    return Object.assign({}, e);
  }

  getField(id, field) {
    if (field !== "username" && field !== "password" && field !== "url") throw new VaultError("bad-field");
    return this.getEntry(id)[field];
  }

  saveEntry(entry) {
    return this._serial(async () => {
      this._requireUnlocked();
      const nowIso = new Date(this.now()).toISOString();
      const list = this._payload.entries;
      const idx = entry && typeof entry.id === "string" ? list.findIndex((x) => x.id === entry.id) : -1;
      const clean = sanitizeEntry(Object.assign({}, entry, {
        created: idx >= 0 ? list[idx].created : nowIso,
        updated: nowIso,
      }), nowIso);
      if (!clean) throw new VaultError("bad-entry");
      if (idx < 0 && list.length >= MAX_ENTRIES) throw new VaultError("too-many");
      if (idx >= 0) list[idx] = clean;
      else {
        if (list.some((x) => x.id === clean.id)) clean.id = newId();
        list.push(clean);
      }
      await this._persist();
      return { id: clean.id };
    });
  }

  deleteEntry(id) {
    return this._serial(async () => {
      this._requireUnlocked();
      const list = this._payload.entries;
      const idx = list.findIndex((x) => x.id === id);
      if (idx < 0) throw new VaultError("not-found");
      list.splice(idx, 1);
      await this._persist();
      return { ok: true };
    });
  }

  // ---------- Settings ----------

  // Checks the master password while unlocked, without changing state.
  async _verifyPassword(password) {
    const vk = await this._keyFromPassword(password, this._file);
    const same = crypto.timingSafeEqual(vk, this._vaultKey);
    vk.fill(0);
    if (!same) throw new VaultError("wrong-password");
    this._recordSuccess();
  }

  saveSettings(patch, password) {
    return this._serial(async () => {
      this._requireUnlocked();
      const old = this._payload.settings;
      const next = sanitizeSettings(Object.assign({}, old, patch || {}));
      if (isLooser(old, next)) {
        if (!password) throw new VaultError("password-required");
        await this._verifyPassword(password);
      }
      this._payload.settings = next;
      await this._persist();
      return this.status();
    });
  }

  enableHello(password) {
    return this._serial(async () => {
      this._requireUnlocked();
      if (!this.hello) throw new VaultError("hello-unavailable");
      await this._verifyPassword(password);
      const challenge = C.randomBytes(32);
      const signature = await this.hello.sign(challenge, { create: true });
      if (this.state !== "unlocked") {
        signature.fill(0);
        throw new VaultError("locked");
      }
      const helloKey = C.helloKeyFromSignature(signature, challenge);
      signature.fill(0);
      try {
        this._payload.hello = { challenge: C.b64(challenge), blob: C.wrapWithHelloKey(helloKey, this._vaultKey) };
      } finally {
        helloKey.fill(0);
      }
      await this._persist();
      return this.status();
    });
  }

  disableHello() {
    return this._serial(async () => {
      this._requireUnlocked();
      this._payload.hello = null;
      await this._persist();
      return this.status();
    });
  }

  changePassword(current, next) {
    return this._serial(async () => {
      this._requireUnlocked();
      checkNewPassword(next);
      await this._verifyPassword(current);
      // New salt; the vault key stays, so only it is re-wrapped.
      const header = C.newHeader(this.kdfOverrides);
      const masterKey = await C.deriveKey(next, header.kdf);
      try {
        this._file = { header, keyWrap: C.wrapVaultKey(masterKey, this._vaultKey, header), data: null };
      } finally {
        masterKey.fill(0);
      }
      await this._persist();
      return this.status();
    });
  }

  // Copies the encrypted file as it is on disk. Needs the vault unlocked, so a
  // passer-by can't take a copy while it's locked.
  backupTo(dest) {
    return this._serial(async () => {
      this._requireUnlocked();
      await fsp.copyFile(this.filePath, dest);
      return { ok: true };
    });
  }

  deleteVault(password) {
    return this._serial(async () => {
      this._requireUnlocked();
      await this._verifyPassword(password);
      this.lock();
      await fsp.unlink(this.filePath).catch(() => {});
      await fsp.unlink(this.filePath + ".bak").catch(() => {});
      this.state = "none";
      return this.status();
    });
  }
}

module.exports = {
  VaultSession,
  VaultError,
  sanitizeEntry,
  sanitizeSettings,
  sanitizePayload,
  isLooser,
  DEFAULT_SETTINGS,
  REPROMPT_CHOICES,
  CLIPBOARD_CHOICES,
  MIN_PASSWORD,
  MAX_ENTRIES,
  MAX_REPROMPT_FAILURES,
};
