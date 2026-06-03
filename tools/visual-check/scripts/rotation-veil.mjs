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
  viewport: { width: 393, height: 852 }, // portrait start
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();

page.on('console', (msg) => console.log('[browser]', msg.text()));

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Hook: track the veil's computed opacity over time during rotation
await page.evaluate(() => {
  const veil = document.querySelector('.rotation-veil');
  if (!veil) {
    console.log('[hook] NO VEIL FOUND');
    return;
  }
  console.log('[hook] veil mounted, initial opacity:', getComputedStyle(veil).opacity);

  // Watch for class changes
  const obs = new MutationObserver(() => {
    console.log(
      '[hook] class change, isActive:',
      veil.classList.contains('is-active'),
      'opacity:',
      getComputedStyle(veil).opacity,
    );
  });
  obs.observe(veil, { attributes: true, attributeFilter: ['class'] });
});

console.log('--- rotating portrait → landscape ---');
await page.setViewportSize({ width: 852, height: 393 });
await page.waitForTimeout(500);

// Capture immediately after rotation triggered
await page.screenshot({
  path: join(OUT, 'rotation-01-landscape-after.png'),
});
console.log('Wrote rotation-01-landscape-after.png');

await page.waitForTimeout(1000);

console.log('--- rotating landscape → portrait ---');
await page.setViewportSize({ width: 393, height: 852 });
await page.waitForTimeout(500);
await page.screenshot({
  path: join(OUT, 'rotation-02-portrait-back.png'),
});

await page.waitForTimeout(800);
console.log('Done');

await browser.close();
