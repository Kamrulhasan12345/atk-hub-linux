# ATK HUB for Linux

A stdlib-only Python replacement for the Windows ATK HUB 3.2.28 mouse config, built from the
reverse-engineered "bitMouse" HID protocol. Covers ATK / VXE NK mice (incl. VXE Dragonfly R1 S)
and the 67 models in `models.py`.

## Use
```
./atkhub.py info                 # model, battery, DPI, buttons, everything
./atkhub.py app                  # the original ATK HUB UI in a Chromium window (WebHID)
./atkhub.py ui                   # minimal fallback UI at http://127.0.0.1:8737
./atkhub.py dpi 2 1600 --color '#00ff00' --activate
./atkhub.py rate 1000
./atkhub.py lod 1
./atkhub.py debounce 4
./atkhub.py motion-sync 1
./atkhub.py sensor-mode athletics
./atkhub.py button bottom dpi-cycle
./atkhub.py button forward key:ctrl+c
./atkhub.py pair                 # re-pair dongle (mouse switch on 2.4G, hold L+M+R until LED blinks)
./atkhub.py unpair               # clear the dongle's stored pairing
```

Settings only work via the dongle or USB cable. Bluetooth mode has no config interface.

## Permissions
If `/dev/hidraw*` isn't writable:
```
sudo cp 99-atk-hub.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger
```

## How `app` works
`app/resources/` is ATK HUB 3.2.28's own `resources/` folder, untouched (both `app.asar`s).
It's not in git: copy it from an ATK HUB 3.2.28 install, then run `npm install` in `app/native/`.
`app/main.js` runs its original main process in system Electron. `app/shim.js` handles the
Windows-only native addons:
- `node-hid`, `usb`, `koffi`, `@napi-rs/canvas`, `loudness`: real Linux builds, same versions (`app/native/`)
- `system-activate-windows` (game auto profile switch): reimplemented in `app/activity.js` via a KWin
  script (KDE Plasma 6 only). In the app, pick the game binary, or its `.exe` for Proton/Wine.
  Test: `node app/test_activity.js`
- `atk-mouse-system-api` (pointer / scroll speed): reimplemented in `app/mousesettings.js` for KDE
  (KWin input device + kcminputrc, ATK mouse only). Test: `node app/test_mousesettings.js`
- the rest (wallpaper engine, desktop pet, audio visualizer, key-linker): inert stand-ins

Linux replacements for Windows-only behaviour (all desktops unless noted):
- `app/notify.js`: notifications go to the desktop's notification service (their corner window
  can't be positioned on Wayland)
- `app/lockkeys.js`: Caps/Num/Scroll Lock overlay from keyboard LED state; enable it in settings.
  Test: `node app/test_lockkeys.js`
- `app/mouseactivity.js`: ATK mouse movement (hidraw) feeds the game-switch retry
- `app/globalshortcut.js`: global hotkey via the GlobalShortcuts portal. Needs an installed
  `com.atkgear.AtkHub.desktop` (portal app ID), so it activates with the desktop entry. Test:
  `node app/test_globalshortcut.js`

`app/hidfix.js` trims WebHID output reports to their declared size, as Chromium does on Windows;
without it the NearLink dongle ignores firmware-update control commands.
`ATKHUB_HIDLOG=1` logs all ATK HID traffic (`app/hidlog.js`).
Tray (`app/tray.js`, KDE StatusNotifierItem): left click shows/hides the window, right click opens a
native menu with your devices (battery, sleeping; click opens the device page), Open, Settings, Quit.
Closing the window hides it to the tray when "close to tray" is on in the app settings.

## Not ported
Wallpapers, desktop pet, wooden fish, music-rhythm lighting, floating selection toolbar,
key-linker, PC scripts, plugin market. The CLI has no macro editor (use `app`).
