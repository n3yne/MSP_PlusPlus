# Building from source

[Docs home](README.md) › Building from source

## Run it

Needs [Node.js](https://nodejs.org/) v20.19 or later (release builds use Node 22).

```bash
npm install
npm start
```

In a development checkout every plugin in `plugins/` loads as if it came with the app, so the first-start plugin picker doesn't open. On Linux the development data folder is `~/.config/msp-pp`.

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

# macOS .dmg
npm run build-mac
```

Output goes to `dist/`. Building the Windows installer on Linux needs wine.

## Continuous integration

- **Tests** (`.github/workflows/test.yml`) – Every pull request and push to `main` runs lint, the Jest tests and a package check on Windows. The package check builds the unpacked app and confirms every file in `build.files` made it in; a test also fails if code loads a file that isn't listed there.
- **Build** (`.github/workflows/build.yml`) – Pushing a `v*` tag lints, tests and builds both platforms and attaches them to a GitHub release. The release also gets `latest.yml` and the installer's `.blockmap`: installed copies read `latest.yml` to find updates, so a release without it won't reach them. An existing release description is kept, with build info added on top. Beta tags stay pre-releases.
- **Plugin directory** (`.github/workflows/plugins.yml`) – When a change to `plugins/` reaches `main`, builds every plugin and uploads it to the `plugin-directory` release. A plugin whose code changed needs a new manifest version. See [Publishing a plugin to the directory](plugins.md#publishing-a-plugin-to-the-directory).

## See also

- [Plugin development guide](plugins.md)
- [Site plugins](sites.md)
- [Files and folders](data-files.md)
