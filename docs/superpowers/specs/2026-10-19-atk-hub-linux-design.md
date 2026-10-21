# ATK HUB for Linux: PRD and technical design

Status: draft v2 for review · Date: 2026-10-19 · Owner: raidingshaman

Decisions are marked **[user]** when the user made them, **[call]** when the author made them
(open to change), and **[builder]** when left to whoever builds this.

Source of truth for ATK HUB's behaviour: ATK HUB 3.2.28 (Windows installer `atk-hub-3.2.28.exe`,
NSIS → `app-64.7z` → `resources/app.asar` (main process) and `resources/main/app.asar` (UI)),
plus everything verified on the user's hardware with the Linux prototype.

---

## 1. Why this exists

ATK / VXE / MADLIONS gaming mice are configured with ATK HUB, a Windows-only Electron app. A
working Linux prototype exists (`~/Downloads/atk-hub/linux/`), but it is the wrong shape to grow:

- `atkhub.py`: a single-file CLI covering part of one protocol.
- `app/`: ATK's **compiled, unmodified** Windows app running in system Electron behind shims
  (native-module stand-ins, report-size fix, KDE tray, KWin game monitor, notifications, lock
  keys, pointer speed, portal hotkey). Every Linux behaviour is a patch around code we don't own,
  nothing can be shared with a terminal UI, and ATK's update server has no Linux channel.

The user wants **one proper codebase**: a shared core driving **both an Electron GUI and a TUI**
**[user]**. The TUI is the user's daily preference; the GUI is built first because it replaces the
prototype **[user]**. Linux support is maintained by us **[user]**.

**Success:** every ATK mouse ATK HUB supports can be configured on Linux from the TUI or the GUI;
the user never needs the Windows app or the prototype; both front-ends always agree because they
run the same code.

## 2. Users and scope

Primary user: the owner (Arch Linux, KDE Plasma 6, Wayland) with a **VXE Dragonfly R1 S NK**
(BITMOUSE family, NearLink "NK mouse NANO dongle", USB `373b:1216`). Secondary: other Linux
owners of ATK-family mice (see §10, publishing question).

### Goals
1. **All mouse families ATK HUB supports**, each as a separate plug-in **[user]** (§4.2).
2. Every mouse feature ATK HUB offers, per family and model, from both GUI and TUI (§5.1).
3. App-level features that matter offline: settings, local configurations, macros, game auto
   switch, low-battery alerts, lock-key hints, profile OSD (§5.3).
4. Desktop integration that works with no window open (§5.4).
5. Safe firmware updates and recovery using ATK's published firmware (§5.2).
6. Any Linux desktop where possible; desktop-specific pieces isolated **[user: KDE first]**.
7. Installable and updatable like a normal Linux app (§5.6).

### Non-goals (v1)
- Windows, macOS.
- Keyboards, headsets, microphones, controllers/key-linker, gamepad emulation, monitors
  **[call]**; the plug-in system must not prevent adding them later.
- ATK account and everything behind it: cloud configurations, account login, bug-report upload,
  driver rating, message center, Explore/discovery feed, AI chat, AI macro generation **[call]**.
- Wallpaper engine, desktop pet, wooden fish, music animation/score tool, music rhythm lighting,
  floating selection toolbar, plugin market, PC scripts, ATK Assistant launcher, ATK Lab, demo mode.
- HUB theming beyond light/dark (theme colours, fonts, icon libraries, background images).
- Configuring over Bluetooth (no vendor channel on BT; verified).

### Anti-goals
- **Bricking a device**: no unattended, unverified, or guessed-model firmware writes.
- Two processes talking to one device at once (replies get mismatched, §6.1).
- Needing root at runtime.
- The user losing a working setup: prototype stays usable until parity.
- Presenting an unverified family as if it were tested (§4.2 support tiers).
- KDE assumptions in the core.

## 3. Decisions so far

