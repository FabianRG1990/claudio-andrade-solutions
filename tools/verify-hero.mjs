// Captura screenshot del nuevo Hero estático para revisión visual.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'hero-frames');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 820 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push({ type: msg.type(), text: msg.text() });
  }
});
page.on('pageerror', (err) => {
  consoleErrors.push({ type: 'pageerror', text: String(err) });
});

console.log('[1/3] Navigating to http://localhost:4321 ...');
await page.goto('http://localhost:4321', { waitUntil: 'networkidle', timeout: 30000 });

// Wait for hero image to render fully
console.log('[2/3] Waiting for hero image ...');
await page.waitForSelector('.hero__bg', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(2000);

const file = resolve(outDir, 'hero.png');
console.log('[3/3] Taking screenshot ...');
await page.screenshot({ path: file, fullPage: false });

await browser.close();

console.log('\n=== CONSOLE ERRORS ===');
if (consoleErrors.length === 0) console.log('(none)');
else consoleErrors.forEach((e, i) => console.log(`[${i}] ${e.type}: ${e.text}`));

console.log('\nScreenshot:', file);
