# Password Vault

[Docs home](../README.md) › [All plugins](README.md) › Password Vault

**Category:** Security · **Side panel tab:** 🔑 Vault · **Needs:** nothing

Keep passwords in an encrypted vault on this PC, opened with a master password. You need the master password every time MSP++ starts, and again after a time you choose. Windows Hello can answer those later prompts.

## Using it

- **Set up** – Open the 🔑 Vault tab and choose a master password of at least 12 characters, typed twice. There is **no way to recover the vault** if you forget it, so pick something you'll remember (a few unrelated words work well).
- **Unlock** – Type the master password. After 3 wrong tries in a row, each further try waits longer (2, 4, 8, 16, then 30 seconds).
- **Add an entry** – **+ New**: name, username, password, website, folder and notes. **Generate** makes a password: 8 to 64 characters with the character types you pick, or a passphrase of 3 to 10 words.
- **Find one** – Type in the search box (searches name, username, website and folder), or pick a folder.
- **Use one** – On each row, 👤 copies the username, 🔑 copies the password, and ↗ opens the website in a new tab. A copied password is cleared from the clipboard after 30 seconds, unless you've copied something else since. Click a row to edit or delete the entry.
- **Lock now** – The 🔒 button in the tab, or `Ctrl+Shift+L` from anywhere in MSP++. Locking also clears a copied password from the clipboard.

### When it asks for the password again

| What happens | Result |
|---|---|
| MSP++ starts | Locked: only the master password opens it |
| The re-prompt time passes (counted from when you last unlocked) | Asks again: Windows Hello or the master password, or only the master password if Windows Hello is off |
| Windows locks or the PC sleeps (if that setting is on) | Asks again, as above |
| **Lock now** or `Ctrl+Shift+L` | Locked: only the master password opens it |
| 5 wrong master passwords when it asks again | Locked: only the master password opens it |
| MSP++ closes | Locked, and the key is wiped from memory |

While it's asking again, the vault's key and entries are wiped from memory, not just hidden.

## Settings

In the Vault tab, behind the **⚙** button (the vault must be unlocked). They're stored inside the encrypted vault, so they can't be changed while it's locked. Making the vault **less strict** (a longer re-prompt time, turning off locking on sleep, leaving passwords on the clipboard longer) needs the master password.

| Setting | What it does | Default |
|---|---|---|
| Ask for the password again | **Immediately** (whenever you leave the Vault tab, hide the side panel or minimise MSP++), after **15 minutes**, **1 hour**, **4 hours** or **8 hours**, or **Never, until MSP++ closes**. | After 4 hours |
| Ask again when Windows locks or the PC sleeps | Asks again on Windows lock (`Win+L`) and sleep. | On |
| Clear a copied password from the clipboard after | 10 seconds, 30 seconds, 1 minute, 2 minutes or never. | 30 seconds |
| Windows Hello | Lets your face, fingerprint or PIN answer when the vault asks again. Turning it on needs the master password. Only shown on Windows PCs with Windows Hello set up. | Off |
| Change master password | Needs the current one. Entries and Windows Hello carry on working. | – |
| Save an encrypted copy… | Saves the vault file, still encrypted, wherever you choose. It opens with the master password you had when you saved it. | – |
| Delete the vault | Needs the master password. Removes the vault and its `.bak` copy from this PC. | – |

**Settings → Plugins → Password Vault** only explains where these are.

### How Windows Hello works here

When you turn it on, Windows Hello makes a key for MSP++ ("MSP++ Password Vault") that never leaves Windows and only works after your face, fingerprint or PIN. The vault's key is then encrypted with a key that can only be rebuilt from that Windows Hello key, so **only Windows Hello can open that copy**. Bitwarden's desktop app works the same way.

That copy is kept inside the encrypted vault, so it can only be read after the master password has opened the vault once. That's why Windows Hello can never open the vault when MSP++ starts.

## Data

`plugins\password-vault\vault.json` in the [data folder](../data-files.md#plugin-data-datapluginsplugin-id), and `vault.json.bak`, the version before the last save. Both are fully encrypted: entry names, usernames, websites, notes, folders and the vault's settings included. Only the format version and the Argon2 settings are readable.

The vault is never included in **Settings → General → Move Settings to Another PC**. To move it, copy `vault.json` (or an encrypted copy) to the same place on the other PC; it opens with the same master password. Removing the plugin keeps the file unless you tick **Also delete its saved data**.

### Encryption

| Part | How |
|---|---|
| Master password | Never stored. Turned into a key with Argon2id: 64 MiB of memory, 3 passes, 4 lanes, a random 16-byte salt (Bitwarden's defaults). |
| Vault key | 32 random bytes, stored only encrypted by the master password's key. Changing the master password re-encrypts just this. |
| Vault data | The whole vault as one block, AES-256-GCM with the vault key and a fresh random nonce on every save. Any change to the file, including its header, stops it opening. |
| Windows Hello | The key is derived (HKDF-SHA-256) from Windows Hello's signature over a random challenge. |
| Memory | The keys are held only in MSP++'s main process, never in web pages or the side panel, and are zeroed when the vault locks. |

Argon2id comes from [hash-wasm](https://github.com/Daninet/hash-wasm) (MIT, included in the plugin). AES-GCM, HKDF and random numbers come from Electron's built-in crypto.

## Limits and known issues

- **Not tested on Windows yet.** It has been tested on Linux and with automated tests only, and nobody has reviewed it for security professionally.
- **Windows Hello** runs through Windows PowerShell. If your company blocks PowerShell scripts, Windows Hello won't work, but the master password always does. The Windows Hello prompt may open behind the MSP++ window, and some antivirus tools may warn about an app starting PowerShell.
- If Windows Hello's key for MSP++ is removed or reset (for example after a Windows Hello PIN reset), Windows Hello can't open the vault any more. Use the master password, then turn Windows Hello off and on again.
- **Malware on the PC** can read the vault while it's unlocked. No password manager can stop that; short re-prompt times and locking on sleep keep the window small.
- **Other plugins** run with full access inside MSP++, so a harmful plugin could reach the vault. Only install plugins from the MSP++ plugin directory.
- Decrypted text can stay in memory for a while after locking, until it's overwritten. JavaScript can't wipe it on demand.
- It doesn't fill in sign-in forms on web pages, and there's no import from other password managers yet.
- There's no plain-text export.

## See also

- [Keyboard shortcuts](../keyboard-shortcuts.md)
- [Files and folders](../data-files.md)
- [Side panel](../side-panel.md)
