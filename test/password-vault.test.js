"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const C = require("../plugins/password-vault/vault-crypto");
const V = require("../plugins/password-vault/vault-session");
const T = require("../plugins/password-vault/vault-tools");
const H = require("../plugins/password-vault/windows-hello");

// The lightest Argon2 settings a vault file may have, so the tests stay quick.
const FAST_KDF = { m: 19456, t: 2, p: 1 };
const PW = "correct horse battery";
const PW2 = "another long passphrase";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "msp-vault-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function vaultFile() {
  return path.join(dir, "vault.json");
}

// A Windows Hello stand-in: an RSA key signing with PKCS#1 v1.5, like Hello.
function fakeHello() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const h = {
    key: privateKey,
    calls: 0,
    answer: "ok", // or an error code to throw
    async sign(challenge) {
      h.calls++;
      if (h.answer !== "ok") throw new H.HelloError(h.answer);
      return crypto.sign("sha256", challenge, h.key);
    },
  };
  return h;
}

function makeSession(extra) {
  const clock = { t: Date.parse("2026-11-18T12:00:00Z") };
  const s = new V.VaultSession(Object.assign({
    filePath: vaultFile(),
    now: () => clock.t,
    kdf: FAST_KDF,
  }, extra || {}));
  s.clock = clock;
  return s;
}

async function created(extra) {
  const s = makeSession(extra);
  await s.init();
  await s.create(PW);
  return s;
}

async function rejectsCode(promise, code) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  expect(err).not.toBeNull();
  expect(err.code).toBe(code);
  return err;
}

function throwsCode(fn, code) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  expect(err).not.toBeNull();
  expect(err.code).toBe(code);
}

// ==================== Crypto ====================

