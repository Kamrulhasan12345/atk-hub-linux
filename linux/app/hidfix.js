// Match Chromium-on-Windows WebHID behaviour on Linux: Windows resizes every output report to the
// collection's declared size before writing; Linux hidraw sends the buffer as-is. ATK HUB sends its
// NearLink DFU control command (report 9, declared 12 bytes) as 63 bytes, which the dongle ignores on
// Linux, so the firmware update never applies. Trim oversized output reports to the declared size.
function outputSize(device, reportId) {
  for (const c of device.collections) {
    const r = c.outputReports.find((r) => r.reportId === reportId);
    if (r) return r.items.reduce((n, i) => n + i.reportSize * i.reportCount, 0) / 8;
  }
}

const send = HIDDevice.prototype.sendReport;
HIDDevice.prototype.sendReport = function (reportId, data) {
  const size = outputSize(this, reportId);
  if (size && data.byteLength > size) {
    const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
    data = bytes.slice(0, size); // ponytail: truncate only; padding short reports is not needed by ATK HUB
  }
  return send.call(this, reportId, data);
};
module.exports = { outputSize };
