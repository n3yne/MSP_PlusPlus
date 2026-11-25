# Microsoft Store build

[Docs home](README.md) › Microsoft Store build

MSP++ can be published to the Microsoft Store as an MSIX/AppX package. The Store signs the package with Microsoft's own certificate, so there is no code-signing certificate to buy, and Windows (including Defender) trusts the signed app. The installer and portable builds stay as they are.

## How the package is built

- `npm run build-store` (Windows only) builds `dist/MSP-PlusPlus-Store-<version>.appx`.
- The **Build & Release** workflow builds it on every run and uploads it as the `windows-store` artifact. It is **not** attached to the GitHub release: it's unsigned, so it can't be installed from there. Download it from the run and upload it in Partner Center.
- Settings live in `package.json` under `build.appx`. The tile images are in `build/appx/`, made from `assets/icon.png` (transparent background, icon at about two thirds of the tile).
- The package version is the app version with `.0` added (0.8.9 → 0.8.9.0). The Store requires the last part to be 0.

### Partner Center identity

Partner Center gives each app three values under **Product management → Product identity**. They go in `package.json` → `build.appx`:

| Partner Center | `build.appx` field |
|---|---|
| Package/Identity/Name | `identityName` |
| Package/Identity/Publisher (starts `CN=`) | `publisher` |
| Package/Properties/PublisherDisplayName | `publisherDisplayName` |

Until they are filled in, the fields say `PLACEHOLDER` and the workflow prints a warning. Partner Center refuses a package whose identity doesn't match.

## What's different in the Store copy

### Updates

The Store installs updates. The Store copy never checks GitHub and never downloads an installer (`src/main/updater.js`, mode `"store"`, detected with Electron's `process.windowsStore`). **Settings → General → Updates** says "Installed from the Microsoft Store" and hides **Check for Updates**. Plugins still update from the plugin directory as usual.

### Install folder

Windows installs the package read-only under `C:\Program Files\WindowsApps\`. Nothing in MSP++ writes to its own install folder, so this needs no changes.

### The data folder (AppData)

The Store copy runs with Windows' AppData redirection (Windows 10 1903 and later):

- **Files that already exist** in `%APPDATA%\MSP++\` (or the old `Freshservice++` folder) are read and changed in place. So a Store copy installed on a PC that had the installer build picks up the same settings, plugins and note backups.
- **New files and folders** are written to a private per-app folder, `%LOCALAPPDATA%\Packages\<package family name>\LocalCache\Roaming\MSP++\`, but MSP++ still sees them at the normal path. Explorer, other programs and the installer build don't see them at `%APPDATA%\MSP++\`.
- **Uninstalling the Store app deletes the private folder.** That includes any note backups, plugin data and settings files created by the Store copy. Before uninstalling, use **Settings → General → Export Settings**, and copy anything you need from the private folder.
- Running the Store copy and the installer build on the same PC isn't recommended: they share the files that existed before, but each keeps its own new ones.

### Windows Hello (Password Vault)

The vault key is made with Windows' `KeyCredentialManager`. Windows keeps a packaged app's Hello keys separate from other apps, so the Store copy most likely can't use a vault key made by the installer build. Set the vault up again in the Store copy, or keep using one build. **Not tested yet.**

### Native modules

`windows-hello`, `windows-sso` (device sign-on, `IProofOfPossessionCookieInfoManager`) and `windows-clipboard` are ordinary documented Windows APIs and load from the package like any other file. They should behave the same, but **haven't been tested in a package yet**.

## Store policy notes

From Microsoft Store Policies 7.20 (October 2026). These shape the listing and the certification notes.

- **Plugins (10.2.2).** Downloading code is allowed. Using it to change what the app does beyond its listing description is not. The description must say that features come as optional plugins from the MSP++ plugin directory. Plugins published later count as part of the app.
- **Testable (10.3).** Reviewers need a working sign-in. Give them a Freshservice trial account (made for the review) in **Notes for certification**, and say the app works with the customer's own Freshservice or ConnectWise Manage.
- **Privacy policy (10.5).** Every desktop app needs a privacy policy URL in Partner Center.
- **Web engine (10.2.1).** Apps that browse the web must stay within two major versions of current Chromium. Keep Electron up to date.
- **Naming (10.1).** Say "for Freshservice and ConnectWise Manage" and don't suggest any connection with Freshworks or ConnectWise.
- **Capabilities.** The package declares `runFullTrust`, which every Electron app needs. Partner Center asks why: "Desktop app (Electron) that needs full trust to run."

## Submitting (done by hand in Partner Center)

1. Fill in the identity values above, merge, and run **Build & Release** (or push a release tag).
2. Download the `windows-store` artifact and unzip it to get the `.appx`.
3. In Partner Center, open the app → **Start your submission**. Set pricing (free), properties (category Business or Productivity), age rating, then **Packages** → upload the `.appx`.
4. **Store listing**: description (mention plugins and the sites it works with), at least one screenshot, privacy policy URL.
5. **Submission options → Notes for certification**: the review sign-in and a line on what to look at first.
6. To try it before anyone else sees it, set **Visibility** to *Private audience* (or use a package flight) and install from the Store link Partner Center gives you. That copy is signed by the Store, so no certificate is needed.

## See also

- [Updates and notifications](updates-and-notifications.md)
- [Files and folders](data-files.md)
- [Building from source](building.md)