| Topic | Decision |
|---|---|
| Codebase | Proper Electron codebase, shared core for GUI and TUI **[user]** |
| Order | GUI first, TUI after **[user]** |
| Devices | All mouse families, one plug-in per family **[user]** |
| Desktops | KDE Plasma 6 first, universal features first, others later **[user]** |
| In the new codebase (not the prototype) | desktop entry, autostart, global hotkey, app updates **[user]** |
| Linux support ownership | ours, not ATK's update channel **[user]** |
| Working style | work sorted up front, one track finished before the next **[user]** |

## 4. Architecture

```
┌──────────────┐   ┌──────────────┐
│ Electron GUI │   │     TUI      │   front-ends: no device access of their own
└──────┬───────┘   └──────┬───────┘
       │ JSON-RPC over Unix socket ($XDG_RUNTIME_DIR/atkhub.sock)
┌──────┴──────────────────┴────────────────────────────────┐
│ atkhubd (systemd --user service; sole owner of devices)  │
│  core: device registry · plug-in host · settings model · │
│        macros · configurations · firmware · model DB     │
│  plug-ins: bitmouse | compx | evision | holtek | hechi | │
│            waizowl                                       │
│  desktop adapters: tray · notify · foreground app ·      │
│            pointer speed · hotkey · lock keys · autostart│
└───────────────┬──────────────────────────────────────────┘
                │ hidraw (node-hid): output / input / feature reports
         dongles · wired mice · boot-mode devices
```

**Why a daemon [call]:** replies are matched per device, so only one process may own a device;
tray, notifications, game switching and lock keys must work with no window open. GUI and TUI
become thin clients and can run together.
**Tray in the daemon [call]:** a StatusNotifierItem over D-Bus (`dbus-next`) needs no Electron.

### 4.1 Packages (one repo, workspaces) [call]
| Package | Contents |
|---|---|
| `core` | plug-in contract, device registry, capability-based settings model, macro model, configuration store, firmware engine, model DB. Pure TypeScript, no desktop code |
| `plugin-<family>` | one per mouse family (§4.2) |
| `daemon` | discovery + hotplug, per-device request queue, event bus, JSON-RPC, desktop adapters, tray |
| `client` | typed RPC client + events for GUI and TUI |
| `gui` | Electron app |
| `tui` | terminal app |
| `adapters-kde` | KWin foreground app, KWin input settings (`adapters-gnome` later) |
| `sim` | simulated devices per family, for development and tests without hardware |

Stack **[call]**: TypeScript, Node ≥ 22, pnpm workspaces, `node-hid` (hidraw backend, prebuilt
N-API), `dbus-next`, Electron latest stable. GUI framework and TUI library are **[builder]**;
author's default: React + Vite (GUI), Ink (TUI).

### 4.2 Mouse family plug-ins **[user: all families, plug-in per family]**

ATK HUB 3.2.28 registers mouse controllers under six "solution providers". Each is a different
protocol; all are readable JavaScript in the UI bundle (`demoMode.store-*.js`, `filter-*.js`) and
are ported from there.

| Family | ATK HUB entries (approx., incl. dongles) | Examples | Notes |
|---|---|---|---|
| **BITMOUSE** | ~90 | VXE R1 S NK, ATK A9 SE NK, VXE V3 NK | user's family; protocol + NearLink DFU verified on hardware |
| **COMPX** | ~200 (overlaps to be deduplicated) | VXE R1S+, ATK F1 Ultimate 2.0 | largest; has its own upgrade flows (single/dual chip) |
| **EVISION** | ~60 | ATK X1/A9/F1 NearLink, 8K dongles | NearLink variants; separate 54H20/NRF54 upgrade classes |
| **HOLTEK** | ~8 | ATK X1, U2 Pro, A9 Pro, Y9 Pro | older models |
| **HECHI** | ~6 | ATK A9 PRO MAX, 1K/8K dongles | |
| **WAIZOWL** | ~3 | ATK Duckbill ELITE | |

