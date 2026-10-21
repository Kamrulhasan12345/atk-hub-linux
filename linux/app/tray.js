// KDE/Linux tray for ATK HUB. Electron's Linux tray is a StatusNotifierItem: it only emits "click",
// never the "right-click"/"double-click"/"mouse-enter" ATK HUB relies on, and Wayland can't place
// ATK HUB's custom popup-menu window at the cursor. So: left click toggles the main window, right
// click opens a native menu built from the device list the UI already pushes to the tray tooltip.
const path = require("path");

module.exports = function makeTray(electron, getMainExports, resourcesDir) {
  const { Menu, nativeImage, ipcMain } = electron;
  let devices = [];
  let tray = null;

  const perform = (action, data) => ipcMain.emit("tray-menu:perform", null, { action, data });
  const mainWindow = () => {
    const w = (getMainExports() || {}).browserWindow;
    return w && !w.isDestroyed() ? w : null;
  };
  function showMain() {
    const w = mainWindow();
    if (!w) return perform("show-main"); // their code recreates the window
    w.show();
    w.focus();
  }
  // Clicking the tray moves focus to the panel before "click" arrives, so "was focused until
  // just now" counts as focused: click hides a window you were using, raises one that was behind.
  let lastBlur = 0;
  electron.app.on("browser-window-blur", (_, w) => { if (w === mainWindow()) lastBlur = Date.now(); });
  function toggleMain() {
    const w = mainWindow();
    const wasFocused = w && (w.isFocused() || Date.now() - lastBlur < 500);
    if (process.env.ATKHUB_TRAYLOG) console.log("[tray] click", { visible: w && w.isVisible(), focused: w && w.isFocused(), wasFocused });
    if (w && w.isVisible() && wasFocused) w.hide();
    else showMain();
  }

  function deviceLabel(d) {
    const state = d.sleep ? "Sleeping" : d.isCharging ? "Charging" : "";
    const battery = Number.isFinite(d.batteryLevel) && d.batteryLevel > 0 ? `${Math.round(d.batteryLevel)}%` : "";
    return [String(d.label || "Device").replace(/[\r\n]+/g, " "), battery, state].filter(Boolean).join(" · ");
  }

  function rebuildMenu() {
    if (!tray || tray.isDestroyed()) return;
    const items = devices.map((d) => ({
      label: deviceLabel(d),
      click: () => { showMain(); perform("open-device", d.value); },
    }));
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: "Open ATK HUB", click: showMain },
      { label: "Settings", click: () => perform("open-setting") },
      { type: "separator" },
      { label: "Quit ATK HUB", click: () => perform("exit-app") },
    );
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  // The UI calls ipcMain "tray-tooltip:update" with the device list on every device change; tap it.
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, channel !== "tray-tooltip:update" ? fn : (e, list) => {
    devices = Array.isArray(list) ? list : [];
    rebuildMenu();
    return fn(e, list);
  });

  // A function, not a subclass: Electron's native Tray ignores subclass prototypes, so overrides
  // are put on the instance itself.
  function Tray(image, ...rest) {
    const icon = nativeImage.createFromPath(path.join(resourcesDir, "app.asar", "dist", "icons", "64x64.png"));
    const t = new electron.Tray(icon.isEmpty() ? image : icon, ...rest);
    tray = t;
    const on = t.on.bind(t);
    const setToolTip = t.setToolTip.bind(t);
    // handled natively here; ATK HUB's versions open a cursor-positioned popup window
    t.on = (event, fn) => (["right-click", "double-click", "mouse-enter"].includes(event) ? t : on(event, fn));
    t.setToolTip = (text) => setToolTip(String(text).replace(/休眠/g, "Sleeping").replace(/在线/g, "Online"));
    on("click", toggleMain);
    rebuildMenu();
    return t;
  }
  return Tray;
};
