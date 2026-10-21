// Calls onMove (at most once per throttleMs) while an ATK mouse sends input. Reads the mouse
// interface's hidraw node, so it works on any desktop and Wayland (no global input hooks needed);
// hidraw readers get a copy of each report, the system still receives them. Rescans for hotplug.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const VID = "0000373B";
const MOUSE_USAGE = Buffer.from([0x05, 0x01, 0x09, 0x02]); // Usage Page Generic Desktop, Usage Mouse

function atkMouseNodes(sysDir = "/sys/class/hidraw") {
  let names = [];
  try { names = fs.readdirSync(sysDir); } catch { return []; }
  return names.filter((n) => {
    try {
      return fs.readFileSync(path.join(sysDir, n, "device", "uevent"), "utf8").includes(`:${VID}:`)
        && fs.readFileSync(path.join(sysDir, n, "device", "report_descriptor")).includes(MOUSE_USAGE);
    } catch { return false; }
  }).map((n) => `/dev/${n}`);
}

// Read via `cat`: Node reads char devices with blocking thread-pool reads that destroy() can't
// interrupt (a pending read hangs process exit); a child's pipe is pollable and killable.
function watchAtkMouse(onMove, { throttleMs = 1000, rescanMs = 5000 } = {}) {
  const readers = new Map();
  let last = 0;
  const scan = () => {
    for (const node of atkMouseNodes()) {
      if (readers.has(node)) continue;
      const cat = spawn("cat", [node], { stdio: ["ignore", "pipe", "ignore"] });
      cat.stdout.on("data", () => {
        const now = Date.now();
        if (now - last >= throttleMs) { last = now; onMove(); }
      });
      cat.on("exit", () => readers.delete(node)); // unplugged or no permission
      cat.on("error", () => readers.delete(node));
      readers.set(node, cat);
    }
  };
  const stop = () => {
    clearInterval(timer);
    for (const cat of readers.values()) cat.kill();
    readers.clear();
  };
  scan();
  const timer = setInterval(scan, rescanMs);
  process.once("exit", stop);
  return { stop };
}

module.exports = { watchAtkMouse, atkMouseNodes };
