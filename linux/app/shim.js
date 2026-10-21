// Linux shim for ATK HUB: Windows-only native addons can't load here, so return an inert
// stand-in instead of crashing. Loaded first in both the main process and the renderer preload.
const Module = require("module");

const NATIVE = new Set([
  "atk-mouse-system-api", "atk-game-helper", "electron-as-wallpaper-atk", "key-linker-lib",
  "koffi", "loudness", "music-rhythm-node", "node-hid", "sound-tools", "system-activate-windows",
  "usb", "@napi-rs/canvas", "uiohook-napi",
]);

function stub(name) {
  const fn = function () {};
  const p = new Proxy(fn, {
    get(_, k) {
      if (k === "then") return undefined; // not a Promise
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "toString" || k === "toJSON") return () => "";
      if (k === "__linuxStub") return name;
      return p;
    },
    apply: () => p,
    construct: () => p,
  });
  return p;
}

// Same versions as ATK HUB 3.2.28 bundles, installed with their Linux prebuilds (see native/package.json).
const LINUX_BUILDS = new Set(["node-hid", "usb", "koffi", "@napi-rs/canvas", "loudness"]);
const NATIVE_DIR = require("path").join(__dirname, "native");

// Windows-only addons with a Linux reimplementation here.
const PORTED = {
  "system-activate-windows": require("path").join(__dirname, "activity.js"),
  "atk-mouse-system-api": require("path").join(__dirname, "mousesettings.js"),
};

const load = Module._load;
Module._load = function (request, parent, isMain) {
  const pkg = request.startsWith("@") ? request.split("/").slice(0, 2).join("/") : request.split("/")[0];
  if (PORTED[request]) request = PORTED[request];
  else if (LINUX_BUILDS.has(pkg)) request = require.resolve(request, { paths: [NATIVE_DIR] });
  try {
    return load.call(this, request, parent, isMain);
  } catch (e) {
    if (!NATIVE.has(pkg)) throw e; // only whole packages; inner lookups have their own fallbacks
    if (!process.env.ATKHUB_QUIET) console.warn(`[linux-shim] ${request} unavailable on Linux (${e.message.split("\n")[0]})`);
    return stub(request);
  }
};