The exact device lists are extracted mechanically from the bundle (§6.3).

**Plug-in contract (shape) [builder finalises]:**
- `match(hidDeviceInfo)` → model, connection type (wired / 2.4G / NearLink dongle / boot mode)
- `open(transport)` → session; transport offers output/input/feature reports at declared sizes
- `capabilities(model)` → which §5.1 features exist, ranges, options (drives UI on both fronts)
- `read()` / `write(patch)` on the shared settings model; `events` (DPI/profile changed, battery,
  online/sleep)
- optional: `pairing`, `macros`, `onboardProfiles`, `firmware` (`check`, `prepare`, `run` with
  progress), `factoryReset`, `recovery` (boot-mode devices)

**Support tiers [call]:**
- **Verified:** tested on real hardware with the release checklist (§7). Everything enabled.
- **Experimental:** ported from ATK's code, tested only against the simulator. Settings
  read/write enabled with a visible "experimental" label; **firmware and recovery disabled**.
- A family moves to Verified when someone with that hardware passes the checklist (§10, Q4).
- v1 ships BITMOUSE as Verified and the other five as Experimental.

## 5. Features

Each feature is **v1**, **later**, or **out** (with reason). Inventory method: all 21 UI routes,
the ~148 main-process IPC channels, and all 4,036 English UI strings of ATK HUB 3.2.28.

### 5.1 Mouse features (core + family plug-ins), all v1 where the model supports them
- **Identity & status:** model detection (incl. cid/mid model ids), connection type, battery %,
  charging, charge time remaining, battery-life estimate for current settings (Daily Work /
  Competitive), online/sleep state, firmware version (mouse, receiver).
- **DPI:** up to 8 levels, add/remove levels, X/Y independent (where supported), per-level colour,
  active level, DPI range per sensor, DPI quick toggle (hold Forward+Back 3 s), DPI indicator light.
- **Performance:** polling rate (125–8000 Hz as allowed), sensor sampling rate, performance mode /
  sensor mode (Basic / Competitive / Competitive MAX "Shard firmware"), extreme mode, LOD height,
  key debounce (warn below 4 ms), sleep time (incl. LED-off time), motion sync, straight-line
  correction (angle snap), ripple correction (incl. auto ≥ 9000 DPI), ultra long range mode, button
  SPDT mode, scroll anti-mistouch (BHOP).
- **Sensor:** sensor rotation (manual angle + **auto-calibration**: slide sideways in a box, angle
  computed live), virtual center offset, dynamic DPI curve (Classic / Natural / Jump / Custom with
  5 points, zoom, live input-speed preview).
- **Buttons:** remap each button to mouse buttons, keyboard key + modifiers (combo keys), media /
  system / office keys, DPI ± / cycle / specific, scroll up/down/left/right, profile 1–4 / cycle,
  fire key (clicks, interval, key), macro, polling-rate switch, disable; restore one / all defaults.
- **Macros:** create/rename/delete, record (keys, mouse buttons, delays, scroll), insert/edit
  actions, execution modes (once / N times / loop until release / until same key / until any key /
  stop rules), assign to a button, import/export files, copy between slots.
- **Onboard profiles & configurations:** 4 onboard profiles, switch, rename (≤ 16 chars), copy
  onboard → computer configuration, computer configurations (create, apply, delete, rename;
  "temporarily occupies last onboard slot" behaviour), import/export as files. (ATK's **share
  codes** are created and resolved on their cloud server, `/cloud/config/create-share-code`, so
  they are out with the other account features.)
- **Lighting:** mouse light effects (mode, colour, brightness, speed), DPI light effects, click
  light, light off while moving, LED off timer, decoration / surround / logo / side lights,
  receiver (dongle) light effects (colour flow, breathing, polling-rate colour, battery gradient,
  low-battery blink, silent light duration).
