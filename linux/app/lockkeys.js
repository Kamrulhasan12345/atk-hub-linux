// Caps/Num/Scroll Lock overlay outside the hub window. ATK HUB polls Win32 GetKeyState (win32 only);
// on Linux the same state is in the keyboard LED class files, readable without root on any desktop.
// Changes are shown through ATK HUB's own overlay (its lockHint:testShow handler), honouring its settings.
const fs = require("fs");
const path = require("path");

const KINDS = { caps: "capslock", num: "numlock", scroll: "scrolllock" };

// {caps, num, scroll} -> true if that LED is lit on any keyboard
function readLocks(ledDir = "/sys/class/leds") {
  const state = { caps: false, num: false, scroll: false };
  let names = [];
  try { names = fs.readdirSync(ledDir); } catch { return state; }
  for (const [kind, suffix] of Object.entries(KINDS)) {
    state[kind] = names.some((n) => {
      if (!n.endsWith(`::${suffix}`)) return false;
      try { return Number(fs.readFileSync(path.join(ledDir, n, "brightness"), "utf8")) > 0; } catch { return false; }
    });
  }
  return state;
}

// ATK HUB's defaults: master switch off; caps and num on; scroll off.
function enabled(setting = {}, kind) {
  if (setting.keyboardLockHintEnabled !== true) return false;
  if (kind === "caps") return setting.capsLockHintEnabled !== false;
  if (kind === "num") return setting.numLockHintEnabled !== false;
  return setting.scrollLockHintEnabled === true;
}

function installLockKeys(electron, getMainExports) {
  const { ipcMain, app } = electron;
  let show = null;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => {
    if (channel === "lockHint:testShow") show = fn;
    return handle(channel, fn);
  };

  const readSetting = () => {
    try { return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8")).setting || {}; }
    catch { return {}; }
  };
  let last = null;
  app.whenReady().then(() => setInterval(() => {
    const now = readLocks();
    const prev = last;
    last = now;
    if (!prev || !show) return;
    const w = (getMainExports() || {}).browserWindow;
    if (w && !w.isDestroyed() && w.isFocused()) return; // ATK HUB's in-window key handler covers this
    for (const kind of Object.keys(KINDS)) {
      if (now[kind] !== prev[kind] && enabled(readSetting(), kind)) show(null, { kind, on: now[kind] });
    }
  }, 150));
}

module.exports = installLockKeys;
module.exports.readLocks = readLocks;
module.exports.enabled = enabled;
