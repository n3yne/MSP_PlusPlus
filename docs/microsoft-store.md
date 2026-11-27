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

MSP++ is reserved in Partner Center as `Esscey.MSP` (publisher `Esscey`, Store ID 9NVJX5HK84G2, package family name `Esscey.MSP_xj933ga3cdbrj`). Partner Center refuses a package whose identity doesn't match. If the fields ever say `PLACEHOLDER`, the workflow prints a warning.

## What's different in the Store copy

### Updates

The Store installs updates. The Store copy never checks GitHub and never downloads an installer (`src/main/updater.js`, mode `"store"`, detected with Electron's `process.windowsStore`). **Settings → General → Updates** says "Installed from the Microsoft Store" and hides **Check for Updates**. Plugins still update from the plugin directory as usual.

### Install folder

Windows installs the package read-only under `C:\Program Files\WindowsApps\`. Nothing in MSP++ writes to its own install folder, so this needs no changes.

### The data folder (AppData)

The Store copy runs with Windows' AppData redirection (Windows 10 1903 and later):

- **Files that already exist** in `%APPDATA%\MSP++\` (or the old `Freshservice++` folder) are read and changed in place. So a Store copy installed on a PC that had the installer build picks up the same settings, plugins and note backups.
- **New files and folders** are written to a private per-app folder, `%LOCALAPPDATA%\Packages\Esscey.MSP_xj933ga3cdbrj\LocalCache\Roaming\MSP++\`, but MSP++ still sees them at the normal path. Explorer, other programs and the installer build don't see them at `%APPDATA%\MSP++\`.
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
- **Privacy policy (10.5).** Every desktop app needs a privacy policy URL in Partner Center. Use <https://github.com/n3yne/MSP_PlusPlus/blob/main/docs/privacy.md> ([privacy.md](privacy.md)). Keep it up to date when a feature sends data somewhere new.
- **Web engine (10.2.1).** Apps that browse the web must stay within two major versions of current Chromium. Keep Electron up to date.
- **Naming (10.1).** Say "for Freshservice and ConnectWise Manage" and don't suggest any connection with Freshworks or ConnectWise.
- **Capabilities.** The package declares `runFullTrust`, which every Electron app needs. Partner Center asks why: "Desktop app (Electron) that needs full trust to run."

## First submission (done by hand in Partner Center)

1. Publish a release (or run **Build & Release** by hand).
2. Download the `windows-store` artifact and unzip it to get the `.appx`.
3. In Partner Center, open the app → **Start your submission**. Set pricing (free), properties (category Business or Productivity), age rating, then **Packages** → upload the `.appx`.
4. **Store listing**: description (mention plugins and the sites it works with), at least one screenshot, privacy policy URL.
5. **Submission options → Notes for certification**: the review sign-in and a line on what to look at first.
6. To try it before anyone else sees it, set **Visibility** to *Private audience* (or use a package flight) and install from the Store link Partner Center gives you. That copy is signed by the Store, so no certificate is needed.

## Automatic Store updates

Once the four Partner Center secrets below are set, every full release (a tag like `v0.8.11`, not `v0.8.11-beta.1`) is also sent to the Store. The `store-submit` job in **Build & Release** runs after the GitHub release is made. It uploads the Store package as a new submission, copying the listing, screenshots and notes from the live one, and commits it for certification. Microsoft usually certifies it in 1 to 3 days. After that, Windows updates installed copies through the Store.

Without the secrets the job does nothing and prints a notice, so releases work as before.

### One-time setup

1. **Give Partner Center a Microsoft Entra tenant.** In [Partner Center](https://partner.microsoft.com/dashboard), open **Settings (gear) → Account settings → Organization profile → Tenants**. If nothing is listed, choose **Create** to make a free new tenant (an individual developer account usually has none). If you already have one, use **Associate** instead.
2. **Create the Entra app for GitHub.** Go to **Account settings → User management → Microsoft Entra applications** and choose **Create Microsoft Entra application** (or **Add Microsoft Entra application** to use an existing app registration). Give it the **Manager** role.
3. **Make a key.** Open that app in the same list and choose **Add new key**. Partner Center shows the **Tenant ID**, **Client ID** and **Key** (the secret). Copy the key now, because it isn't shown again. Keys expire (1 or 2 years). Make a new one before then and update the secret.
4. **Find the Seller ID** under **Account settings → Legal info** (it may be labelled Seller ID or Publisher ID).
5. **Add the secrets in GitHub.** Open the repository's **Settings → Environments → New environment**, name it `microsoft-store`, and add these environment secrets. Repository secrets (**Settings → Secrets and variables → Actions**) work too.

| Secret | Value |
|---|---|
| `PARTNER_CENTER_TENANT_ID` | Tenant ID |
| `PARTNER_CENTER_SELLER_ID` | Seller ID |
| `PARTNER_CENTER_CLIENT_ID` | Client ID |
| `PARTNER_CENTER_CLIENT_SECRET` | Key |

To check the secrets without releasing, run **Check Store credentials** from the Actions tab. It signs in and reads the app's status, and changes nothing.

To approve each Store submission by hand, add yourself as a **Required reviewer** on the `microsoft-store` environment. The job then waits for your OK on the run's page.

### When a submission fails

- **A submission is still in certification.** The Store allows one at a time. Wait for it to finish, then open the run and choose **Re-run failed jobs**.
- **Version already used.** Each Store package needs a higher version than the last. Release a new patch version.
- **Certification fails.** Partner Center emails a report. Fix the problem and make a new release.

The Store product ID (9NVJX5HK84G2) is set in the workflow, not a secret. The job uses Microsoft's `microsoft-store-apppublisher` action and the Store CLI (`msstore publish`).

## See also

- [Updates and notifications](updates-and-notifications.md)
- [Files and folders](data-files.md)
- [Building from source](building.md)
