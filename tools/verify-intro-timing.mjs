// Verifica que durante el primer ~1700ms tras page load, el ícono del
// companion NO sea visible, y que aparezca DESPUÉS del resto del hero.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'intro-timing');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

// Capture timing-sensitive frames during page load
const loadStart = Date.now();
await page.goto('http://127.0.0.1:4202/', { waitUntil: 'domcontentloaded' });

// Capture frames at key moments
const captureAt = async (t, label) => {
  while (Date.now() - loadStart < t) {
    await page.waitForTimeout(20);
  }
  await page.screenshot({
    path: resolve(outDir, `${String(t).padStart(4, '0')}ms-${label}.jpg`),
    type: 'jpeg', quality: 85,
  });
  // Also check hub opacity
  const data = await page.evaluate(() => {
    const piv = document.querySelector('.companion__pivot');
    if (!piv) return { piv: 'not-mounted' };
    const pStyle = getComputedStyle(piv);
    const anims = piv.getAnimations();
    return {
      pivotOpacity: pStyle.opacity,
      animationCount: anims.length,
      animationStates: anims.map(a => ({
        name: a.animationName || (a.effect && a.effect.target ? 'css' : 'unknown'),
        playState: a.playState,
        currentTime: a.currentTime,
      })),
      docVisibility: document.visibilityState,
    };
  });
  console.log(`t=${t}ms ${label}:`, data);
};

await captureAt(500,  'early');     // before hero reveal chain starts
await captureAt(1400, 'pre-hablemos'); // before scroll-hint fades in
await captureAt(1800, 'mid-intro');  // companion intro should be starting
await captureAt(2300, 'settled');    // companion intro should be done
await captureAt(8000, 'long-after'); // sanity check — should be opacity 1

await browser.close();
