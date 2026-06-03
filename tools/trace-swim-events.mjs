// Instrumenta los métodos del companion para trackear el lifecycle del swim.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Inject logging into the page: track swim state changes by polling the
// pivot's classList for is-swimming + the transform
await page.evaluate(() => {
  window.__events = [];
  const pivot = document.querySelector('.companion__pivot');
  if (!pivot) return;
  let lastSwim = pivot.classList.contains('is-swimming');
  let lastTransform = pivot.style.transform || '';
  const start = performance.now();
  // Poll every 16ms (60fps)
  const id = setInterval(() => {
    const swim = pivot.classList.contains('is-swimming');
    const transform = pivot.style.transform || '';
    if (swim !== lastSwim) {
      window.__events.push({ t: Math.round(performance.now() - start), type: 'swim-change', value: swim, transform });
      lastSwim = swim;
    }
    if (transform !== lastTransform) {
      window.__events.push({ t: Math.round(performance.now() - start), type: 'transform', value: transform });
      lastTransform = transform;
    }
  }, 16);
  window.__intervalId = id;
  window.__startTime = start;
});

const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 850;
});

console.log('Triggering scroll. Logging swim events for 3 seconds...');
const tStart = await page.evaluate((y) => {
  const t = performance.now();
  window.scrollTo(0, y);
  return t;
}, cap2Y);

await page.waitForTimeout(3000);

const events = await page.evaluate(() => {
  clearInterval(window.__intervalId);
  return window.__events;
});

for (const ev of events) {
  console.log(`[t=${ev.t}ms] ${ev.type}: ${ev.value === undefined ? '' : ev.value} ${ev.transform ? ' transform=' + ev.transform : ''}`);
}

await browser.close();
