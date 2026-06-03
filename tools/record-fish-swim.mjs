// Graba un video de la animación del pez. Mucho más confiable que
// screenshots discretos porque page.screenshot() tarda ~2s cada una y
// se pierde el swim (que dura 1500ms).
//
// Output: tools/screenshots/swim-video/*.webm
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'swim-video');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg', { timeout: 10000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000); // settled at hero

console.log('Triggering scroll to cap-01...');
await page.evaluate(() => {
  const cap1 = document.querySelector('[appCompanionDock="cap-01"]');
  if (cap1) cap1.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Wait for scroll + debounce + swim + landing
await page.waitForTimeout(4000);

// Now scroll back to hero to test the reverse swim
console.log('Triggering scroll back to hero...');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(4000);

console.log('Done. Closing...');
await context.close();
await browser.close();

console.log('\nConsole errors:', errors.length === 0 ? '(none)' : errors);
console.log('Video saved in:', outDir);