describe("password-vault crypto", () => {
  test("Argon2id matches the reference implementation's test vector", async () => {
    // phc-winner-argon2 test.c: argon2id v19, t=2, m=2^16, p=1, "password", "somesalt"
    const { argon2id } = require("../plugins/password-vault/argon2.min.js");
    const hex = await argon2id({
      password: "password", salt: "somesalt", parallelism: 1, iterations: 2, memorySize: 65536, hashLength: 32, outputType: "hex",
    });
    expect(hex).toBe("09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7");
  });

  test("the same password and salt give the same key, a different one doesn't", async () => {
    const h = C.newHeader(FAST_KDF);
    const a = await C.deriveKey(PW, h.kdf);
    const b = await C.deriveKey(PW, h.kdf);
    const c = await C.deriveKey(PW2, h.kdf);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  test("new vaults use Bitwarden's Argon2id defaults", () => {
    const h = C.newHeader();
    expect(h.kdf).toMatchObject({ alg: "argon2id", v: 19, m: 65536, t: 3, p: 4 });
    expect(C.unb64(h.kdf.salt).length).toBe(16);
  });

  test("Argon2 settings outside the limits are refused", () => {
    const base = C.newHeader(FAST_KDF).kdf;
    expect(() => C.checkKdf(base)).not.toThrow();
    for (const bad of [{ m: 1024 }, { m: 4 * 1048576 }, { t: 1 }, { t: 100 }, { p: 0 }, { p: 64 }, { alg: "argon2i" }, { v: 16 }, { salt: "AAAA" }]) {
      expect(() => C.checkKdf(Object.assign({}, base, bad))).toThrow(C.VaultError);
    }
  });

  test("seal/open round-trips and detects any change", () => {
    const key = crypto.randomBytes(32);
    const aad = Buffer.from("x");
    const box = C.seal(key, Buffer.from("secret"), aad);
    expect(C.open(key, box, aad).toString()).toBe("secret");
    expect(() => C.open(crypto.randomBytes(32), box, aad)).toThrow(expect.objectContaining({ code: "decrypt-failed" }));
    expect(() => C.open(key, box, Buffer.from("y"))).toThrow(expect.objectContaining({ code: "decrypt-failed" }));
    const ct = C.unb64(box.ct);
    ct[0] ^= 1;
    expect(() => C.open(key, { nonce: box.nonce, ct: C.b64(ct) }, aad)).toThrow(expect.objectContaining({ code: "decrypt-failed" }));
  });

  test("each seal uses a fresh nonce", () => {
    const key = crypto.randomBytes(32);
    const a = C.seal(key, Buffer.from("same"), Buffer.alloc(0));
    const b = C.seal(key, Buffer.from("same"), Buffer.alloc(0));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
  });

  test("the key wrap and the data can't be swapped", () => {
    const h = C.newHeader(FAST_KDF);
    const key = crypto.randomBytes(32);
    const vk = crypto.randomBytes(32);
    const wrap = C.wrapVaultKey(key, vk, h);
    expect(() => C.decryptPayload(key, wrap, h)).toThrow(expect.objectContaining({ code: "decrypt-failed" }));
  });

  test("Hello key: same signature + challenge give the same key", () => {
    const sig = crypto.randomBytes(256);
    const ch = crypto.randomBytes(32);
    const k1 = C.helloKeyFromSignature(sig, ch);
    expect(k1.equals(C.helloKeyFromSignature(sig, ch))).toBe(true);
    expect(k1.equals(C.helloKeyFromSignature(sig, crypto.randomBytes(32)))).toBe(false);
    expect(() => C.helloKeyFromSignature(Buffer.alloc(10), ch)).toThrow();
  });
});

// ==================== Vault file ====================

describe("password-vault file", () => {
  test("nothing readable is in the file", async () => {
    const s = await created();
    await s.saveEntry({ name: "Contoso Admin", username: "admin@contoso.example", password: "Hunter2-very-secret", url: "https://contoso.example", notes: "break glass" });
    const text = fs.readFileSync(vaultFile(), "utf8");
    for (const word of ["Contoso", "admin@", "Hunter2", "break glass", "contoso.example"]) {
      expect(text).not.toContain(word);
    }
    const obj = JSON.parse(text);
    expect(Object.keys(obj).sort()).toEqual(["data", "format", "kdf", "keyWrap", "version"]);
  });

  test("survives a restart: a new session opens it with the password", async () => {
    const s = await created();
    await s.saveEntry({ name: "Router", username: "root", password: "pw-123" });
    const s2 = makeSession();
    expect((await s2.init()).state).toBe("locked");
    await s2.unlock(PW);
    expect(s2.listEntries().map((e) => e.name)).toEqual(["Router"]);
    expect(s2.getField(s2.listEntries()[0].id, "password")).toBe("pw-123");
  });

  test("editing the header (weaker Argon2 settings) stops it opening", async () => {
    await created();
    const obj = JSON.parse(fs.readFileSync(vaultFile(), "utf8"));
    obj.kdf.t = 3;
    fs.writeFileSync(vaultFile(), JSON.stringify(obj));
    const s2 = makeSession();
    await s2.init();
    await rejectsCode(s2.unlock(PW), "wrong-password");
  });

  test("a changed byte in the data is caught", async () => {
    await created();
    const obj = JSON.parse(fs.readFileSync(vaultFile(), "utf8"));
    const ct = C.unb64(obj.data.ct);
    ct[5] ^= 0x40;
    obj.data.ct = C.b64(ct);
    fs.writeFileSync(vaultFile(), JSON.stringify(obj));
    const s2 = makeSession();
    await s2.init();
    await rejectsCode(s2.unlock(PW), "decrypt-failed");
    expect(s2.state).toBe("locked");
  });

  test("a file from a newer version or not a vault at all is refused", () => {
    expect(() => C.parseFile("{}")).toThrow(expect.objectContaining({ code: "bad-file" }));
    expect(() => C.parseFile("nope")).toThrow(expect.objectContaining({ code: "bad-file" }));
    const h = C.newHeader(FAST_KDF);
    expect(() => C.parseFile(JSON.stringify({ format: C.FORMAT, version: 2, kdf: h.kdf }))).toThrow(expect.objectContaining({ code: "bad-version" }));
  });

  test("each save keeps the previous file as .bak", async () => {
    const s = await created();
    const first = fs.readFileSync(vaultFile(), "utf8");
    await s.saveEntry({ name: "A" });
    expect(fs.readFileSync(vaultFile() + ".bak", "utf8")).toBe(first);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

// ==================== Session: create / unlock ====================

describe("password-vault create and unlock", () => {
  test("starts as none, then unlocked after create", async () => {
    const s = makeSession();
    expect((await s.init()).state).toBe("none");
    await s.create(PW);
    expect(s.status().state).toBe("unlocked");
    expect(s.status().settings).toEqual(V.DEFAULT_SETTINGS);
  });

  test("master password needs 12 characters", async () => {
    const s = makeSession();
    await s.init();
    await rejectsCode(s.create("short"), "password-too-short");
    await rejectsCode(s.create("x".repeat(2000)), "password-too-long");
    expect(s.state).toBe("none");
  });

  test("can't create over an existing vault", async () => {
    const s = await created();
    await rejectsCode(s.create(PW2), "exists");
  });

  test("wrong password keeps it locked; the 3rd wrong try starts a delay", async () => {
    const s = await created();
    s.lock();
    await rejectsCode(s.unlock("wrong one 1"), "wrong-password");
    await rejectsCode(s.unlock("wrong one 2"), "wrong-password");
    expect(s.status().retryInMs).toBe(0);
    await rejectsCode(s.unlock("wrong one 3"), "wrong-password");
    expect(s.status().retryInMs).toBe(2000);
    const err = await rejectsCode(s.unlock(PW), "wait");
    expect(err.retryInMs).toBe(2000);
    s.clock.t += 2000;
    await rejectsCode(s.unlock("wrong one 4"), "wrong-password");
    expect(s.status().retryInMs).toBe(4000);
    s.clock.t += 4000;
    await s.unlock(PW);
    expect(s.state).toBe("unlocked");
    expect(s.status().retryInMs).toBe(0);
  });

  test("delays top out at 30 seconds", async () => {
    const s = await created();
    s.lock();
    for (let i = 0; i < 10; i++) {
      s.clock.t += 60000;
      await rejectsCode(s.unlock("nope nope " + i), "wrong-password");
    }
    expect(s.status().retryInMs).toBe(30000);
  });

  test("lock wipes the key and entries", async () => {
    const s = await created();
    const keyRef = s._vaultKey;
    s.lock();
    expect(s.state).toBe("locked");
    expect(keyRef.every((b) => b === 0)).toBe(true);
    expect(s._payload).toBeNull();
    throwsCode(() => s.listEntries(), "locked");
  });

  test("two unlocks at once don't interleave", async () => {
    const s = await created();
    s.lock();
    const [a, b] = await Promise.all([s.unlock(PW), s.unlock(PW)]);
    expect(a.state).toBe("unlocked");
    expect(b.state).toBe("unlocked");
  });
});

// ==================== Re-prompt timer ====================

describe("password-vault re-prompt", () => {
  test("default 4 hours: asks again after 4 hours from unlock", async () => {
    const s = await created();
    s.clock.t += 4 * 3600000 - 1;
    expect(s.status().state).toBe("unlocked");
    s.clock.t += 1;
    expect(s.status().state).toBe("locked"); // no Windows Hello → locked
  });

  test("the timer counts from the last unlock, not from activity", async () => {
    const s = await created();
    await s.saveSettings({ repromptMinutes: 15 });
    s.clock.t += 10 * 60000;
    s.listEntries(); // activity doesn't extend it
    s.clock.t += 5 * 60000;
    throwsCode(() => s.listEntries(), "locked");
  });

  test("every operation checks the timer (a PC that slept through a tick)", async () => {
    const s = await created();
    await s.saveSettings({ repromptMinutes: 15 });
    s.clock.t += 16 * 60000;
    await rejectsCode(s.saveEntry({ name: "late" }), "locked");
  });

  test("never: stays open until the app closes", async () => {
    const s = await created();
    await s.saveSettings({ repromptMinutes: -1 }, PW);
    s.clock.t += 30 * 24 * 3600000;
    expect(s.status().state).toBe("unlocked");
    expect(s.status().repromptAt).toBeNull();
  });

  test("immediately: the clock never re-prompts; the window does", async () => {
    const s = await created();
    await s.saveSettings({ repromptMinutes: 0 });
    s.clock.t += 24 * 3600000;
    expect(s.status().state).toBe("unlocked");
    s.reprompt();
    expect(s.status().state).toBe("locked");
  });

  test("a restart always needs the master password", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    const s2 = makeSession({ hello });
    await s2.init();
    expect(s2.status().state).toBe("locked");
    expect(s2.status().helloReady).toBe(false);
    await rejectsCode(s2.unlockWithHello(), "hello-unavailable");
  });
});

// ==================== Settings ====================

describe("password-vault settings", () => {
  test("stricter changes need no password, looser ones do", async () => {
    const s = await created();
    await s.saveSettings({ repromptMinutes: 60 }); // 4h → 1h: stricter
    await s.saveSettings({ clipboardSeconds: 10 });
    await rejectsCode(s.saveSettings({ repromptMinutes: 480 }), "password-required");
    await rejectsCode(s.saveSettings({ lockOnSleep: false }), "password-required");
    await rejectsCode(s.saveSettings({ clipboardSeconds: 0 }), "password-required");
    await rejectsCode(s.saveSettings({ repromptMinutes: 480 }, "wrong password!"), "wrong-password");
    await s.saveSettings({ repromptMinutes: 480, lockOnSleep: false }, PW);
    expect(s.status().settings).toMatchObject({ repromptMinutes: 480, lockOnSleep: false, clipboardSeconds: 10 });
  });

  test("isLooser ranks never and no-clear as loosest", () => {
    const base = V.DEFAULT_SETTINGS;
    expect(V.isLooser(base, Object.assign({}, base, { repromptMinutes: -1 }))).toBe(true);
    expect(V.isLooser(Object.assign({}, base, { repromptMinutes: -1 }), base)).toBe(false);
    expect(V.isLooser(base, Object.assign({}, base, { repromptMinutes: 0 }))).toBe(false);
    expect(V.isLooser(base, Object.assign({}, base, { clipboardSeconds: 0 }))).toBe(true);
    expect(V.isLooser(base, Object.assign({}, base, { lockOnSleep: true }))).toBe(false);
  });

  test("settings are stored encrypted, so editing the file can't loosen them", async () => {
    const s = await created();
    const text = fs.readFileSync(vaultFile(), "utf8");
    expect(text).not.toContain("repromptMinutes");
    await s.saveSettings({ repromptMinutes: 15 });
    const s2 = makeSession();
    await s2.init();
    await s2.unlock(PW);
    expect(s2.status().settings.repromptMinutes).toBe(15);
  });

  test("unknown values fall back to the defaults", () => {
    expect(V.sanitizeSettings({ repromptMinutes: 7, lockOnSleep: "no", clipboardSeconds: 5 })).toEqual(V.DEFAULT_SETTINGS);
  });
});

// ==================== Entries ====================

describe("password-vault entries", () => {
  test("add, edit, list without passwords, delete", async () => {
    const s = await created();
    const { id } = await s.saveEntry({ name: "  M365 ", username: "me", password: "p1", url: "https://portal.office.com", folder: "Clients" });
    let list = s.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "M365", username: "me", folder: "Clients", hasPassword: true });
    expect(list[0].password).toBeUndefined();
    const created1 = s.getEntry(id).created;
    s.clock.t += 1000;
    await s.saveEntry({ id, name: "M365", username: "me", password: "p2" });
    expect(s.getField(id, "password")).toBe("p2");
    expect(s.getEntry(id).created).toBe(created1);
    expect(s.getEntry(id).updated).not.toBe(created1);
    await s.deleteEntry(id);
    list = s.listEntries();
    expect(list).toEqual([]);
    await rejectsCode(s.deleteEntry(id), "not-found");
  });

  test("an entry needs a name; fields are trimmed to their limits", async () => {
    const s = await created();
    await rejectsCode(s.saveEntry({ name: "   " }), "bad-entry");
    await rejectsCode(s.saveEntry(null), "bad-entry");
    const { id } = await s.saveEntry({ name: "x".repeat(500), notes: "n".repeat(20000) });
    expect(s.getEntry(id).name.length).toBe(200);
    expect(s.getEntry(id).notes.length).toBe(10000);
  });

  test("getField only gives out known fields", async () => {
    const s = await created();
    const { id } = await s.saveEntry({ name: "A", password: "p" });
    throwsCode(() => s.getField(id, "__proto__"), "bad-field");
    throwsCode(() => s.getField("missing", "password"), "not-found");
  });

  test("getEntry returns a copy", async () => {
    const s = await created();
    const { id } = await s.saveEntry({ name: "A", password: "p" });
    s.getEntry(id).password = "changed";
    expect(s.getField(id, "password")).toBe("p");
  });
});

// ==================== Password change, backup, delete ====================

describe("password-vault password change and backup", () => {
  test("change password: the old one stops working, entries stay", async () => {
    const s = await created();
    await s.saveEntry({ name: "Keep me" });
    const oldSalt = JSON.parse(fs.readFileSync(vaultFile(), "utf8")).kdf.salt;
    await rejectsCode(s.changePassword("wrong password!", PW2), "wrong-password");
    await rejectsCode(s.changePassword(PW, "short"), "password-too-short");
    await s.changePassword(PW, PW2);
    expect(JSON.parse(fs.readFileSync(vaultFile(), "utf8")).kdf.salt).not.toBe(oldSalt);
    const s2 = makeSession();
    await s2.init();
    await rejectsCode(s2.unlock(PW), "wrong-password");
    await s2.unlock(PW2);
    expect(s2.listEntries().map((e) => e.name)).toEqual(["Keep me"]);
  });

  test("backup copy is the encrypted file and opens with the password", async () => {
    const s = await created();
    await s.saveEntry({ name: "Backed up" });
    const dest = path.join(dir, "copy.json");
    await s.backupTo(dest);
    expect(fs.readFileSync(dest, "utf8")).toBe(fs.readFileSync(vaultFile(), "utf8"));
    s.lock();
    await rejectsCode(s.backupTo(path.join(dir, "copy2.json")), "locked");
  });

  test("delete vault needs the password and removes the files", async () => {
    const s = await created();
    await s.saveEntry({ name: "A" });
    await rejectsCode(s.deleteVault("wrong password!"), "wrong-password");
    await s.deleteVault(PW);
    expect(s.state).toBe("none");
    expect(fs.existsSync(vaultFile())).toBe(false);
    expect(fs.existsSync(vaultFile() + ".bak")).toBe(false);
  });
});

// ==================== Windows Hello ====================

describe("password-vault Windows Hello", () => {
  test("enable needs the master password and stores the wrapped key inside the encrypted data", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await rejectsCode(s.enableHello("wrong password!"), "wrong-password");
    expect(hello.calls).toBe(0);
    await s.enableHello(PW);
    expect(hello.calls).toBe(1);
    expect(s.status().helloEnabled).toBe(true);
    const text = fs.readFileSync(vaultFile(), "utf8");
    expect(text).not.toContain("challenge");
    expect(JSON.parse(text).hello).toBeUndefined();
  });

  test("re-prompt: the key is wiped, Hello brings it back", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.saveEntry({ name: "Firewall", password: "fw" });
    await s.enableHello(PW);
    const keyRef = s._vaultKey;
    s.clock.t += 4 * 3600000;
    expect(s.status()).toMatchObject({ state: "reprompt", helloReady: true });
    expect(keyRef.every((b) => b === 0)).toBe(true);
    expect(s._vaultKey).toBeNull();
    expect(s._payload).toBeNull();
    throwsCode(() => s.listEntries(), "locked");
    await s.unlockWithHello();
    expect(s.state).toBe("unlocked");
    expect(s.getField(s.listEntries()[0].id, "password")).toBe("fw");
    // and the timer starts again
    s.clock.t += 4 * 3600000;
    expect(s.status().state).toBe("reprompt");
  });

  test("the master password also answers a re-prompt", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.reprompt();
    await s.unlock(PW);
    expect(s.state).toBe("unlocked");
  });

  test("cancelling Hello leaves the re-prompt as it was", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.reprompt();
    hello.answer = "hello-cancelled";
    await rejectsCode(s.unlockWithHello(), "hello-cancelled");
    expect(s.status()).toMatchObject({ state: "reprompt", helloReady: true });
    hello.answer = "ok";
    await s.unlockWithHello();
    expect(s.state).toBe("unlocked");
  });

  test("a different Hello key can't open it and drops to locked", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.reprompt();
    hello.key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await rejectsCode(s.unlockWithHello(), "hello-mismatch");
    expect(s.status()).toMatchObject({ state: "locked", helloReady: false });
    await s.unlock(PW);
    expect(s.state).toBe("unlocked");
  });

  test("Lock now ends Hello for the session", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.lock();
    expect(s.status().helloReady).toBe(false);
    await rejectsCode(s.unlockWithHello(), "hello-unavailable");
  });

  test("5 wrong master passwords at a re-prompt end Hello for the session", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.reprompt();
    for (let i = 0; i < V.MAX_REPROMPT_FAILURES; i++) {
      s.clock.t += 60000;
      await rejectsCode(s.unlock("wrong password " + i), "wrong-password");
    }
    expect(s.status().state).toBe("locked");
  });

  test("Lock now while Windows Hello is open wins", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    s.reprompt();
    const realSign = hello.sign;
    hello.sign = async (c) => { s.lock(); return realSign(c); };
    await rejectsCode(s.unlockWithHello(), "locked");
    expect(s.state).toBe("locked");
  });

  test("disable removes Hello; a re-prompt then needs the password", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    await s.disableHello();
    expect(s.status().helloEnabled).toBe(false);
    s.reprompt();
    expect(s.state).toBe("locked");
  });

  test("changing the master password keeps Hello working", async () => {
    const hello = fakeHello();
    const s = await created({ hello });
    await s.enableHello(PW);
    await s.changePassword(PW, PW2);
    s.reprompt();
    await s.unlockWithHello();
    expect(s.state).toBe("unlocked");
  });

  test("no Hello on this PC: enable is refused", async () => {
    const s = await created();
    await rejectsCode(s.enableHello(PW), "hello-unavailable");
  });
});

