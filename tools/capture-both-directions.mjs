// Captura frames del swim en ambas direcciones para inspección visual.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'both-dir');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(3000);

async function captureSwim(direction, startY, endY, label) {
  // Position at start
  await page.evaluate((y) => window.scrollTo(0, y), startY);
  await page.waitForTimeout(2500); // settle

  // Gradual scroll
  const steps = 12;
  const stepDy = (endY - startY) / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((dy) => window.scrollBy(0, dy), stepDy);
    await page.waitForTimeout(80);
  }

  // Now wait for the swim to start, then capture 6 frames
  const startWait = Date.now();
  let started = false;
  while (Date.now() - startWait < 1500) {
    const swimming = await page.evaluate(() =>
      document.querySelector('.companion__pivot')?.classList.contains('is-swimming') || false
    );
    if (swimming) { started = true; break; }
    await page.waitForTimeout(30);
  }
  if (!started) {
    console.log(`[${label}] swim did not trigger`);
    return;
  }
  console.log(`[${label}] swim started — capturing 8 frames`);
  for (let i = 0; i < 8; i++) {
    await page.screenshot({
      path: resolve(outDir, `${label}-${String(i).padStart(2, '0')}.jpg`),
      type: 'jpeg', quality: 85,
    });
    await page.waitForTimeout(180);
  }
  // Settle
  await page.waitForTimeout(2000);
}

const cap2 = 3050;
const cap3 = 3965;

console.log('=== Scroll DOWN ===');
await captureSwim('down', cap2 - 400, cap3 - 400, 'down');

console.log('\n=== Scroll UP ===');
await captureSwim('up', cap3 - 400, cap2 - 400, 'up');

await browser.close();
