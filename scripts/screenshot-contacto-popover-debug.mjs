import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('scripts/_screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto('http://localhost:4200/contacto', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const wcard = await page.$('app-whatsapp-hub[triggerless] .info-card');
if (!wcard) { console.log('NO CARD'); process.exit(1); }
// Scroll so WhatsApp card is near TOP of viewport (forces flip)
await page.evaluate(() => {
  const c = document.querySelector('app-whatsapp-hub[triggerless] .info-card');
  if (c) {
    const r = c.getBoundingClientRect();
    window.scrollBy(0, r.top - 100);
  }
});
await page.waitForTimeout(500);
const cardRect = await wcard.boundingBox();
console.log('card rect:', cardRect);
await wcard.click();
await page.waitForTimeout(500);
const popoverInfo = await page.evaluate(() => {
  const m = document.querySelector('app-whatsapp-hub[triggerless] .whatsapp-hub__menu');
  if (!m) return null;
  const r = m.getBoundingClientRect();
  const hub = document.querySelector('app-whatsapp-hub[triggerless]');
  const hubRect = hub.getBoundingClientRect();
  return {
    popover: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    hub: { left: hubRect.left, top: hubRect.top, right: hubRect.right, bottom: hubRect.bottom, width: hubRect.width, height: hubRect.height },
    flipped: hub.querySelector('.whatsapp-hub')?.classList.contains('whatsapp-hub--flipped'),
    overflowAncestors: (() => {
      let el = m.parentElement;
      const list = [];
      while (el) {
        const cs = getComputedStyle(el);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          list.push({ tag: el.tagName, class: el.className.toString().slice(0,80), ov: cs.overflow });
        }
        el = el.parentElement;
      }
      return list;
    })(),
    vh: window.innerHeight,
  };
});
console.log(JSON.stringify(popoverInfo, null, 2));
await page.screenshot({ path: 'scripts/_screenshots/contacto-popover-debug.png', fullPage: false });
await browser.close();
