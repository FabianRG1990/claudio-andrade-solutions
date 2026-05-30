// Verifica visualmente que el navbar/burger se oculta cuando el popover de
// WhatsApp del companion se despliega, y vuelve cuando se cierra.
//
// Captura 3 estados (closed/open/closed-again) en mobile y desktop, y
// también valida programáticamente que el rail tiene la clase
// `.is-whatsapp-open` cuando corresponde.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = 'http://localhost:4200';
const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

// expectedHidden: true para mobile (debe esconderse), false para desktop
// (debe quedarse visible — el user pidió la regla solo para teléfonos).
async function runViewport(label, width, height, expectedHidden) {
  console.log(`\n── ${label} (${width}x${height}) ─────────────────────────`);
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // companion mount + dock register

  // Scroll a un dock fácil — cap-02 suele tener el companion bien en el
  // lado derecho del viewport, donde el navbar puede pisar el popover.
  const found = await page.evaluate(() => {
    const el = document.querySelector('[appCompanionDock="cap-02"]');
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    window.scrollBy(0, rect.top - window.innerHeight * 0.55);
    return true;
  });
  if (!found) {
    console.log('  MISS (no cap-02 anchor)');
    await ctx.close();
    return;
  }
  await page.waitForTimeout(2600); // wait for swim + debounce

  // ── (1) Closed: navbar visible ───────────────────────────────────────
  const railBefore = await page.evaluate(() => {
    const rail = document.querySelector('.floating-nav-rail');
    return {
      classes: rail?.className || '',
      opacity: rail ? getComputedStyle(rail).opacity : null,
    };
  });
  console.log(`  closed:   rail.classes="${railBefore.classes}" opacity=${railBefore.opacity}`);
  await page.screenshot({
    path: `${outDir}/navbar-hide-${label}-1-closed-${stamp}.png`,
    fullPage: false,
  });

  // ── (2) Click trigger → popover open, navbar hidden ──────────────────
  const trigger = await page.$('.companion__pivot .whatsapp-hub__trigger');
  if (!trigger) {
    console.log('  MISS (no companion trigger)');
    await ctx.close();
    return;
  }
  await trigger.click();
  await page.waitForTimeout(500); // popover transition + transition del rail

  const railOpen = await page.evaluate(() => {
    const rail = document.querySelector('.floating-nav-rail');
    const menu = document.querySelector('.companion__pivot .whatsapp-hub__menu');
    return {
      classes: rail?.className || '',
      opacity: rail ? getComputedStyle(rail).opacity : null,
      menuVisible: menu ? getComputedStyle(menu).visibility : null,
      menuOpacity: menu ? getComputedStyle(menu).opacity : null,
    };
  });
  console.log(`  open:     rail.classes="${railOpen.classes}" opacity=${railOpen.opacity} menu.opacity=${railOpen.menuOpacity}`);
  const hasClass = railOpen.classes.includes('is-whatsapp-open');
  const opacityZero = parseFloat(railOpen.opacity || '1') < 0.05;
  const opacityVisible = parseFloat(railOpen.opacity || '0') > 0.9;
  console.log(`            has class? ${hasClass}    opacity≈0? ${opacityZero}   opacity≈1? ${opacityVisible}`);
  await page.screenshot({
    path: `${outDir}/navbar-hide-${label}-2-open-${stamp}.png`,
    fullPage: false,
  });

  // ── (3) Click body → popover closes, navbar reappears ────────────────
  await page.evaluate(() => document.body.click());
  await page.waitForTimeout(500);

  const railAfter = await page.evaluate(() => {
    const rail = document.querySelector('.floating-nav-rail');
    return {
      classes: rail?.className || '',
      opacity: rail ? getComputedStyle(rail).opacity : null,
    };
  });
  console.log(`  reclose:  rail.classes="${railAfter.classes}" opacity=${railAfter.opacity}`);
  await page.screenshot({
    path: `${outDir}/navbar-hide-${label}-3-closed-${stamp}.png`,
    fullPage: false,
  });

  // ── Assertions ────────────────────────────────────────────────────────
  // En ambos breakpoints la clase debe togglearse (la lógica es global).
  // Lo que cambia es el efecto VISUAL: mobile esconde (opacity=0), desktop
  // se queda visible (opacity=1) porque la regla CSS está envuelta en
  // media query.
  const classOk = hasClass && !railAfter.classes.includes('is-whatsapp-open');
  const visualOk = expectedHidden ? opacityZero : opacityVisible;
  const ok = classOk && visualOk;
  console.log(`  → ${ok ? 'OK' : 'FAIL'} (expected ${expectedHidden ? 'hidden' : 'visible'})`);
  await ctx.close();
  return ok;
}

const mobileOk = await runViewport('mobile', 393, 852, true);
const desktopOk = await runViewport('desktop', 1280, 800, false);

await browser.close();

const allOk = mobileOk && desktopOk;
console.log(allOk ? '\nALL OK' : '\nFAILURES');
process.exit(allOk ? 0 : 1);