- **Dot-matrix screen editor** for models that have one (pen, eraser, fill, colours, cache) **[later]**
  (EVISION-only; no hardware to verify).
- **Pairing:** pair / unpair receiver, guided flow (cable, receiver selection, L+M+R), mouse model
  correction when identification is wrong.
- **Reset:** factory reset (all), factory reset (keys only).
- **Device cosmetics:** product images per skin/colour **[later, depends on §10 Q2]**.

### 5.2 Firmware & recovery
- Online firmware check per device (`api-hub-cloud.atk.pro/firmware/{vid}/{pid}/{tag}`) and
  manual file flash ("firmware tool"); mouse and receiver; single and dual-chip flows per family.
- **Boot recovery:** detect devices stuck in boot mode after an interrupted update, match the
  model, re-flash ("one-click recovery").
- Safety rules (all required): header VID/PID must match the device; battery ≥ threshold
  **[builder: ≥ 30% suggested]**; explicit confirmation with version from → to; no other traffic to
  that device during flashing; verify the version after reboot; clear "do not unplug" UI; never
  automatic; Experimental families: disabled (§4.2).

### 5.3 App features
| Feature | Scope |
|---|---|
| Open at login, start minimized to tray, close-window behaviour (hide to tray / exit) | v1 |
| Low-battery alert with threshold % | v1 |
| Game auto profile switch (link app → onboard profile, notifications on/off, paused while editing) | v1 (KDE first) |
| Lock-key hints (Caps / Num / Scroll, each toggle) | v1 |
| Profile-switch OSD ("config scheme OSD") | v1 |
| Global hotkey to show/hide (record, reset default) | v1 (portal) |
| Light/dark theme | v1 |
| Mouse/key tester (button test page) | v1 for mouse buttons; keyboard tester out |
| Language: English first; other ATK languages via their string tables | later |
| Copy to clipboard, help links, product manual links | v1 (links open browser) |
| Cloud configs, account login, bug-report upload, driver rating, message center, Explore, AI chat, AI macro generation | out (needs ATK account / servers) |
| HUB theme colours, fonts, icon libraries, background images, background animation | out |
| Wallpapers, desktop pet, wooden fish, music tools, plugin market, PC scripts, ATK Lab, assistant launcher, demo mode | out |

### 5.4 Desktop integration (daemon + adapters)
| Feature | Universal? | v1 implementation |
|---|---|---|
| Tray: devices + battery/charging/sleep, open, settings, quit | yes (GNOME needs AppIndicator ext.) | daemon SNI |
| Notifications: low battery, profile switched, firmware done | yes | freedesktop Notifications |
| Lock-key hints | yes | LED state from `/sys/class/leds`; overlay form **[builder]**, no window positioning |
| Game auto switch | no | KDE: KWin script → focused PID; Wine/Proton path mapping; retry on mouse activity (hidraw) |
| Pointer / scroll speed | no | KDE: KWin InputDevice + `kcminputrc`, only ATK pointers that support acceleration |
| Global hotkey | KDE, GNOME 48+ | GlobalShortcuts portal (needs app id → desktop entry) |
| Autostart | yes | systemd user unit (daemon) + start-minimized flag |
| Desktop entry + icon | yes | app id `com.atkgear.AtkHub` **[call]** |

### 5.5 Front-ends
- **GUI:** home (devices, battery, firmware, connection) and per-device pages for every §5.1
  group; configurations; macros; firmware; pairing; integrations; settings. Visual design: §10 Q1.
- **TUI:** same capabilities, keyboard-only, works over SSH, usable at 80×24. Interactive flows
  that need the pointer (sensor auto-calibration, dynamic-curve live preview) use the daemon's
  view of mouse movement instead of a window.
- Both: changes apply immediately with visible confirmation; a sleeping mouse is shown as such
  ("move the mouse to wake it"), never a silent failure; Experimental families clearly labelled.

