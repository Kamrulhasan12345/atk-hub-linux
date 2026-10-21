// node test_globalshortcut.js — accelerator translation (portal binding itself needs a user approval)
const assert = require("assert");
const { toTrigger } = require("./globalshortcut.js");
assert.strictEqual(toTrigger("CommandOrControl+Shift+H"), "CTRL+SHIFT+h");
assert.strictEqual(toTrigger("Alt+F4"), "ALT+F4");
assert.strictEqual(toTrigger("Super+Ctrl+K"), "LOGO+CTRL+k");
assert.strictEqual(toTrigger("CmdOrCtrl + Space"), "CTRL+Space");
console.log("globalshortcut tests ok");
