// node test_lockkeys.js — LED reading + ATK HUB setting defaults
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readLocks, enabled } = require("./lockkeys.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leds-"));
const led = (name, v) => { fs.mkdirSync(path.join(dir, name), { recursive: true }); fs.writeFileSync(path.join(dir, name, "brightness"), `${v}\n`); };
led("input3::capslock", 0); led("input3::numlock", 1); led("input9::capslock", 1); led("input3::scrolllock", 0); led("phy0-led", 1);
assert.deepStrictEqual(readLocks(dir), { caps: true, num: true, scroll: false }); // any keyboard lit counts
assert.deepStrictEqual(readLocks(path.join(dir, "missing")), { caps: false, num: false, scroll: false });

assert.strictEqual(enabled({}, "caps"), false);                                  // master switch off by default
assert.strictEqual(enabled({ keyboardLockHintEnabled: true }, "caps"), true);
assert.strictEqual(enabled({ keyboardLockHintEnabled: true }, "num"), true);
assert.strictEqual(enabled({ keyboardLockHintEnabled: true }, "scroll"), false); // scroll off by default
assert.strictEqual(enabled({ keyboardLockHintEnabled: true, capsLockHintEnabled: false }, "caps"), false);
fs.rmSync(dir, { recursive: true });
console.log("lockkeys tests ok");