### 5.6 App updates and packaging
- Our releases, not ATK's channel **[user]**. AUR `PKGBUILD` first, AppImage second **[call]**.
- Model DB refresh script re-extracts device lists, sensors and flags from a newer ATK HUB
  installer, so new models land without rewriting plug-ins (when the family protocol is unchanged).

## 6. Protocol knowledge to carry over (verified on hardware)

### 6.1 BITMOUSE transport
- Vendor usage page `0xFF05`, report ID `8`, 63-byte output and input.
- Request: `[0]=checksum (sum of bytes 1..62 & 0xFF) [1]=0x72 [2]=paramLen [3]=sn [4]=target
  [5]=commandId [6]=cmdLen [7..]=data`; `target` 1 = mouse via dongle, 0 = dongle / wired.
- Reply (hidraw incl. report id): `[0]=8 [1]=0x72 [2]=status (255 = error) [3]=sn [4]=target
  [5]=commandId [6]=len [7..]=data`; matched by commandId → **one owner per device**.
- Unsolicited reports, cmdCode `0x73`: type 1 DPI changed, type 2 profile changed.
- Commands: report rate 1, DPI 2, LOD 3, button 5, macro 6, battery 7, current config 9,
  set profile 10, angle snap 11, ripple 12, motion sync 13, charging 15, reset 19, LED 20,
  sleep 21, debounce 22, read mem 23, device type 26, far distance 27, firmware 28,
  sensor mode 31, sensor angle 33, BHOP 34, mouse online 35, chip id 71, cid/mid 74;
  dongle: connect 129, pair start 130, clear pairing 131, pair status 132, dongle LED 133/134,
  dongle version 136, dongle cid/mid 137; virtual center 170, dynamic sensitivity 171/172,
  power ex 173, charge time 174, DPI toggle 175, feature support 177.
- Memory map (cmd 23, ≤ 10 bytes per read): DPI block 1..66 (index, count, 8 × {x u16, y u16,
  b, g, r, x}), sensor mode 74, far distance 75, LED 76..78, buttons 82..111 (6 × 5 bytes),
  sensor angle 2692..2693.
- Quirks: cmd 35 reads 0 even when linked (fw 1.0.12) → use cmd 129 for "online"; cmd 132 reads 1
  while merely in pairing mode; a sleeping mouse doesn't answer; after dongle fw 1.0.19 the USB
  manufacturer string changed `ATK` → `MADLIONS` (match by VID/PID, never by name).

### 6.2 NearLink firmware update (verified)
- File: 1024-byte header (`FWATKPAK`, product name, PID u32 @72, VID u32 @76) + image.
- Control: interface `0xFFB1`, output report 9, **declared 12 bytes**. Enter boot
  `ef be ad de 0c 00 1e e1 00 00 00 00`; exit/apply `… ff ff 00 00`.
- Data: interface `0xFFB3`, unnumbered, out 64 / in 12. Header `ef be ad de 18 00 d2 2d 00 00 00
  00 size(u32) size(u32) 00 00 00 00` (echo after ~2.7 s erase), then 64-byte chunks (pad 0xFF),
  each echoed (first 12 bytes compared).
- **Send every report at exactly its declared size.** ATK sends report 9 as 63 bytes; Windows
  truncates silently, Linux hidraw doesn't, and the dongle ignores the oversized command. This
  was the root cause of the failed Linux updates. Applies to every family's transport.
- After apply the dongle reboots and re-enumerates; a brief `1111:ff04` boot-ROM device is normal.

### 6.3 Model database
- Extracted mechanically from the UI bundle: every `controller:…, meta:{deviceType, solutionProvider}`
  registration with its `filters` (VID, PID, usage page/usage, receiver flag, boot VID/PID, `custom`
  flags such as `isNearlink`, `noXyDpi`, `noSensorAngle`, `mouseCidMid`, `sensor`, `firmwareMark`).
- Sensors and DPI ranges from `mouse-skins-*.js` (e.g. PAW3311 200–15000 step 100,
  PAW3955MASTER 1–50000, CORE26K with step segments).
