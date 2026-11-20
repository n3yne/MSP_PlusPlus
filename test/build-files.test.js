// Checks that every app file the code loads is listed in package.json
// "build.files", so a new file can't be left out of the release build.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = require("../package.json");
const buildFiles = pkg.build.files;

function isPackaged(relPath) {
  const p = relPath.split(path.sep).join("/");
  // electron-builder always packs package.json.
  if (p === "package.json") return true;
  return buildFiles.some((entry) => {
    if (entry.endsWith("/**/*")) return p.startsWith(entry.slice(0, -"**/*".length));
    return entry === p;
  });
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + "/" + entry.name;
    if (entry.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

// Files listed by name in build.files.
const topLevel = buildFiles.filter((f) => !f.includes("*"));
// Files that run inside the app: the named files plus everything under a
// "<folder>/**/*" entry (such as src/**/*).
const appFiles = topLevel.concat(
  ...buildFiles.filter((f) => f.endsWith("/**/*")).map((f) => walk(f.slice(0, -"/**/*".length)))
);

function localRequires(source) {
  const out = [];
  const re = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function htmlRefs(source) {
  const out = [];
  const re = /<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*["']([^"':]+)["']/gi;
  let m;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function resolveRequire(fromFile, spec) {
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  for (const candidate of [base, base + ".js", base + ".json", path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.relative(ROOT, candidate);
  }
  return null;
}

describe("package.json build.files", () => {
  test.each(topLevel)("%s exists", (file) => {
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  });

  test("every folder listed in build.files has files in it", () => {
    for (const entry of buildFiles.filter((f) => f.endsWith("/**/*"))) {
      expect(walk(entry.slice(0, -"/**/*".length)).length).toBeGreaterThan(0);
    }
  });

  test("main entry point is packaged", () => {
    expect(isPackaged(pkg.main)).toBe(true);
  });

  test("every local require() in a packaged file points at a packaged file", () => {
    const problems = [];
    for (const file of appFiles.filter((f) => f.endsWith(".js"))) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const spec of localRequires(source)) {
        const resolved = resolveRequire(file, spec);
        if (!resolved) problems.push(`${file}: require("${spec}") not found`);
        else if (!isPackaged(resolved)) problems.push(`${file}: require("${spec}") -> ${resolved} is not in build.files`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("every script, stylesheet and image an HTML page loads is packaged", () => {
    const problems = [];
    for (const file of appFiles.filter((f) => f.endsWith(".html"))) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const ref of htmlRefs(source)) {
        const rel = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), ref));
        if (!fs.existsSync(path.join(ROOT, rel))) problems.push(`${file}: ${ref} not found`);
        else if (!isPackaged(rel)) problems.push(`${file}: ${ref} is not in build.files`);
      }
    }
    expect(problems).toEqual([]);
  });
});