// ==================== Windows Hello adapter ====================

describe("password-vault Windows Hello adapter", () => {
  const { EventEmitter } = require("events");

  function fakeSpawn(stdout, record) {
    return (cmd, args, opts) => {
      if (record) record.push({ cmd, args, opts });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        if (stdout !== null) child.stdout.emit("data", Buffer.from(stdout));
        child.emit("close", 0);
      });
      return child;
    };
  }

  test("the script only takes fixed values and base64", () => {
    const s = H.buildScript("sign", { challenge: Buffer.alloc(32, 255), create: true });
    expect(s).toContain("'" + Buffer.alloc(32, 255).toString("base64") + "'");
    expect(s).toContain("'1' -eq '1'");
    expect(s).toContain("$mode = 'sign'");
    expect(s).not.toMatch(/__[A-Z]+__/);
    expect(s).toContain("IAsyncOperation`1");
    expect(() => H.buildScript("evil")).toThrow();
  });

  test("runs Windows PowerShell hidden, with no profile", async () => {
    const calls = [];
    const sig = crypto.randomBytes(256).toString("base64");
    const h = H.createWindowsHello({ platform: "win32", env: { SystemRoot: "C:\\Windows" }, spawn: fakeSpawn('noise\r\n{"ok":true,"sig":"' + sig + '"}\r\n', calls) });
    const out = await h.sign(crypto.randomBytes(32), { create: false });
    expect(out.toString("base64")).toBe(sig);
    expect(calls[0].cmd).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(calls[0].args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-EncodedCommand"]));
    expect(calls[0].opts.windowsHide).toBe(true);
    const script = Buffer.from(calls[0].args[calls[0].args.length - 1], "base64").toString("utf16le");
    expect(script).toContain("RequestSignAsync");
  });

  test("Windows Hello answers map to error codes", async () => {
    for (const [status, code] of [["UserCanceled", "hello-cancelled"], ["NotFound", "hello-not-set-up"], ["SecurityDeviceLocked", "hello-locked-out"], ["Error", "hello-failed"]]) {
      const h = H.createWindowsHello({ platform: "win32", spawn: fakeSpawn('{"ok":false,"status":"' + status + '"}') });
      await rejectsCode(h.sign(crypto.randomBytes(32)), code);
    }
    const h2 = H.createWindowsHello({ platform: "win32", spawn: fakeSpawn("") });
    await rejectsCode(h2.sign(crypto.randomBytes(32)), "hello-failed");
    const h3 = H.createWindowsHello({ platform: "win32", spawn: fakeSpawn('{"ok":true,"sig":"AAAA"}') });
    await rejectsCode(h3.sign(crypto.randomBytes(32)), "hello-failed");
  });

  test("not Windows: unsupported, sign refused, no PowerShell run", async () => {
    const calls = [];
    const h = H.createWindowsHello({ platform: "linux", spawn: fakeSpawn("{}", calls) });
    expect(await h.isSupported()).toBe(false);
    await rejectsCode(h.sign(crypto.randomBytes(32)), "hello-unavailable");
    expect(calls).toEqual([]);
  });

  test("isSupported asks Windows once", async () => {
    const calls = [];
    const h = H.createWindowsHello({ platform: "win32", spawn: fakeSpawn('{"ok":true,"supported":true}', calls) });
    expect(await h.isSupported()).toBe(true);
    expect(await h.isSupported()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a stuck prompt times out", async () => {
    const h = H.createWindowsHello({
      platform: "win32",
      timeoutMs: 20,
      spawn: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        return child;
      },
    });
    await rejectsCode(h.sign(crypto.randomBytes(32)), "hello-timeout");
  });

  test("a real PKCS#1 v1.5 signature is repeatable (what the design relies on)", () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const ch = crypto.randomBytes(32);
    expect(crypto.sign("sha256", ch, privateKey).equals(crypto.sign("sha256", ch, privateKey))).toBe(true);
  });
});

