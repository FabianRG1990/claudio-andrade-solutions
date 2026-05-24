// Verifica que scroll-up y scroll-down generen swims similares en
// duración y velocidad (no "rapidísimo" en up).
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'symmetric');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(3000);

// Helper: scroll gradually from current to target Y, then sample swim
async function gradualScrollAndSample(direction, startY, endY, label) {
  await page.evaluate((y) => window.scrollTo(0, y), startY);
  await page.waitForTimeout(2500);

  // Setup instrumentation: log swim start/end + sample fish position
  await page.evaluate(() => {
    window.__events = [];
    window.__samples = [];
    const start = performance.now();
    let last = false;
    clearInterval(window.__poller);
    window.__poller = setInterval(() => {
      const piv = document.querySelector('.companion__pivot');
      const sw = piv?.classList.contains('is-swimming') || false;
      if (sw !== last) {
        window.__events.push({ t: Math.round(performance.now() - start), sw });
        last = sw;
      }
    }, 16);
  });

  // Gradual scroll over ~1500ms
  const steps = 15;
  const stepDy = (endY - startY) / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((dy) => window.scrollBy(0, dy), stepDy);
    await page.waitForTimeout(100);
  }

  // Wait for any swim to finish
  await page.waitForTimeout(3000);

  const events = await page.evaluate(() => window.__events);
  const startSwim = events.find(e => e.sw);
  const endSwim = events.find(e => !e.sw && events.indexOf(e) > events.indexOf(startSwim));
  if (startSwim && endSwim) {
    const dur = endSwim.t - startSwim.t;
    console.log(`[${label}] swim from t=${startSwim.t}ms to t=${endSwim.t}ms (duration ${dur}ms)`);

    // Capture frame mid-swim by re-doing the scroll (since the events are
    // from the previous one we missed)
    // Actually just record the count
    return { startedAt: startSwim.t, duration: dur };
  } else {
    console.log(`[${label}] NO swim detected`);
    return null;
  }
}

// Get dock positions including the dynamic ones (via app-eyebrow)
const dockPositions = await page.evaluate(() => {
  const positions = {};
  // Static attrs (cap-02, cap-03, cap-05, hero, timeline-head)
  for (const el of document.querySelectorAll('[appCompanionDock]')) {
    const id = el.getAttribute('appCompanionDock');
    if (id) positions[id] = el.getBoundingClientRect().top + window.scrollY;
  }
  // Dynamic via app-eyebrow with [appCompanionDock]="id" — pull from the
  // companion registry on the window if exposed; else use position by
  // section ordering
  return positions;
});
console.log('Dock pageY:', dockPositions);

const cap2 = dockPositions['cap-02'];
const cap3 = dockPositions['cap-03'];

// Scenario A: scroll DOWN cap-02 → cap-03 area (both static, reliable)
console.log('\n=== A: scroll DOWN cap-02 → cap-03 area ===');
const a = await gradualScrollAndSample(
  'down',
  Math.round(cap2 - 400),
  Math.round(cap3 - 400),
  'down'
);

// Scenario B: scroll UP cap-03 → cap-02 area
console.log('\n=== B: scroll UP cap-03 → cap-02 area ===');
const b = await gradualScrollAndSample(
  'up',
  Math.round(cap3 - 400),
  Math.round(cap2 - 400),
  'up'
);

await browser.close();
