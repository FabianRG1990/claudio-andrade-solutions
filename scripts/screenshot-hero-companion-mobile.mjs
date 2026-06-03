// Verifica que el companion (pesecito + ícono WhatsApp) aparece anclado
// al badge "Soluciones con IA" en el hero móvil.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4202/', { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
// Slight scroll to ensure dock detection fires
await page.evaluate(() => window.scrollBy(0, 5));
await page.waitForTimeout(500);
await page.evaluate(() => window.scrollBy(0, -5));
await page.waitForTimeout(1500);

// Inspect dock registry + companion position
const info = await page.evaluate(() => {
  const anchor = document.querySelector('.hero__badge-anchor');
  const badge = document.querySelector('.hero__badge');
  const pivot = document.querySelector('.companion__pivot');
  return {
    anchor: anchor ? (() => {
      const r = anchor.getBoundingClientRect();
      const cs = getComputedStyle(anchor);
      return { left: r.left, right: r.right, top: r.top, display: cs.display, position: cs.position };
    })() : null,
    badge: badge ? (() => {
      const r = badge.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    })() : null,
    pivot: pivot ? (() => {
      const r = pivot.getBoundingClientRect();
      const cs = getComputedStyle(pivot);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, visibility: cs.visibility };
    })() : null,
  };
});
console.log(JSON.stringify(info, null, 2));

await page.screenshot({ path: 'scripts/_screenshots/hero-companion-mobile.png', fullPage: false });
await browser.close();
