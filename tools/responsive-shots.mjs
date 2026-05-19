import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'tmp', 'responsive-shots');
const VIEWPORTS = [
  { name: '01-phone-360', width: 360, height: 800 },
  { name: '02-phone-430', width: 430, height: 932 },
  { name: '03-phone-landscape-844', width: 844, height: 390 },
  { name: '04-tablet-768', width: 768, height: 1024 },
  { name: '05-laptop-1024', width: 1024, height: 768 },
  { name: '06-desktop-1440', width: 1440, height: 900 },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        hasTouch: vp.width <= 1024,
        isMobile: vp.width <= 768,
      });
      const page = await ctx.newPage();
      await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.documentElement.classList.contains('app-booted'));
      // Esperamos a que el canvas haya renderizado al menos varios frames
      // para que los peces sean visibles en el screenshot.
      await page.waitForTimeout(3500);
      const out = resolve(OUT_DIR, `${vp.name}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`${vp.name} → done`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
