// Renderer preload: install the shim, then run this window's own ATK HUB preload unchanged.
require("./shim.js");
if (process.env.ATKHUB_HIDLOG) require("./hidlog.js"); // load before hidfix so it logs what is really sent
require("./hidfix.js");
const arg = process.argv.find((a) => a.startsWith("--atkhub-preload="));
if (arg) require(arg.slice("--atkhub-preload=".length));
