"use strict";

// Crash-safe file writes and a JSON reader that survives a damaged file.
//
// writeFileAtomic writes to a temporary file next to the target and renames it
// over the target, so a crash, power cut or full disk mid-write leaves either
// the old file or the new one, never half of each. On Windows a rename can fail
// for a moment while antivirus or a sync tool has the file open, so it retries.
//
// readJsonFile reads a JSON file and, when it exists but can't be parsed, keeps
// a copy of it (<name>.corrupt-<time><ext>) and falls back to <file>.bak, the
// copy writeJsonWithBackup saves after every successful write. So a damaged
// settings.json never silently turns into an empty one that defaults are then
// saved over.

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const RENAME_RETRIES = [50, 150, 400];

let tmpCounter = 0;
function tmpPath(file) {
  tmpCounter = (tmpCounter + 1) % 1e6;
  return file + "." + process.pid + "." + Date.now().toString(36) + "." + tmpCounter + ".tmp";
}

function retryable(e) {
  return e && (e.code === "EPERM" || e.code === "EACCES" || e.code === "EBUSY");
}

async function writeFileAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    await fsp.writeFile(tmp, data, "utf-8");
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (e) {
        if (!retryable(e) || i >= RENAME_RETRIES.length) throw e;
        await new Promise((r) => setTimeout(r, RENAME_RETRIES[i]));
      }
    }
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ }
}

function writeFileAtomicSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpPath(file);
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (e) {
        if (!retryable(e) || i >= RENAME_RETRIES.length) throw e;
        sleepSync(RENAME_RETRIES[i]);
      }
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function backupPath(file) {
  return file + ".bak";
}

function corruptCopyPath(file, now) {
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  const stamp = new Date(now || Date.now()).toISOString().replace(/[:.]/g, "-");
  return base + ".corrupt-" + stamp + ext;
}

// Writes JSON atomically, then saves the same text as <file>.bak. The backup
// failing doesn't fail the write.
async function writeJsonWithBackup(file, value) {
  const text = JSON.stringify(value, null, 2);
  await writeFileAtomic(file, text);
  try { await writeFileAtomic(backupPath(file), text); } catch (e) { console.warn("[Files] Couldn't update backup of " + path.basename(file) + ":", e.message); }
}

// Raw text already saved aside, so repeated reads of the same damaged file
// don't pile up copies.
const savedAside = new Map();

// Reads and parses a JSON file.
// Returns { value, status } where status is:
//   "ok"        the file parsed
//   "missing"   no file (value is null)
//   "recovered" the file was damaged; value comes from <file>.bak; corruptCopy names the saved copy
//   "corrupt"   the file was damaged and there's no usable backup (value is null)
async function readJsonFile(file) {
  let raw;
  try {
    raw = await fsp.readFile(file, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return { value: null, status: "missing" };
    throw e;
  }
  try {
    return { value: JSON.parse(raw), status: "ok" };
  } catch (parseError) {
    let corruptCopy = savedAside.get(file + "\0" + raw) || null;
    if (!corruptCopy) {
      corruptCopy = corruptCopyPath(file);
      try {
        await fsp.writeFile(corruptCopy, raw, "utf-8");
        savedAside.set(file + "\0" + raw, corruptCopy);
      } catch (e) {
        console.error("[Files] Couldn't keep a copy of damaged " + path.basename(file) + ":", e.message);
        corruptCopy = null;
      }
      console.error("[Files] " + path.basename(file) + " couldn't be read (" + parseError.message + ")" +
        (corruptCopy ? "; kept a copy as " + path.basename(corruptCopy) : ""));
    }
    try {
      const backup = JSON.parse(await fsp.readFile(backupPath(file), "utf-8"));
      return { value: backup, status: "recovered", corruptCopy };
    } catch {
      return { value: null, status: "corrupt", corruptCopy };
    }
  }
}

module.exports = {
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonWithBackup,
  readJsonFile,
  backupPath,
  corruptCopyPath,
};
