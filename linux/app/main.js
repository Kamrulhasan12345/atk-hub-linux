// Linux launcher: runs ATK HUB's original, unmodified main process (resources/app.asar) in Electron.
require("./shim.js");
const path = require("path");
const electron = require("electron");

const RES = path.join(__dirname, "resources");
// app-env.json, main/app.asar (the UI), osd/ are looked up here; plain assignment is ignored
Object.defineProperty(process, "resourcesPath", { value: RES, configurable: true });
Object.defineProperty(electron.app, "isPackaged", { get: () => true }); // else it loads a dev server + devtools
electron.app.setName("ATK HUB");
electron.app.setPath("userData", path.join(electron.app.getPath("appData"), "ATK HUB"));

// Route every window's preload through ours so the renderer gets the shim first.
const OrigBW = electron.BrowserWindow;
class BrowserWindow extends OrigBW {
  constructor(opts = {}) {
    const wp = opts.webPreferences || {};
    // Only node-integrated windows can require the shim; sandboxed ones keep their own preload.
    if (wp.preload && wp.nodeIntegration && wp.contextIsolation === false) {
      const args = [...(wp.additionalArguments || []), `--atkhub-preload=${wp.preload}`];
      opts = { ...opts, webPreferences: { ...wp, preload: path.join(__dirname, "preload.js"), additionalArguments: args } };
    }
    super(opts);
    // Lock-key overlay titles are hard-coded Chinese ("Caps lock 开启"); translate on the way in.
    const loadFile = this.loadFile.bind(this);
    this.loadFile = (file, options) => {
      const title = options && options.query && options.query.title;
      if (typeof title === "string" && String(file).endsWith("osd-shell.html"))
        options = { ...options, query: { ...options.query, title: title.replace("开启", "on").replace("关闭", "off") } };
      return loadFile(file, options);
    };
  }
}
const MAIN = path.join(RES, "app.asar", "dist-electron", "main", "index.js");
let mainExports; // their module's exports; it sets exports.browserWindow (tray clicks happen after load)
const Tray = require("./tray.js")(electron, () => mainExports, RES);
require("./notify.js")(electron, () => mainExports, RES);
require("./lockkeys.js")(electron, () => mainExports);

// electron's exports are non-configurable, so hand their code a forwarding copy instead.
const OVERRIDES = { BrowserWindow, Tray, globalShortcut: require("./globalshortcut.js")() };
const wrapped = {};
for (const k of Object.getOwnPropertyNames(electron))
  Object.defineProperty(wrapped, k, { enumerable: true, get: () => OVERRIDES[k] || electron[k] });
const Module = require("module");
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "electron" ? wrapped : load.call(this, request, ...rest);
};

mainExports = require(MAIN);
