#!/usr/bin/env node
// Verifica qué font/weight efectivo se aplica al brass CTA y si Roboto 700
// carga correctamente.
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const url = 'http://localhost:4200/';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const cta = document.querySelector('.engagement-card--highlight .engagement-card__cta');
    if (!cta) return { error: 'CTA not found' };
    const cs = getComputedStyle(cta);
    // Inspect all loaded fonts
    const loaded = Array.from(document.fonts).map(f => ({
      family: f.family,
      weight: f.weight,
      style: f.style,
      status: f.status,
    }));
    return {
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      letterSpacing: cs.letterSpacing,
      color: cs.color,
      loaded,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
