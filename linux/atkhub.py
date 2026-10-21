#!/usr/bin/env python3
"""ATK HUB for Linux: configure ATK / VXE mice (bitMouse protocol) over hidraw.

Protocol reverse-engineered from ATK HUB 3.2.28 (filter-*.js, controller "bitMouse").
Output report 8, 63 bytes:
  [0]=checksum(sum [1..62] & 0xff) [1]=0x72 [2]=paramLen [3]=sn [4]=target
  [5]=commandId [6]=cmdLen [7..]=data
Input report 8 (hidraw read, report id first):
  [0]=8 [1]=0x72 [2]=status(255=error) [3]=sn [4]=target [5]=commandId [6]=len [7..]=data
target: 1 = mouse behind the dongle, 0 = dongle itself (or a wired mouse).
"""
import argparse, glob, json, os, select, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from models import MODELS

VID = 0x373B
SENSORS = {  # (min, max, step) from mouse-skins.js
    "PAW3955MASTER": (1, 50000, 1), "PAW3950Ultra": (10, 42000, 10),
    "PAW3950DM": (50, 36000, 50), "PAW3950": (50, 36000, 50),
    "PAW3395Ultra": (100, 30000, 50), "PAW3395": (100, 30000, 50),
    "CORE26K": (50, 26000, 50), "PAW3395SE": (200, 18000, 50),
    "PAW3315": (200, 16000, 100), "PAW3311": (200, 15000, 100), "PAW3320": (200, 4000, 39),
}
RATES = {1000: 0, 500: 1, 250: 2, 125: 3, 8000: 4, 4000: 5, 2000: 6}
SENSOR_MODES = {"base": 0, "athletics": 4, "athletics-max": 5}
LIGHT_MODES = {"off": 0, "breathing": 1, "steady": 2}
LIGHT_BRIGHT = {"low": 85, "medium": 170, "high": 255}
LIGHT_SPEED = {"slow": 10, "medium": 15, "fast": 20}
BUTTONS = ["left", "right", "middle", "back", "forward", "bottom"]  # index = button address
ACTIONS = {  # keyClass, b2, b3, b4  (byte layout of SetButtonKey after keyIndex)
    "left": (1, 0, 0, 0), "right": (1, 0, 1, 0), "middle": (1, 0, 2, 0),
    "back": (1, 0, 3, 0), "forward": (1, 0, 4, 0),
    "dpi-cycle": (10, 0, 0, 0), "dpi+": (11, 0, 0, 0), "dpi-": (12, 0, 0, 0),
    "scroll-up": (13, 0, 0, 0), "scroll-down": (14, 0, 0, 0),
    "scroll-left": (15, 0, 0, 0), "scroll-right": (16, 0, 0, 0),
    "profile1": (17, 0, 0, 0), "profile2": (18, 0, 0, 0), "profile3": (19, 0, 0, 0),
    "profile4": (20, 0, 0, 0), "profile-loop": (21, 0, 0, 0), "disable": (255, 0, 0, 0),
}
CLASS_NAMES = {0: "none", 1: "mouse", 2: "media", 3: "key", 4: "macro", 5: "fire", 10: "dpi-cycle",
               11: "dpi+", 12: "dpi-", 13: "scroll-up", 14: "scroll-down", 15: "scroll-left",
               16: "scroll-right", 17: "profile1", 18: "profile2", 19: "profile3", 20: "profile4",
               21: "profile-loop", 255: "disable"}
MODS = {"ctrl": 1, "shift": 2, "alt": 4, "super": 8, "rctrl": 16, "rshift": 32, "ralt": 64, "rsuper": 128}
HID_KEYS = {**{chr(97 + i): 4 + i for i in range(26)}, **{str((i + 1) % 10): 30 + i for i in range(10)},
            **{f"f{i}": 57 + i for i in range(1, 13)},
            "enter": 40, "esc": 41, "backspace": 42, "tab": 43, "space": 44, "minus": 45, "equal": 46,
            "capslock": 57, "printscreen": 70, "home": 74, "pageup": 75, "delete": 76, "end": 77,
            "pagedown": 78, "right": 79, "left": 80, "down": 81, "up": 82, "insert": 73}
MEDIA = {"vol+": 0xE9, "vol-": 0xEA, "mute": 0xE2, "play": 0xCD, "next": 0xB5, "prev": 0xB6, "stop": 0xB7,
         "brightness+": 0x6F, "brightness-": 0x70}