// ==================== Generator and clipboard ====================

describe("password-vault generator", () => {
  test("default: 20 characters with every kind", () => {
    for (let i = 0; i < 50; i++) {
      const p = T.generate({});
      expect(p).toHaveLength(20);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
    }
  });

  test("length is kept between 8 and 64; sets can be turned off", () => {
    expect(T.generate({ length: 3 })).toHaveLength(8);
    expect(T.generate({ length: 200 })).toHaveLength(64);
    expect(T.generate({ length: 30, symbols: false, upper: false })).toMatch(/^[a-z2-9]{30}$/);
    expect(T.generate({ lower: false, upper: false, digits: false, symbols: false })).toMatch(/^[a-z]+$/);
  });

  test("passphrase: words, one capitalised, and a digit", () => {
    const p = T.generate({ mode: "words", words: 4 });
    const parts = p.split("-");
    expect(parts).toHaveLength(5);
    expect(parts[4]).toMatch(/^[2-9]$/);
    expect(parts.slice(0, 4).filter((w) => /^[A-Z]/.test(w))).toHaveLength(1);
    expect(T.WORDS).toHaveLength(256);
    expect(new Set(T.WORDS).size).toBe(256);
  });
});

describe("password-vault clipboard", () => {
  function fakeClipboard() {
    return { text: "", readText() { return this.text; }, writeText(t) { this.text = t; } };
  }
  function fakeTimers() {
    const list = [];
    return {
      list,
      setTimeout(fn, ms) { const t = { fn, ms, cleared: false }; list.push(t); return t; },
      clearTimeout(t) { if (t) t.cleared = true; },
      fire() { for (const t of list) if (!t.cleared) { t.cleared = true; t.fn(); } },
    };
  }

  test("clears after the time if the password is still there", () => {
    const cb = fakeClipboard();
    const tm = fakeTimers();
    const g = T.createClipboardGuard(cb, tm);
    g.copy("s3cret", 30);
    expect(cb.text).toBe("s3cret");
    expect(tm.list[0].ms).toBe(30000);
    tm.fire();
    expect(cb.text).toBe("");
  });

  test("doesn't wipe something copied since", () => {
    const cb = fakeClipboard();
    const tm = fakeTimers();
    const g = T.createClipboardGuard(cb, tm);
    g.copy("s3cret", 30);
    cb.text = "ticket notes";
    tm.fire();
    expect(cb.text).toBe("ticket notes");
  });

  test("0 seconds never clears; clearNow clears at once", () => {
    const cb = fakeClipboard();
    const tm = fakeTimers();
    const g = T.createClipboardGuard(cb, tm);
    g.copy("user", 0);
    expect(tm.list).toHaveLength(0);
    expect(g.clearNow()).toBe(false);
    g.copy("pw", 30);
    expect(g.clearNow()).toBe(true);
    expect(cb.text).toBe("");
  });

  test("a second copy replaces the first one's timer", () => {
    const cb = fakeClipboard();
    const tm = fakeTimers();
    const g = T.createClipboardGuard(cb, tm);
    g.copy("one", 30);
    g.copy("two", 30);
    expect(tm.list[0].cleared).toBe(true);
    tm.fire();
    expect(cb.text).toBe("");
  });
});

