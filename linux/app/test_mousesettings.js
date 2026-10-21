// node test_mousesettings.js — Windows <-> KDE value mapping
const assert = require("assert");
const m = require("./mousesettings.js");
assert.strictEqual(m.speedToAccel(10), 0);
assert.strictEqual(m.speedToAccel(20), 1);
assert.strictEqual(m.speedToAccel(1), -0.9);
for (let v = 1; v <= 20; v++) assert.strictEqual(m.accelToSpeed(m.speedToAccel(v)), v); // round trip
assert.strictEqual(m.linesToFactor(3), 1);
assert.strictEqual(m.factorToLines(1), 3);
assert.strictEqual(m.factorToLines(m.linesToFactor(6)), 6);
assert.strictEqual(m.linesToFactor(-1), 10);
console.log("mousesettings tests ok");