class ATKError(Exception):
    pass


def find_device():
    """Return (hidraw path, name) of the vendor interface (usage page 0xFF05, report 8)."""
    for d in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        ue = Path(d, "device/uevent").read_text()
        if f"0000{VID:04X}:" not in ue:
            continue
        if bytes.fromhex("0605ff0901a1018508") in Path(d, "device/report_descriptor").read_bytes():
            name = next((l[9:] for l in ue.splitlines() if l.startswith("HID_NAME=")), "?")
            return "/dev/" + os.path.basename(d), name
    raise ATKError("no ATK/VXE device found (is the dongle plugged in?)")


def build(cmd, plen, clen, data=b"", target=0):
    p = bytearray(63)
    p[1], p[2], p[4], p[5], p[6] = 0x72, plen, target, cmd, clen
    p[7:7 + len(data)] = data
    p[0] = sum(p[1:]) & 0xFF
    return bytes([8]) + p


class Mouse:
    def __init__(self, path=None):
        self.path, self.name = (path, path) if path else find_device()
        self.receiver = "dongle" in self.name.lower()
        try:
            self.fd = os.open(self.path, os.O_RDWR)
        except PermissionError:
            raise ATKError(f"no access to {self.path}; install 99-atk-hub.rules (see README)")
        self.sensor = "PAW3395"

    def tx(self, cmd, plen, clen, data=b"", dongle=False, timeout=1.0):
        target = 1 if self.receiver and not dongle else 0
        for _ in range(3):  # app retries 3x too
            os.write(self.fd, build(cmd, plen, clen, data, target))
            end = time.monotonic() + timeout
            while (left := end - time.monotonic()) > 0:
                if not select.select([self.fd], [], [], left)[0]:
                    break
                r = os.read(self.fd, 64)
                if len(r) > 7 and r[1] == 0x72 and r[5] == cmd:
                    if r[2] == 255:
                        raise ATKError(f"device rejected command {cmd}")
                    return r[7:]
        raise ATKError(f"no reply to command {cmd} (mouse asleep/off? move it and retry)")

    # --- reads ---
    def read_mem(self, addr, n):
        out = b""
        while n > 0:
            k = min(n, 10)
            r = self.tx(23, 10, 13, addr.to_bytes(2, "little") + bytes([k]))
            out += r[3:3 + k]
            addr, n = addr + k, n - k
        return out

    def dongle_version(self):
        return ".".join(map(str, self.tx(136, 5, 3, dongle=True)[:3]))

    def online(self):
        if not self.receiver:
            return True
        return bool(self.tx(129, 3, 1, dongle=True)[0])  # cmd 35 reads 0 even when linked (R1 S fw 1.0.12)

    def info(self):
        cid, mid = self.tx(74, 8, 6)[1:3]  # mid is a u32 LE, only low byte used in table
        name, self.sensor = MODELS.get(f"{cid},{mid}", (f"unknown ({cid},{mid})", "PAW3395"))
        cfg = self.tx(9, 20, 18)
        perf, = self.read_mem(74, 1)
        light = self.read_mem(76, 3)
        dpi = self.read_mem(1, 66)
        stages = []
        for i in range(8):
            o = 2 + 8 * i
            stages.append({"x": int.from_bytes(dpi[o:o + 2], "little"),
                           "y": int.from_bytes(dpi[o + 2:o + 4], "little"),
                           "color": "#%02x%02x%02x" % (dpi[o + 6], dpi[o + 5], dpi[o + 4])})
        keys = self.read_mem(82, 30)
        rate = {v: k for k, v in RATES.items()}.get(cfg[2])
        return {
            "device": self.name, "model": name, "sensor": self.sensor,
            "dpi_range": SENSORS.get(self.sensor, (50, 30000, 50)),
            "firmware": ".".join(map(str, self.tx(28, 5, 3)[:3])),
            "dongle_firmware": self.dongle_version() if self.receiver else None,
            "battery": self.tx(7, 2, 1)[0], "charging": bool(self.tx(15, 2, 1)[0]),
            "profile": cfg[0], "polling_rate": rate,
            "lod": cfg[5] + 1, "motion_sync": cfg[6], "angle_snap": cfg[7], "ripple": cfg[8],
            "sleep": int.from_bytes(cfg[9:11], "little"), "debounce": cfg[11],
            "sensor_mode": {v: k for k, v in SENSOR_MODES.items()}.get(perf, perf),
            "light": {"mode": {v: k for k, v in LIGHT_MODES.items()}.get(light[0], light[0]),
                      "brightness": light[1], "speed": light[2]},
            "dpi_stage": dpi[0], "dpi_stages": dpi[1], "dpi": stages,
            "buttons": {b: describe_action(keys[5 * i:5 * i + 5]) for i, b in enumerate(BUTTONS)},
        }

    # --- writes ---
    def set_dpi(self, stage, x, y=None, color="#ff0000", active=False):
        lo, hi, _ = SENSORS.get(self.sensor, (1, 50000, 1))
        y = x if y is None else y
        if not (lo <= x <= hi and lo <= y <= hi and 0 <= stage < 8):
            raise ATKError(f"dpi must be {lo}-{hi}, stage 1-8")
        r, g, b = bytes.fromhex(color.lstrip("#"))
        d = bytes([stage]) + x.to_bytes(2, "little") + y.to_bytes(2, "little") + bytes([b, g, r, 0, int(active)])
        self.tx(2, 12, 10, d)

    def set_rate(self, hz):
        self.tx(1, 3, 1, bytes([RATES[hz]]))

    def set_lod(self, level):  # app UI: 1..N  -> offsetCalibration = level-1
        self.tx(3, 4, 2, bytes([0, level - 1]))

    def set_flag(self, cmd, v):  # motion sync 13, angle snap 11, ripple 12, debounce 22
        self.tx(cmd, 3, 1, bytes([v]))

    def set_sleep(self, v):
        self.tx(21, 5, 2, v.to_bytes(2, "little"))

    def set_sensor_mode(self, mode):
        self.tx(31, 3, 1, bytes([SENSOR_MODES[mode]]))

    def set_light(self, mode, brightness="high", speed="medium"):
        self.tx(20, 6, 3, bytes([LIGHT_MODES[mode], LIGHT_BRIGHT[brightness], LIGHT_SPEED[speed]]))

    def set_profile(self, idx):
        self.tx(10, 3, 1, bytes([idx]))

    def set_button(self, button, action):
        self.tx(5, 8, 5, bytes([BUTTONS.index(button), *parse_action(action)]))

    def pair(self, wait=60):
        """Same sequence as the app: clear old pairing, start pairing, poll status.
        Re-arms whenever the dongle drops out of pairing mode, so it is listening when the mouse blinks."""
        self.tx(131, 3, 0, dongle=True)
        pst = 0
        for t in range(wait):
            if not pst:
                self.tx(130, 3, 0, dongle=True)
            time.sleep(1)
            conn, pst = self.tx(129, 3, 1, dongle=True)[0], self.tx(132, 3, 1, dongle=True)[0]
            print(f"  {t + 1:2d}s connected={conn} pair_status={pst}", flush=True)
            if conn:  # 132 reads 1 while merely in pairing mode
                return True
        return False

    def reset(self):
        self.tx(19, 2, 1)


