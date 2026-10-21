// Linux replacement for ATK HUB's `atk-mouse-system-api` (Windows SPI mouse speed / wheel lines).
// KDE Plasma 6 only: applies to the ATK mouse's KWin input devices (live over D-Bus) and saves the
// value in kcminputrc so it survives a restart. AudioSystemSetting is not provided (feature off).
const path = require("path");
const { execFile } = require("child_process");
const dbus = require(require.resolve("dbus-next", { paths: [path.join(__dirname, "native")] }));

const ATK_VENDOR = 14139; // 0x373b
const ROOT = "/org/kde/KWin/InputDevice";
const IFACE = "org.kde.KWin.InputDevice";

// Windows pointer speed 1..20 (10 = default) <-> libinput acceleration -1..1 (0 = default)
const speedToAccel = (v) => Math.max(-1, Math.min(1, (Number(v) - 10) / 10));
const accelToSpeed = (a) => Math.max(1, Math.min(20, Math.round(Number(a) * 10) + 10));
// Windows wheel lines per notch (3 = default, -1 = one page) <-> KDE scroll factor (1 = default)
const linesToFactor = (n) => (Number(n) === -1 ? 10 : Math.max(0.1, Number(n) / 3)); // ponytail: libinput has no page mode
const factorToLines = (f) => Math.max(1, Math.round(Number(f) * 3));

let bus = null;
const getBus = () => bus || (bus = dbus.sessionBus());

async function props(sysName) {
  const obj = await getBus().getProxyObject("org.kde.KWin", `${ROOT}/${sysName}`);
  return obj.getInterface("org.freedesktop.DBus.Properties");
}

// [{sysName, name, vendor, product, props}] for ATK pointer devices
async function atkPointers() {
  const mgr = (await getBus().getProxyObject("org.kde.KWin", ROOT)).getInterface("org.freedesktop.DBus.Properties");
  const names = (await mgr.Get("org.kde.KWin.InputDeviceManager", "devicesSysNames")).value;
  const out = [];
  for (const sysName of names) {
    const p = await props(sysName);
    const get = async (k) => (await p.Get(IFACE, k)).value;
    // the dongle's keyboard interface also shows up as a pointer, but can't take acceleration; skip it
    if ((await get("vendor")) !== ATK_VENDOR || !(await get("pointer")) || (await get("touchpad"))
      || !(await get("supportsPointerAcceleration"))) continue;
    out.push({ sysName, props: p, name: await get("name"), vendor: ATK_VENDOR, product: await get("product") });
  }
  return out;
}

async function apply(key, kcmKey, value) {
  const devices = await atkPointers();
  for (const d of devices) {
    await d.props.Set(IFACE, key, new dbus.Variant("d", value));
    execFile("kwriteconfig6", ["--file", "kcminputrc", "--group", "Libinput", "--group", String(d.vendor),
      "--group", String(d.product), "--group", d.name, "--key", kcmKey, value.toFixed(3)], () => {});
  }
  return devices.length > 0;
}

async function read(key, fallback) {
  const [d] = await atkPointers();
  return d ? (await d.props.Get(IFACE, key)).value : fallback;
}

class MouseSystemSetting {
  async getMouseSpeed() { return accelToSpeed(await read("pointerAcceleration", 0)); }
  async setMouseSpeed(v) { return apply("pointerAcceleration", "PointerAcceleration", speedToAccel(v)); }
  async getMouseScrollLines() { return factorToLines(await read("scrollFactor", 1)); }
  async setMouseScrollLines(n) { return apply("scrollFactor", "ScrollFactor", linesToFactor(n)); }
}

module.exports = { MouseSystemSetting, speedToAccel, accelToSpeed, linesToFactor, factorToLines };
