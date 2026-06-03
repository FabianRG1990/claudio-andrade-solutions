// Verifica el segmento "Lo que hacemos" (whatwedo, pinned scroll) en /nosotros.
// Captura: los 3 slides en desktop recorriendo el track, mobile, y reduced-motion.
//
// Uso: node scripts/screenshot-whatwedo.mjs

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const url = 'http://localhost:4200/nosotros';
const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

const errors = [];
function wire(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (req) => errors.push(`[reqfail] ${req.url()} ${req.failure()?.errorText ?? ''}`));
}

// Devuelve métricas del track .whatwedo en la página.
async function trackMetrics(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.whatwedo');
    if (!el) return null;
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, height: el.offsetHeight, vh: window.innerHeight };
  });
}

// Lee qué slide está activo + el ghost text + progreso (debug).
async function activeState(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.whatwedo__slide.is-active');
    const ghost = active?.querySelector('.whatwedo__ghost')?.textContent?.trim() ?? null;
    const dotActive = [...document.querySelectorAll('.whatwedo__dot')].findIndex((d) =>
      d.classList.contains('is-active'),
    );
    return { ghost, dotActive };
  });
}

// ─── Desktop: recorre los 3 slides ───────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  wire(page);
  console.log(`[shot] desktop → ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  const m = await trackMetrics(page);
  console.log('[shot] track metrics:', m);
  if (!m) { console.log('[shot] !! .whatwedo no encontrado'); }

  const fractions = [0.16, 0.5, 0.84];
  for (let i = 0; i < 3; i++) {
    const y = m ? m.top + fractions[i] * (m.height - m.vh) : 0;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(1100); // deja terminar la transición crossfade
    const st = await activeState(page);
    const out = join(outDir, `whatwedo-${stamp}-desktop-slide${i}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`[shot] desktop slide ${i} → ${out}  (ghost=${st.ghost}, dotActive=${st.dotActive})`);
  }
  await ctx.close();
}

// ─── Mobile (393×852) ─────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  wire(page);
  console.log(`[shot] mobile → ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const m = await trackMetrics(page);
  const y = m ? m.top + 0.5 * (m.height - m.vh) : 0;
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(1000);
  const out = join(outDir, `whatwedo-${stamp}-mobile.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`[shot] mobile → ${out}`);
  // Detección de overflow horizontal.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`[shot] mobile horizontal overflow px: ${overflow}`);
  await ctx.close();
}

// ─── Reduced motion (fallback apilado) ────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  wire(page);
  console.log(`[shot] reduced-motion → ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  // Scroll al inicio del track para ver el stack.
  const m = await trackMetrics(page);
  await page.evaluate((yy) => window.scrollTo(0, yy), m ? m.top : 0);
  await page.waitForTimeout(600);
  const out = join(outDir, `whatwedo-${stamp}-reduced.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`[shot] reduced-motion → ${out}`);
  await ctx.close();
}

if (errors.length) {
  console.log(`[shot] ${errors.length} console/network issue(s):`);
  for (const e of errors.slice(0, 12)) console.log('  •', e);
} else {
  console.log('[shot] no console errors');
}

await browser.close();
