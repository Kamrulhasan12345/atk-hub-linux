// Linux replacement for ATK HUB's `system-activate-windows` (Rust, Win32 GetForegroundWindow).
// Same interface: new SystemActivityMonitor(); start(cb); stop(); isCurrent(revision).
// cb(null, {kind: "foreground", revision, appPath}) on every focus change.
// KDE Plasma 6 only: a KWin script reports the focused window's PID over D-Bus.
const fs = require("fs");
const os = require("os");
const path = require("path");
const dbus = require(require.resolve("dbus-next", { paths: [path.join(__dirname, "native")] }));
const { watchAtkMouse } = require("./mouseactivity.js");

const NAME = "org.atkhub.Activity";
const SCRIPT_FILE = path.join(os.tmpdir(), "atkhub-activity.js"); // KWin names the script by this path
const SCRIPT = `
function report(w) {
  if (w) callDBus("${NAME}", "/", "${NAME}", "Activated", w.pid, String(w.resourceClass || ""));
}
workspace.windowActivated.connect(report);
report(workspace.activeWindow);
`;

// Executable path for a PID. Wine/Proton games run as wine-preloader; map their Windows argv0
// back to the Unix path of the .exe so ATK HUB's path matching works (it checks the game folder).
function appPathOf(pid) {
  let exe;
  try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch { return ""; }
  if (!/wine|preloader/.test(path.basename(exe))) return exe;
  let argv0 = "", cwd = "";
  try { argv0 = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0]; } catch {}
  try { cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch {}
  return fromWine(argv0, cwd) || exe;
}

// Z:\home\u\game.exe -> /home/u/game.exe; C:\...\game.exe -> <cwd>/game.exe (games run from their folder)
function fromWine(argv0, cwd) {
  if (!/^[A-Za-z]:\\/.test(argv0)) return argv0;
  if (/^z:/i.test(argv0)) return argv0.slice(2).replace(/\\/g, "/");
  return cwd ? path.join(cwd, argv0.split("\\").pop()) : argv0;
}

class SystemActivityMonitor {
  constructor() {
    this.revision = 0;
    this.bus = null;
  }

  start(cb) {
    const self = this;
    class Receiver extends dbus.interface.Interface {
      Activated(pid) {
        const appPath = appPathOf(pid);
        if (!appPath || appPath === self.lastPath) return;
        self.lastPath = appPath;
        cb(null, { kind: "foreground", revision: ++self.revision, appPath });
      }
    }
    Receiver.configureMembers({ methods: { Activated: { inSignature: "is", outSignature: "" } } });

    // ATK HUB calls start() synchronously and treats a throw as failure; KWin setup is async.
    (async () => {
      this.bus = dbus.sessionBus();
      this.bus.export("/", new Receiver(NAME));
      await this.bus.requestName(NAME, 0);
      const scripting = (await this.bus.getProxyObject("org.kde.KWin", "/Scripting")).getInterface("org.kde.kwin.Scripting");
      await scripting.unloadScript(SCRIPT_FILE); // leftover from a crashed run
      fs.writeFileSync(SCRIPT_FILE, SCRIPT);
      await scripting.loadScript(SCRIPT_FILE); // 1-arg overload: dbus-next can't pick KWin's 2-arg one
      await scripting.start();
    })().catch((e) => cb(new Error(`KWin activity monitor unavailable (KDE Plasma 6 needed): ${e.message}`)));
    // ATK HUB retries a profile switch that failed while the mouse slept on the next mouse activity.
    this.mouse = watchAtkMouse(() => cb(null, { kind: "mouse", revision: this.revision }));
  }

  stop() {
    if (this.mouse) this.mouse.stop();
    this.mouse = null;
    const bus = this.bus;
    this.bus = null;
    this.lastPath = undefined;
    if (!bus) return;
    bus.getProxyObject("org.kde.KWin", "/Scripting")
      .then((o) => o.getInterface("org.kde.kwin.Scripting").unloadScript(SCRIPT_FILE))
      .catch(() => {})
      .finally(() => bus.disconnect());
  }

  isCurrent(revision) {
    return revision === this.revision;
  }
}

module.exports = { SystemActivityMonitor, appPathOf, fromWine };
