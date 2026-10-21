// ATK HUB shows notifications in its own frameless window placed at a screen corner. Wayland
// ignores app-set window positions, so on Linux route them to native desktop notifications
// (freedesktop, any desktop) instead.
const path = require("path");

module.exports = function installNotify(electron, getMainExports, resourcesDir) {
  const { ipcMain, Notification, nativeImage } = electron;
  const appIcon = () => nativeImage.createFromPath(path.join(resourcesDir, "app.asar", "dist", "icons", "128x128.png"));

  function show({ page, payload = {} } = {}) {
    if (!Notification.isSupported()) return;
    let title = payload.title || "ATK HUB";
    let body = payload.message || "";
    if (page === "Electric") { // low battery: {message, deviceName, percent}
      title = payload.deviceName || title;
      if (Number.isFinite(payload.percent)) body = `${body} (${Math.round(payload.percent)}%)`;
    }
    const icon = typeof payload.icon === "string" && payload.icon.startsWith("data:")
      ? nativeImage.createFromDataURL(payload.icon)
      : appIcon();
    const n = new Notification({ title, body, icon, silent: false });
    n.on("click", () => {
      const w = (getMainExports() || {}).browserWindow;
      if (w && !w.isDestroyed()) { w.show(); w.focus(); }
    });
    n.show();
  }

  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, channel === "notification:show" ? (e, req) => show(req) : fn);
  return { show };
};
