# Building from source

[Docs home](README.md) › Building from source

## Run it

Needs [Node.js](https://nodejs.org/) v20.19 or later (release builds use Node 22).

```bash
npm install
npm start
```

In a development checkout every plugin in `plugins/` loads as if it came with the app, so the first-start plugin picker doesn't open. On Linux the development data folder is `~/.config/msp-pp`.

## Repository layout

| Folder | What's in it |
|---|---|
| `src/main/` | The main process: `main.js` (the app's entry point), `preload.js`, settings (`utils.js`), updates, permissions, passkeys, the Chrome user agent for site and Microsoft sign-in hosts (`user-agent.js`), settings export, safe file writes, and the Windows Hello and device sign-on wrappers |
| `src/plugin-system/` | Loading plugins (`plugin-manager.js`), the plugin directory, plugin packages, and `moved-plugins.json` |
| `src/windows/` | The main, Settings and child windows: their HTML, `styles.css` and window scripts (`renderer.js`, `settings_renderer.js`, `child-window.js`) |
| `src/shared/` | Scripts the windows load with a `<script>` tag that the main process or the tests also `require()`: address bar, tab shortcuts, command palette, page zoom, side panel split, site colours, plugin categories, the first-start plugin picker, ticket preview and so on |
| `assets/` | The app icon (`icon.svg` is the source; `icon.png` and `icon.ico` are used by the app and the build) |
| `native/` | The native Windows modules (see below) |
| `plugins/` | Every plugin, one folder each (see the [plugin guide](plugins.md)) |
| `scripts/` | `npm start` (`launch.js`), the native module build and checks, and the plugin directory build |
| `test/` | The Jest tests |
| `docs/` | These pages |

Everything under `src/` goes into the packaged app (`build.files` in `package.json`).

## Lint and test

```bash
npm run lint
npm test
```

## Build a distributable

```bash
# Windows portable .exe and installer
npm run build

# Just one of them
npm run build-portable
npm run build-installer

# Microsoft Store package (.appx, Windows only)
npm run build-store

# macOS .dmg
npm run build-mac
```

Output goes to `dist/`. Building the Windows installer on Linux needs wine. The Store package needs the Windows SDK's `makeappx`, so it only builds on Windows; see [Microsoft Store build](microsoft-store.md).

### The native Windows modules

Two small C++ Node-API modules, used by plugins through the plugin API:

- `native/windows-hello` – over Windows' KeyCredentialManager, for [`api.windowsHello`](plugins.md#apiwindowshello).
- `native/windows-sso` – over Windows' `IProofOfPossessionCookieInfoManager`, which gives the device sign-on proofs Edge sends to Microsoft sign-in, for [`api.windowsSso`](plugins.md#apiwindowssso).

`npm run build` (and the portable and installer scripts) build them first with `npm run build-native`. On Windows that needs [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload (it includes the Windows SDK) and Python. Elsewhere they're skipped. Without them, `npm start` still works; Windows Hello and device sign-on just aren't offered.

## Continuous integration

- **Tests** (`.github/workflows/test.yml`) – Every pull request and push to `main` runs lint, the Jest tests and a package check on Windows. It also builds the native Windows modules and checks they load and answer, and that both are in the packaged app. The package check builds the unpacked app and confirms every file in `build.files` made it in; a test also fails if code loads a file that isn't listed there.
- **Build** (`.github/workflows/build.yml`) – Pushing a `v*` tag lints, tests and builds both platforms and attaches them to a GitHub release. The release also gets `latest.yml` and the installer's `.blockmap`: installed copies read `latest.yml` to find updates, so a release without it won't reach them. An existing release description is kept, with build info added on top. Beta tags stay pre-releases. It also builds the Microsoft Store package (the `windows-store` artifact) and, for full releases with the Partner Center secrets set, sends it to the Store ([Automatic Store updates](microsoft-store.md#automatic-store-updates)).
- **Plugin directory** (`.github/workflows/plugins.yml`) – When a change to `plugins/` reaches `main`, builds every plugin and uploads it to the `plugin-directory` release. A plugin whose code changed needs a new manifest version, higher than the published one (plugin-only fixes use a fourth part, such as `0.8.7.1`). See [Publishing a plugin to the directory](plugins.md#publishing-a-plugin-to-the-directory).

## See also

- [Plugin development guide](plugins.md)
- [Site plugins](sites.md)
- [Files and folders](data-files.md)
