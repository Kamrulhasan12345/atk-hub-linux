// Electron's globalShortcut can't grab keys on Wayland (register() returns true, nothing fires, and
// Electron 39 doesn't use the portal even with GlobalShortcutsPortal). This replaces it for ATK HUB
// with the xdg-desktop-portal GlobalShortcuts API (KDE, GNOME 48+, Hyprland, ...), same interface.
// The desktop asks the user once to approve the binding.
const path = require("path");
const dbus = require(require.resolve("dbus-next", { paths: [path.join(__dirname, "native")] }));

const PORTAL = "org.freedesktop.portal.Desktop";
const OBJ = "/org/freedesktop/portal/desktop";
const IFACE = "org.freedesktop.portal.GlobalShortcuts";

// Electron accelerator -> XDG shortcut trigger ("CommandOrControl+Shift+H" -> "CTRL+SHIFT+h")
function toTrigger(accel) {
  const MOD = { commandorcontrol: "CTRL", cmdorctrl: "CTRL", control: "CTRL", ctrl: "CTRL", alt: "ALT", option: "ALT",
    altgr: "ALT", shift: "SHIFT", super: "LOGO", meta: "LOGO", command: "LOGO", cmd: "LOGO" };
  const parts = String(accel).split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || "";
  const mods = parts.map((p) => MOD[p.toLowerCase()]).filter(Boolean);
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join("+");
}

function createGlobalShortcut() {
  const callbacks = new Map(); // accelerator -> callback
  let bus = null;
  let session = null;
  let timer = null;
  let n = 0;

  const getBus = () => {
    if (bus) return bus;
    bus = dbus.sessionBus();
    bus.on("message", (msg) => {
      if (msg.interface === IFACE && msg.member === "Activated" && msg.body[0] === session) {
        const cb = callbacks.get(msg.body[1]);
        if (cb) cb();
      }
    });
    bus.call(new dbus.Message({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus", member: "AddMatch", signature: "s",
      body: [`type='signal',interface='${IFACE}',member='Activated'`] })).catch(() => {});
    return bus;
  };

  // Portal calls answer through a Request object's Response signal; subscribe before calling.
  async function request(member, signature, bodyWithoutOptions, options = {}) {
    const b = getBus();
    if (!b.name) await new Promise((resolve) => b.once("connect", resolve)); // unique name arrives after Hello
    const token = `atkhub${process.pid}_${++n}`;
    const sender = b.name.slice(1).replace(/\./g, "_");
    const reqPath = `${OBJ}/request/${sender}/${token}`;
    const match = `type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${reqPath}'`;
    const addMatch = (m) => b.call(new dbus.Message({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus",
      interface: "org.freedesktop.DBus", member: m, signature: "s", body: [match] }));
    await addMatch("AddMatch");
    const response = new Promise((resolve) => {
      const onMsg = (msg) => {
        if (msg.path !== reqPath || msg.member !== "Response") return;
        b.removeListener("message", onMsg);
        addMatch("RemoveMatch").catch(() => {});
        resolve({ code: msg.body[0], results: msg.body[1] });
      };
      b.on("message", onMsg);
    });
    await b.call(new dbus.Message({ destination: PORTAL, path: OBJ, interface: IFACE, member, signature,
      body: [...bodyWithoutOptions, { ...options, handle_token: new dbus.Variant("s", token) }] }));
    return response;
  }

  async function rebind() {
    const b = getBus();
    if (session) { // a session binds once; replace it
      b.call(new dbus.Message({ destination: PORTAL, path: session, interface: "org.freedesktop.portal.Session",
        member: "Close" })).catch(() => {});
      session = null;
    }
    if (!callbacks.size) return;
    const created = await request("CreateSession", "a{sv}", [],
      { session_handle_token: new dbus.Variant("s", `atkhub${process.pid}`) });
    if (created.code !== 0) throw new Error(`portal CreateSession refused (${created.code})`);
    session = created.results.session_handle.value;
    const shortcuts = [...callbacks.keys()].map((accel) => [accel, {
      description: new dbus.Variant("s", "Show/hide ATK HUB"),
      preferred_trigger: new dbus.Variant("s", toTrigger(accel)),
    }]);
    const bound = await request("BindShortcuts", "oa(sa{sv})sa{sv}", [session, shortcuts, ""]);
    if (bound.code !== 0) console.warn(`[globalShortcut] portal BindShortcuts not granted (${bound.code})`);
  }

  // Debounced: ATK HUB's "test shortcut" registers and immediately unregisters; don't prompt for that.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => rebind().catch((e) => console.warn("[globalShortcut]", e.message)), 600);
  };

  return {
    _request: request, // tests: exercise portal plumbing without BindShortcuts (which prompts the user)
    register(accel, cb) { callbacks.set(accel, cb); schedule(); return true; },
    unregister(accel) { if (callbacks.delete(accel)) schedule(); },
    unregisterAll() { if (callbacks.size) { callbacks.clear(); schedule(); } },
    isRegistered(accel) { return callbacks.has(accel); },
    registerAll(accels, cb) { accels.forEach((a) => callbacks.set(a, cb)); schedule(); return true; },
  };
}

module.exports = createGlobalShortcut;
module.exports.toTrigger = toTrigger;
