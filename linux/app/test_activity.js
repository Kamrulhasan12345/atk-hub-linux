// node test_activity.js — path mapping + compatibility with ATK HUB's own matcher (copied from main/index.js)
const assert = require("assert");
const path = require("path");
const { fromWine, appPathOf } = require("./activity.js");

function matchAppName(e, watchApp) { // verbatim logic of ATK HUB's xF.matchAppName
  const r = e.split("\\").pop().replace(/\.(exe|app)$/i, "");
  for (const s of Object.keys(watchApp)) {
    const o = path.dirname(path.normalize(s));
    if (e.includes(o) && watchApp[s]?.length && new RegExp(watchApp[s][0].name, "i").test(r)) return watchApp[s];
  }
  return [];
}

assert.strictEqual(appPathOf(process.pid), process.execPath);
assert.strictEqual(fromWine("Z:\\home\\u\\Games\\Foo\\foo.exe", "/x"), "/home/u/Games/Foo/foo.exe");
assert.strictEqual(fromWine("C:\\Program Files\\Foo\\foo.exe", "/home/u/.steam/steamapps/common/Foo"), "/home/u/.steam/steamapps/common/Foo/foo.exe");
assert.strictEqual(fromWine("/usr/bin/foo", "/x"), "/usr/bin/foo");

// bindings as ATK HUB's getAppInfo builds them: key = picked path, name = basename without extension
const native = { "/home/u/.steam/steamapps/common/CS2/game/bin/linuxsteamrt64/cs2": [{ name: "cs2" }] };
assert.strictEqual(matchAppName("/home/u/.steam/steamapps/common/CS2/game/bin/linuxsteamrt64/cs2", native).length, 1);
assert.strictEqual(matchAppName("/usr/bin/ghostty", native).length, 0);
const proton = { "/home/u/.steam/steamapps/common/Foo/foo.exe": [{ name: "foo" }] };
assert.strictEqual(matchAppName(fromWine("C:\\Foo\\foo.exe", "/home/u/.steam/steamapps/common/Foo"), proton).length, 1);
console.log("activity tests ok");
