// Screenshot every "floating CTA" in CAS to verify the .gold-pill-button
// mixin change propagated consistently. Runs against http://localhost:4200.
// Outputs PNGs into tools/visual-check/out/.
//
// Usage: node tools/visual-check/screenshot-all-ctas.mjs [label]

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const BASE = process.env.URL || 'http://localhost:4200';
const LABEL = process.argv[2] || 'all';

const SHOTS = [
  {
    name: 'home-featured-products-cta',
    url: `${BASE}/`,
    selector: '.featured-products__cta',
    waitMs: 800,
  },
  {
    name: 'home-availability-pedir-reunion',
    url: `${BASE}/`,
    selector: '.availability__cta',
    nth: 0,
    waitMs: 800,
  },
  {
    name: 'home-availability-ver-productos',
    url: `${BASE}/`,
    selector: '.availability__cta',
    nth: 1,
    waitMs: 800,
  },
  {
    name: 'home-case-studies-ver-casos',
    url: `${BASE}/`,
    selector: '.case-studies__cta',
    waitMs: 1200,
  },
  {
    name: 'productos-pedir-propuesta',
    url: `${BASE}/productos`,
    selector: '.product-row__cta',
    nth: 0,
    waitMs: 1200,
  },
];

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  for (const shot of SHOTS) {
    console.log(`→ ${shot.name}`);
    await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(shot.waitMs);

    const loc = shot.nth !== undefined
      ? page.locator(shot.selector).nth(shot.nth)
      : page.locator(shot.selector).first();

    try {
      await loc.waitFor({ state: 'attached', timeout: 15000 });
      await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(1200); // let reveal animations finish
    } catch (e) {
      console.log(`  ! selector failed ${shot.selector}: ${e.message}`);
      continue;
    }

    const box = await loc.boundingBox();
    if (!box) {
      console.log(`  ! no bounding box for ${shot.name}`);
      continue;
    }

    const margin = 40;
    const clip = {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: Math.min(1440 - Math.max(0, box.x - margin), box.width + margin * 2),
      height: Math.min(900 - Math.max(0, box.y - margin), box.height + margin * 2),
    };

    const out = join(OUT_DIR, `cta-${LABEL}-${shot.name}.png`);
    await page.screenshot({ path: out, clip });
    console.log(`  ✓ ${out}`);
  }

  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