def parse_action(a):
    """'back', 'dpi-cycle', 'key:ctrl+c', 'media:vol+', 'fire:3:50' -> 4 bytes."""
    a = a.lower()
    if a in ACTIONS:
        return ACTIONS[a]
    kind, _, rest = a.partition(":")
    if kind == "key":
        *mods, key = rest.split("+")
        code = HID_KEYS[key] if key in HID_KEYS else int(key, 0)
        return (3, sum(MODS[m] for m in mods), code, 0)
    if kind == "media":
        code = MEDIA[rest] if rest in MEDIA else int(rest, 0)
        return (2, 0, code & 0xFF, code >> 8)
    if kind == "fire":  # fire:<clicks>:<interval ms>
        clicks, ms = map(int, rest.split(":"))
        return (5, clicks, ms & 0xFF, ms >> 8)
    raise ATKError(f"unknown action {a!r}; try one of {', '.join(ACTIONS)}, key:ctrl+c, media:vol+, fire:3:50")


def describe_action(b):
    cls = b[0]
    if cls == 1:
        return ["left", "right", "middle", "back", "forward"][b[2]] if b[2] < 5 else f"mouse:{b[2]}"
    if cls == 3:
        keyname = {v: k for k, v in HID_KEYS.items()}.get(b[3], hex(b[3]))
        return "key:" + "+".join([m for m, bit in MODS.items() if b[1] & bit] + [keyname])
    if cls == 2:
        code = b[3] | b[4] << 8
        return "media:" + {v: k for k, v in MEDIA.items()}.get(code, hex(code))
    if cls == 4:
        return f"macro:{b[3]}"
    if cls == 5:
        return f"fire:{b[2]}:{b[3] | b[4] << 8}"
    if cls == 0:
        return "default"  # app shows the factory mapping for an unset slot
    return CLASS_NAMES.get(cls, f"raw:{bytes(b).hex()}")


