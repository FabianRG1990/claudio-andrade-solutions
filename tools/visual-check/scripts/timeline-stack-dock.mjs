import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

async function captureDock(dockId, filename) {
  const dock = page.locator(`[appCompanionDock="${dockId}"]`).first();
  const exists = (await dock.count()) > 0;
  if (!exists) {
    console.log(`SKIP: ${dockId} not found`);
    return;
  }
  await dock.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  // Wait for companion swim+dock to settle. Swim is around 1.2-1.6s typically.
  await page.waitForTimeout(2200);
  const box = await dock.boundingBox();
  if (!box) {
    console.log(`No bounding box for ${dockId}`);
    return;
  }
  // Capture wider area to include the docked companion on the right
  const pad = 200;
  const clip = {
    x: Math.max(0, box.x - 40),
    y: Math.max(0, box.y - 60),
    width: Math.min(1440 - Math.max(0, box.x - 40), box.width + pad),
    height: 160,
  };
  await page.screenshot({ path: join(OUT, filename), clip });
  console.log(`Wrote ${filename}`);
}

// Capture trayectoria first (reference alignment), then stack (the new dock)
await captureDock('timeline-head', 'dock-trayectoria.png');
await captureDock('timeline-stack', 'dock-stack.png');

await browser.close();
