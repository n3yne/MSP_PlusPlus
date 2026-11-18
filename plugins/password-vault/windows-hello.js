"use strict";

// Password Vault: Windows Hello, through Windows' own KeyCredentialManager.
//
// Windows Hello keeps an RSA key for MSP++ ("MSP++ Password Vault") in the PC's
// TPM, usable only after face, fingerprint or PIN. We ask it to sign a random
// challenge; the signature (RSA PKCS#1 v1.5, so the same every time for the same
// challenge) becomes the key that wraps the vault key (see vault-crypto.js,
// helloKeyFromSignature). Without Windows Hello's say-so there is no signature,
// so there is no key. Bitwarden's desktop app uses the same idea.
//
// Electron has no Windows Hello API and plugins can't ship compiled modules, so
// the calls go through Windows PowerShell, which can reach these Windows APIs
// directly. Nothing is installed and nothing is written to disk.

const { spawn } = require("child_process");
const path = require("path");

const CREDENTIAL_NAME = "MSP++ Password Vault";
const TIMEOUT_MS = 120000;

// PowerShell 5.1 script. __MODE__, __CREATE__ and __CHALLENGE__ are replaced with
// fixed values or base64 (checked before use), never with free text.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
function Out-Result($o) { [Console]::Out.WriteLine((ConvertTo-Json $o -Compress)) }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
  $null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1'
  } | Select-Object -First 1
  function Wait-Op($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    return $task.Result
  }
  $KCM = [Windows.Security.Credentials.KeyCredentialManager]
  $name = '${CREDENTIAL_NAME}'
  $mode = '__MODE__'
  if ($mode -eq 'check') {
    $ok = Wait-Op ($KCM::IsSupportedAsync()) ([bool])
    Out-Result @{ ok = $true; supported = [bool]$ok }
    exit 0
  }
  if ($mode -eq 'remove') {
    try {
      $action = $KCM::DeleteAsync($name)
      $task = [System.WindowsRuntimeSystemExtensions]::AsTask($action)
      $null = $task.Wait(-1)
    } catch { }
    Out-Result @{ ok = $true }
    exit 0
  }
  $R = [Windows.Security.Credentials.KeyCredentialRetrievalResult]
  $res = Wait-Op ($KCM::OpenAsync($name)) $R
  if ($res.Status -eq [Windows.Security.Credentials.KeyCredentialStatus]::NotFound -and '__CREATE__' -eq '1') {
    $res = Wait-Op ($KCM::RequestCreateAsync($name, [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) $R
  }
  if ($res.Status -ne [Windows.Security.Credentials.KeyCredentialStatus]::Success) {
    Out-Result @{ ok = $false; status = [string]$res.Status }
    exit 0
  }
  $buf = [Windows.Security.Cryptography.CryptographicBuffer]::DecodeFromBase64String('__CHALLENGE__')
  $op = Wait-Op ($res.Credential.RequestSignAsync($buf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
  if ($op.Status -ne [Windows.Security.Credentials.KeyCredentialStatus]::Success) {
    Out-Result @{ ok = $false; status = [string]$op.Status }
    exit 0
  }
  Out-Result @{ ok = $true; sig = [Windows.Security.Cryptography.CryptographicBuffer]::EncodeToBase64String($op.Result) }
} catch {
  Out-Result @{ ok = $false; status = 'Error'; message = [string]$_.Exception.Message }
}
`;

class HelloError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// KeyCredentialStatus → our error codes.
function statusToCode(status) {
  switch (status) {
    case "UserCanceled":
    case "UserPrefersPassword":
      return "hello-cancelled";
    case "NotFound":
      return "hello-not-set-up";
    case "SecurityDeviceLocked":
      return "hello-locked-out";
    default:
      return "hello-failed";
  }
}

function buildScript(mode, opts) {
  const o = opts || {};
  if (!["check", "remove", "sign"].includes(mode)) throw new Error("bad mode");
  const challenge = o.challenge ? Buffer.from(o.challenge).toString("base64") : "";
  if (!/^[A-Za-z0-9+/=]*$/.test(challenge)) throw new Error("bad challenge");
  return SCRIPT
    .replace("__MODE__", mode)
    .replace("__CREATE__", o.create ? "1" : "0")
    .replace("__CHALLENGE__", challenge);
}

// The last line of output that parses as JSON.
function parseOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === "object") return v;
    } catch { /* not JSON */ }
  }
  return null;
}

function powershellPath(env) {
  const root = (env && env.SystemRoot) || "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

// deps (for tests): { spawn, platform, env, timeoutMs }
function createWindowsHello(deps) {
  const d = deps || {};
  const doSpawn = d.spawn || spawn;
  const platform = d.platform || process.platform;
  const env = d.env || process.env;
  const timeoutMs = d.timeoutMs || TIMEOUT_MS;
  let supportedCache = null;
  let running = false;

  function run(mode, opts) {
    return new Promise((resolve, reject) => {
      const encoded = Buffer.from(buildScript(mode, opts), "utf16le").toString("base64");
      let child;
      try {
        child = doSpawn(powershellPath(env),
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
          { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        reject(new HelloError("hello-failed", e.message));
        return;
      }
      let out = "";
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill(); } catch { /* gone */ }
        reject(new HelloError("hello-timeout"));
      }, timeoutMs);
      child.stdout.on("data", (b) => { if (out.length < 65536) out += b.toString("utf8"); });
      child.stderr.on("data", () => {});
      child.on("error", (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new HelloError("hello-failed", e.message));
      });
      child.on("close", () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const res = parseOutput(out);
        out = "";
        if (!res) reject(new HelloError("hello-failed", "No answer from Windows"));
        else resolve(res);
      });
    });
  }

  async function isSupported() {
    if (platform !== "win32") return false;
    if (supportedCache !== null) return supportedCache;
    try {
      const res = await run("check");
      supportedCache = !!(res.ok && res.supported);
    } catch {
      supportedCache = false;
    }
    return supportedCache;
  }

  // Resolves to the signature (a Buffer the caller wipes). opts.create makes the
  // Windows Hello key first if there isn't one.
  async function sign(challenge, opts) {
    if (platform !== "win32") throw new HelloError("hello-unavailable");
    if (!Buffer.isBuffer(challenge) || challenge.length < 16) throw new HelloError("hello-failed", "Bad challenge");
    if (running) throw new HelloError("hello-busy");
    running = true;
    try {
      const res = await run("sign", { challenge, create: !!(opts && opts.create) });
      if (!res.ok) throw new HelloError(statusToCode(res.status), res.message || res.status);
      const sig = typeof res.sig === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(res.sig) ? Buffer.from(res.sig, "base64") : null;
      if (!sig || sig.length < 64) throw new HelloError("hello-failed", "Bad signature");
      return sig;
    } finally {
      running = false;
    }
  }

  async function remove() {
    if (platform !== "win32") return;
    try { await run("remove"); } catch { /* best effort */ }
  }

  return { isSupported, sign, remove };
}

module.exports = { createWindowsHello, buildScript, parseOutput, statusToCode, powershellPath, HelloError, CREDENTIAL_NAME };
