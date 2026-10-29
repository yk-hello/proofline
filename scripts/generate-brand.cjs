// Renders the Proofline icon set and NSIS bitmaps: node scripts/generate-brand.cjs build
const { chromium } = require('playwright');
const fs = require('fs');
const { PNG } = require('pngjs');
const out = process.argv[2];
const icon = (size, radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" rx="${radius}" fill="#0A0A0A"/>
<rect x="232" y="318" width="560" height="68" fill="#FFFFFF"/>
<rect x="232" y="478" width="560" height="68" fill="#FFFFFF"/>
<rect x="232" y="638" width="340" height="68" fill="#FFFFFF"/>
<line x1="196" y1="830" x2="828" y2="198" stroke="#FF2D1A" stroke-width="118" stroke-linecap="butt"/>
</svg>`;
// Small sizes get a simpler mark so the lines stay crisp.
const small = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
<rect width="32" height="32" rx="${size <= 24 ? 4 : 6}" fill="#0A0A0A"/>
<rect x="7" y="9" width="18" height="3" fill="#FFF"/><rect x="7" y="15" width="18" height="3" fill="#FFF"/><rect x="7" y="21" width="10" height="3" fill="#FFF"/>
<line x1="5.5" y1="27" x2="26.5" y2="6" stroke="#FF2D1A" stroke-width="4"/></svg>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(html, w, h, file, transparent = true) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await page.waitForTimeout(150);
    const buf = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
    if (file) fs.writeFileSync(file, buf);
    return buf;
  }
  await render(icon(1024, 224), 1024, 1024, `${out}/icon.png`);
  await render(icon(512, 224), 512, 512, `${out}/icon-512.png`);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push(await render(size <= 32 ? small(size) : icon(size, 180), size, size));
  fs.writeFileSync(`${out}/redline.png`, pngs.at(-1));
  // ICO with embedded PNGs
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, index) => {
    const size = sizes[index], entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry); header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2); header.writeUInt8(0, entry + 3); header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += png.length;
  });
  fs.writeFileSync(`${out}/redline.ico`, Buffer.concat([header, ...pngs]));
  // NSIS bitmaps (24-bit BMP)
  const font = "font-family:'Inter Tight',Arial,sans-serif";
  const headerHtml = `<div style="width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;box-sizing:border-box;border-bottom:3px solid #0A0A0A">${small(30)}<span style="${font};font-weight:900;font-size:15px;letter-spacing:-0.5px;margin-left:7px;color:#0A0A0A">PROOFLINE</span></div>`;
  const sideHtml = `<div style="width:164px;height:314px;background:#0A0A0A;display:flex;flex-direction:column;justify-content:space-between;padding:22px 18px;box-sizing:border-box;color:#fff;${font}">
    <div>${icon(56, 0).replace('fill="#0A0A0A"', 'fill="#0A0A0A" stroke="#ffffff" stroke-width="40"')}</div>
    <div><div style="font-weight:900;font-size:22px;letter-spacing:-0.5px;line-height:1">PROOFLINE</div><div style="margin-top:8px;font-size:11px;color:#bdbdbd;line-height:1.5">Read. Mark. Revise.</div><div style="margin-top:14px;height:6px;background:#FF2D1A;width:56px"></div></div></div>`;
  for (const [html, w, h, name] of [[headerHtml, 150, 57, 'installer-header.bmp'], [sideHtml, 164, 314, 'installer-sidebar.bmp']]) {
    const png = PNG.sync.read(await render(html, w, h, null, false));
    const rowSize = Math.ceil(w * 3 / 4) * 4, size = 54 + rowSize * h, bmp = Buffer.alloc(size);
    bmp.write('BM', 0); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(w, 18); bmp.writeInt32LE(h, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(rowSize * h, 34);
    bmp.writeInt32LE(3780, 38); bmp.writeInt32LE(3780, 42);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4, dst = 54 + (h - 1 - y) * rowSize + x * 3;
      bmp[dst] = png.data[src + 2]; bmp[dst + 1] = png.data[src + 1]; bmp[dst + 2] = png.data[src];
    }
    fs.writeFileSync(`${out}/${name}`, bmp);
    fs.writeFileSync(`/tmp/brand/${name}.png`, PNG.sync.write(png));
  }
  await browser.close();
})();