def selftest():
    # dongle-version request, byte-exact with what the Windows app sends
    assert build(136, 5, 3)[:8].hex() == "0802720500008803"
    assert build(136, 5, 3)[1] == (0x72 + 5 + 136 + 3) & 0xFF
    assert parse_action("key:ctrl+c") == (3, 1, 6, 0)
    assert describe_action(bytes([3, 1, 0, 6, 0])) == "key:ctrl+c"
    assert describe_action(bytes([10, 0, 0, 0, 0])) == "dpi-cycle"
    assert parse_action("fire:3:300") == (5, 3, 44, 1)
    print("selftest ok")


def app():
    """Run the original ATK HUB desktop client (app/: its unmodified resources + a Linux shim) in Electron."""
    import shutil
    electron = next((e for e in ("electron", "electron39", "electron43", "electron38", "electron37") if shutil.which(e)), None)
    if not electron:
        raise ATKError("needs Electron (Arch: pacman -S electron39)")
    os.execvp(electron, [electron, str(Path(__file__).with_name("app"))])


def serve(port):
    import http.server, webbrowser
    html = Path(__file__).with_name("atkhub-ui.html").read_bytes()
    mouse = Mouse()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def reply(self, code, body, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                return self.reply(200, html, "text/html; charset=utf-8")
            if self.path == "/api/info":
                return self.call(mouse.info)
            self.reply(404, b"{}")

        def do_POST(self):
            if self.headers.get("Origin") not in (None, f"http://127.0.0.1:{port}"):
                return self.reply(403, b"{}")  # block other sites from driving the mouse
            req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            fn = {"dpi": lambda: mouse.set_dpi(int(req["stage"]), int(req["x"]), int(req.get("y") or req["x"]),
                                               req.get("color", "#ff0000"), bool(req.get("active"))),
                  "rate": lambda: mouse.set_rate(int(req["value"])),
                  "lod": lambda: mouse.set_lod(int(req["value"])),
                  "motion_sync": lambda: mouse.set_flag(13, int(req["value"])),
                  "angle_snap": lambda: mouse.set_flag(11, int(req["value"])),
                  "ripple": lambda: mouse.set_flag(12, int(req["value"])),
                  "debounce": lambda: mouse.set_flag(22, int(req["value"])),
                  "sleep": lambda: mouse.set_sleep(int(req["value"])),
                  "sensor_mode": lambda: mouse.set_sensor_mode(req["value"]),
                  "light": lambda: mouse.set_light(req["mode"], req["brightness"], req["speed"]),
                  "profile": lambda: mouse.set_profile(int(req["value"])),
                  "button": lambda: mouse.set_button(req["button"], req["action"]),
                  "pair": mouse.pair}.get(req.get("op"))
            if not fn:
                return self.reply(400, b'{"error":"bad op"}')
            self.call(fn)

        def call(self, fn):
            try:
                self.reply(200, json.dumps({"ok": True, "data": fn()}).encode())
            except (ATKError, KeyError, ValueError) as e:
                self.reply(200, json.dumps({"ok": False, "error": str(e)}).encode())

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{port}/"
    print(f"ATK HUB UI at {url}  (Ctrl+C to quit)")
    webbrowser.open(url)
    # ponytail: one hidraw fd shared by threads; requests are tiny, a lock is unneeded unless you script parallel calls
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(prog="atkhub", description=__doc__.splitlines()[0])
    ap.add_argument("--device", help="hidraw path (auto-detected)")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("info", help="show everything").add_argument("--json", action="store_true")
    p = sp.add_parser("dpi", help="set a DPI stage"); p.add_argument("stage", type=int, help="1-8")
    p.add_argument("x", type=int); p.add_argument("-y", type=int); p.add_argument("--color", default="#ff0000")
    p.add_argument("--activate", action="store_true", help="switch to this stage")
    sp.add_parser("rate", help="polling rate").add_argument("hz", type=int, choices=sorted(RATES))
    sp.add_parser("lod", help="lift-off distance level (1=lowest)").add_argument("level", type=int)
    for name, h in [("motion-sync", "0/1"), ("angle-snap", "0/1"), ("ripple", "0/1")]:
        sp.add_parser(name, help=h).add_argument("value", type=int, choices=[0, 1])
    sp.add_parser("debounce", help="button debounce ms").add_argument("ms", type=int)
    sp.add_parser("sleep", help="sensor sleep time (as the app sends it)").add_argument("value", type=int)
    sp.add_parser("sensor-mode", help="performance mode").add_argument("mode", choices=list(SENSOR_MODES))
    p = sp.add_parser("light", help="LED effect"); p.add_argument("mode", choices=list(LIGHT_MODES))
    p.add_argument("--brightness", default="high", choices=list(LIGHT_BRIGHT))
    p.add_argument("--speed", default="medium", choices=list(LIGHT_SPEED))
    sp.add_parser("profile", help="onboard profile 1-4").add_argument("n", type=int)
    p = sp.add_parser("button", help="remap a button"); p.add_argument("button", choices=BUTTONS)
    p.add_argument("action", help=f"{', '.join(ACTIONS)}, key:ctrl+c, media:vol+, fire:3:50")
    sp.add_parser("pair", help="put dongle in pairing mode")
    sp.add_parser("unpair", help="clear the dongle's stored pairing")
    sp.add_parser("reset", help="factory reset the mouse")
    sp.add_parser("ui", help="open the simple browser UI").add_argument("--port", type=int, default=8737)
    sp.add_parser("app", help="open the original ATK HUB desktop client")
    sp.add_parser("selftest")
    a = ap.parse_args()

    if a.cmd == "selftest":
        return selftest()
    try:
        if a.cmd == "app":
            return app()
        if a.cmd == "ui":
            return serve(a.port)
        m = Mouse(a.device)
        if a.cmd not in ("pair", "unpair") and not m.online():
            raise ATKError("dongle found but mouse is not connected; turn it on / move it")
        if a.cmd in ("dpi",):
            m.info()  # learn sensor limits
        {
            "info": lambda: print(json.dumps(m.info(), indent=2) if a.json else fmt(m.info())),
            "dpi": lambda: m.set_dpi(a.stage - 1, a.x, a.y, a.color, a.activate),
            "rate": lambda: m.set_rate(a.hz),
            "lod": lambda: m.set_lod(a.level),
            "motion-sync": lambda: m.set_flag(13, a.value),
            "angle-snap": lambda: m.set_flag(11, a.value),
            "ripple": lambda: m.set_flag(12, a.value),
            "debounce": lambda: m.set_flag(22, a.ms),
            "sleep": lambda: m.set_sleep(a.value),
            "sensor-mode": lambda: m.set_sensor_mode(a.mode),
            "light": lambda: m.set_light(a.mode, a.brightness, a.speed),
            "profile": lambda: m.set_profile(a.n - 1),
            "button": lambda: m.set_button(a.button, a.action),
            "pair": lambda: print("pairing for 60s: hold LEFT + MIDDLE + RIGHT until the LED flashes...", flush=True)
                            or m.pair() or sys.exit("error: no mouse paired within 60s"),
            "unpair": lambda: m.tx(131, 3, 0, dongle=True),
            "reset": m.reset,
        }[a.cmd]()
        if a.cmd != "info":
            print("ok")
    except ATKError as e:
        sys.exit(f"error: {e}")


def fmt(i):
    lines = [f"{i['model']}  ({i['sensor']}, fw {i['firmware']}, dongle fw {i['dongle_firmware']})",
             f"battery {i['battery']}%{' (charging)' if i['charging'] else ''}   profile {i['profile'] + 1}",
             f"polling {i['polling_rate']} Hz   LOD {i['lod']}   debounce {i['debounce']} ms   sleep {i['sleep']}",
             f"motion-sync {i['motion_sync']}   angle-snap {i['angle_snap']}   ripple {i['ripple']}   "
             f"sensor-mode {i['sensor_mode']}",
             f"light {i['light']}",
             f"DPI stages (active {i['dpi_stage'] + 1}):"]
    for n, s in enumerate(i["dpi"]):
        if not s["x"]:
            continue
        mark = "*" if n == i["dpi_stage"] else " "
        lines.append(f"  {mark}{n + 1}: {s['x']}x{s['y']}  {s['color']}")
    lines.append("buttons: " + ", ".join(f"{k}={v}" for k, v in i["buttons"].items()))
    return "\n".join(lines)


if __name__ == "__main__":
    main()
