// Check whether the ::before pseudo-element on .engagements__head is actually
// rendering (z-index visibility / mask issue). Use DOM inspection to read the
// computed style and the absolute box.

import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const head = await page.$('.engagements__head');
await head.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

const info = await page.evaluate(() => {
  const el = document.querySelector('.engagements__head');
  if (!el) return { miss: true };
  const cs = getComputedStyle(el);
  const before = getComputedStyle(el, '::before');
  return {
    el: {
      position: cs.position,
      isolation: cs.isolation,
      zIndex: cs.zIndex,
      background: cs.background.slice(0, 100),
    },
    before: {
      content: before.content,
      position: before.position,
      inset: before.inset,
      zIndex: before.zIndex,
      background: before.background.slice(0, 100),
      maskImage: before.maskImage.slice(0, 200),
      webkitMaskImage: before.webkitMaskImage.slice(0, 200),
      maskComposite: before.maskComposite,
      webkitMaskComposite: before.webkitMaskComposite,
    },
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
