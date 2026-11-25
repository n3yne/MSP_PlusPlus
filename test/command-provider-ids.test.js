// Every plugin's Ctrl+K provider id must pass the core's check in
// commands.addProvider (src/windows/renderer.js), or the call throws and the
// provider's items never show (Quick Actions' "quick-actions.set" did).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const core = fs.readFileSync(path.join(ROOT, "src/windows/renderer.js"), "utf-8");
const coreCheck = core.match(/if \(!(\/\^[^\n]*?\/i?)\.test\(id\)\) throw new Error\("commands\.addProvider: invalid id"\)/);

function providerIds(source) {
  const ids = [];
  const re = /addProvider\(\{\s*id:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(source))) ids.push(m[1]);
  return ids;
}

describe("command palette provider ids", () => {
  test("the core check is found", () => {
    expect(coreCheck).not.toBeNull();
  });

  const pluginsDir = path.join(ROOT, "plugins");
  const files = fs.readdirSync(pluginsDir)
    .map((d) => path.join(pluginsDir, d, "renderer.js"))
    .filter((f) => fs.existsSync(f));

  test.each(files.map((f) => [path.relative(ROOT, f), f]))("%s", (_name, file) => {
    const source = fs.readFileSync(file, "utf-8");
    const calls = (source.match(/addProvider\(/g) || []).length;
    const ids = providerIds(source);
    // Every call names a literal id, so this test sees them all.
    expect(ids.length).toBe(calls);
    const [, body, flags] = coreCheck[1].match(/^\/(.*)\/(\w*)$/);
    const check = new RegExp(body, flags);
    ids.forEach((id) => expect([id, check.test(id)]).toEqual([id, true]));
  });
});
