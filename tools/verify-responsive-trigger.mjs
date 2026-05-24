// Reproduce el caso del usuario: scroll lento desde hero hasta que cap-01
// apenas aparezca por debajo. Verifica que:
//   1. Al aparecer cap-01 por debajo, el swim arranca rápido
//   2. El ícono se mantiene visualmente alineado con su dock en cada
//      momento (sin desalineación)
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'responsive');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Find cap-02 (cap-01 isn't in DOM as attribute) and use it as a proxy.
// Actually cap-01 won't be in DOM, so let's find the section heading text.
const cap1Y = await page.evaluate(() => {
  // Find the "Seis productos" section heading
  const headings = Array.from(document.querySelectorAll('h2'));
  const cap1Section = headings.find(h => h.textContent.includes('Seis productos'));
  if (!cap1Section) return null;
  // Get the eyebrow above it
  const section = cap1Section.closest('section') || cap1Section.parentElement.parentElement;
  const eyebrow = section.querySelector('app-eyebrow');
  if (!eyebrow) return null;
  return eyebrow.getBoundingClientRect().top + window.scrollY;
});
console.log('cap-01 eyebrow page Y:', cap1Y);

// Scroll a position where cap-01 is at the BOTTOM of viewport (just appearing)
// vh = 900, want cap-01 at y=850 viewport → scrollY = cap1Y - 850
const targetScroll = cap1Y - 850;
console.log('Scrolling to:', targetScroll, '(cap-01 will be at y≈850 viewport)');

await page.evaluate((y) => window.scrollTo(0, y), targetScroll);
await page.waitForTimeout(50);
await page.screenshot({ path: resolve(outDir, '01-cap1-just-appearing.jpg'), type: 'jpeg', quality: 70 });

// Wait for debounce (250ms) + tiny buffer + check that swim has started
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(outDir, '02-mid-swim.jpg'), type: 'jpeg', quality: 70 });

// Continue waiting for swim to complete (~1100ms more)
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(outDir, '03-after-swim.jpg'), type: 'jpeg', quality: 70 });

// Now check icon alignment with cap-02 (which IS in DOM)
console.log('\nCheck alignment at cap-02 after scrolling more...');
await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  if (c) {
    const r = c.getBoundingClientRect();
    window.scrollTo(0, r.top + window.scrollY - 450);
  }
});
await page.waitForTimeout(3000); // long enough for swim + reveal anim
const align = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  const p = document.querySelector('.companion__pivot');
  if (!c || !p) return null;
  const cr = c.getBoundingClientRect();
  const pTransform = getComputedStyle(p).transform;
  // Extract matrix translate values
  const match = pTransform.match(/matrix\(([^)]+)\)/);
  let pTransformY = 0;
  if (match) {
    const vals = match[1].split(',').map(s => parseFloat(s.trim()));
    pTransformY = vals[5];
  }
  return {
    cap2CenterY: cr.top + cr.height / 2,
    pivotTransformY: pTransformY,
    diff: pTransformY - (cr.top + cr.height / 2),
  };
});
console.log('Cap-02 alignment after settling:', JSON.stringify(align, null, 2));
// Take cropped screenshot for visual verification
const cap2Box = await page.locator('[appCompanionDock="cap-02"]').boundingBox();
if (cap2Box) {
  await page.screenshot({
    path: resolve(outDir, '04-cap2-alignment.png'),
    clip: { x: Math.max(0, cap2Box.x - 30), y: Math.max(0, cap2Box.y - 30), width: 500, height: 100 },
  });
}

await browser.close();
console.log('\nDone.');