// ==================== Side panel helpers ====================

describe("password-vault tab helpers", () => {
  const R = require("../plugins/password-vault/renderer");

  test("strength grows with length and variety", () => {
    expect(R.strength("")).toBe(0);
    expect(R.strength("password")).toBe(0);
    expect(R.strength("aaaaaaaaaaaaaaaaaaaa")).toBe(0);
    expect(R.strength("correct horse battery staple")).toBeGreaterThanOrEqual(3);
    expect(R.strength("Tr0ub4dor&3xQ!zP")).toBeGreaterThanOrEqual(3);
  });

  test("filter searches name, username, site and folder; sorts by name", () => {
    const list = [
      { name: "beta", username: "root", url: "https://fw.fabrikam.example", folder: "Fabrikam" },
      { name: "Alpha", username: "admin", url: "", folder: "Contoso" },
    ];
    expect(R.filterEntries(list, "", "").map((e) => e.name)).toEqual(["Alpha", "beta"]);
    expect(R.filterEntries(list, "FABRIKAM", "").map((e) => e.name)).toEqual(["beta"]);
    expect(R.filterEntries(list, "adm", "").map((e) => e.name)).toEqual(["Alpha"]);
    expect(R.filterEntries(list, "", "Contoso").map((e) => e.name)).toEqual(["Alpha"]);
    expect(R.folderList(list)).toEqual(["Contoso", "Fabrikam"]);
  });

  test("hostOf only shows web addresses", () => {
    expect(R.hostOf("https://admin.microsoft.com/x")).toBe("admin.microsoft.com");
    expect(R.hostOf("javascript:alert(1)")).toBe("");
    expect(R.hostOf("not a url")).toBe("");
  });

  test("every error main.js can send has a message", () => {
    const fs2 = require("fs");
    const src = fs2.readFileSync(require.resolve("../plugins/password-vault/main.js"), "utf8");
    const block = src.slice(src.indexOf("KNOWN_ERRORS"), src.indexOf("]);", src.indexOf("KNOWN_ERRORS")));
    const codes = block.match(/"[a-z-]+"/g).map((c) => c.slice(1, -1));
    expect(codes.length).toBeGreaterThan(15);
    for (const code of codes) expect(R.MESSAGES[code]).toBeTruthy();
    expect(R.messageFor({ error: "wait", retryInMs: 3500 })).toContain("4 seconds");
    expect(R.messageFor({ error: "whatever" })).toContain("went wrong");
  });

  test("re-prompt choices match the vault's", () => {
    expect(R.REPROMPT_OPTIONS.map((o) => o[0])).toEqual(V.REPROMPT_CHOICES);
    expect(R.CLIPBOARD_OPTIONS.map((o) => o[0]).sort()).toEqual(V.CLIPBOARD_CHOICES.slice().sort());
  });
});