- BITMOUSE cid/mid table: 67 models (prototype `models.py`); `2,9` = VXE R1 S NK.
- Counts in §4.2 are approximate (some lists overlap in the bundle); the builder deduplicates by
  VID/PID/usage.

### 6.4 Desktop facts learned
- Electron's Linux tray emits only `click`; right-click needs a native context menu.
- Wayland ignores app-set window positions (ATK's notification and OSD windows misplace).
- Electron 39 `globalShortcut` reports success on Wayland but never fires and never uses the
  portal; the GlobalShortcuts portal needs an app id backed by an installed `.desktop` file.
- KWin lists the dongle twice as a pointer; only devices with `supportsPointerAcceleration` take
  speed settings.
- Reading hidraw with Node `fs` streams blocks process exit; use node-hid or a child process.

## 7. Quality bar
- `core` and each plug-in: unit tests for packet encode/decode, checksums, every command builder,
  memory-map parsing, model matching, firmware header parsing, DFU state machine against `sim`.
- Fixtures: BITMOUSE traffic recorded with the prototype's HID logger (`ATKHUB_HIDLOG=1`); for
  Experimental families, expected packets derived from ATK's own controller code.
- Daemon, GUI and TUI developed and tested against `sim` without hardware.
- Release hardware checklist (per Verified family, on real hardware): read all, write+restore each
  setting, buttons, macros, profiles, pair/unpair, sleep/wake, hotplug, tray, notifications, game
  switch, firmware check (no flash).
- Firmware flashing is **never** run by automated tests or by an agent without the user's go-ahead.

## 8. Milestones (sorted; finish each before the next) [call]
1. **M0 Repo:** workspaces, lint/test/build, plug-in contract, `sim` skeleton.
2. **M1 Model DB:** extraction script + generated DB for all six families.
3. **M2 BITMOUSE plug-in:** full §5.1 read/write, pairing, reset, events; CLI smoke tool.
4. **M3 Daemon + client:** single owner per device, JSON-RPC, hotplug, sleep handling.
5. **M4 GUI parity** for BITMOUSE (all §5.1 + configurations + macros).
6. **M5 Desktop integration + app features:** tray, notifications, lock keys, profile OSD, game
   switch (KDE), pointer speed (KDE), desktop entry, autostart, hotkey, low-battery alerts.
7. **M6 Firmware + recovery** for BITMOUSE (NearLink verified flow first).
8. **M7 Other families** as Experimental plug-ins, one at a time: COMPX, EVISION, HOLTEK, HECHI,
   WAIZOWL **[call: order by model count]**.
9. **M8 TUI** with the same capabilities.
10. **M9 Packaging + our update channel**, model-DB refresh in the release process.
11. **M10 Other desktops** (GNOME adapters); **later** items (§5) by demand.

Transition rules **[call]**:
- The prototype (`atkhub.py`, `app/`) and `atkhubd` never run together; the daemon refuses to
  start while the prototype app is running, and says why.
- The TUI replaces `atkhub.py`; the prototype gets no new features.
- The prototype is retired once M5 is accepted.

## 9. Left to the builder
Repo name/location; RPC method names and schema; GUI and TUI libraries (defaults §4.1); exact
plug-in interface; logging; config format and location (XDG); battery threshold for flashing;
lock-key overlay form; dedup rules for the model DB; how Experimental labels look.

## 10. Open questions for the user
1. **GUI look:** rebuild ATK HUB's layout and style, or our own design?
2. **Who it's for:** only the user's machine, or published? (Publishing rules out shipping ATK's
   product images, skins, icons and fonts, and affects naming and packaging.)
3. **Account features:** confirm cloud configs, login, message center, bug upload and AI features
   stay out.
4. **Experimental families:** acceptable to ship five families unverified (settings only,
   firmware disabled), or hold them until hardware is available?
