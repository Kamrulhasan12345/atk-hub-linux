// Diagnostic only (ATKHUB_HIDLOG=1): log WebHID traffic with ATK devices to the console
// (lands in stdout with ELECTRON_ENABLE_LOGGING=1). Observes; never changes what is sent.
const ATK = 0x373b;
const t0 = performance.now();
const ts = () => ((performance.now() - t0) / 1000).toFixed(3).padStart(8);
const hex = (buf, n = 16) => Array.from(new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, Math.min(n, buf.byteLength)))
  .map((b) => b.toString(16).padStart(2, "0")).join(" ");
const tag = (d) => `${d.productId.toString(16)}[${d.collections.map((c) => c.usagePage.toString(16)).join(",")}]`;
const log = (...a) => console.log("[hidlog]", ts(), ...a);

const send = HIDDevice.prototype.sendReport;
HIDDevice.prototype.sendReport = async function (id, data) {
  if (this.vendorId !== ATK) return send.call(this, id, data);
  try {
    await send.call(this, id, data);
    log("TX", tag(this), "id", id, "len", data.byteLength, hex(data));
  } catch (e) {
    log("TX-ERR", tag(this), "id", id, hex(data), String(e));
    throw e;
  }
};

const desc = Object.getOwnPropertyDescriptor(HIDDevice.prototype, "oninputreport");
Object.defineProperty(HIDDevice.prototype, "oninputreport", {
  configurable: true,
  get() { return desc.get.call(this); },
  set(fn) {
    if (this.vendorId !== ATK || typeof fn !== "function") return desc.set.call(this, fn);
    const dev = this;
    desc.set.call(this, function (ev) {
      log("RX", tag(dev), "id", ev.reportId, "len", ev.data.byteLength, hex(ev.data));
      return fn.call(this, ev);
    });
  },
});

for (const m of ["open", "close"]) {
  const orig = HIDDevice.prototype[m];
  HIDDevice.prototype[m] = async function () {
    try { const r = await orig.call(this); if (this.vendorId === ATK) log(m.toUpperCase(), tag(this)); return r; }
    catch (e) { if (this.vendorId === ATK) log(m.toUpperCase() + "-ERR", tag(this), String(e)); throw e; }
  };
}
navigator.hid.addEventListener("connect", (e) => e.device.vendorId === ATK && log("USB-CONNECT", tag(e.device)));
navigator.hid.addEventListener("disconnect", (e) => e.device.vendorId === ATK && log("USB-DISCONNECT", tag(e.device)));
log("hid logger active");
