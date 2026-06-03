// Screenshot the .gold-pill-button on the home page for visual comparison
// against the reference image the user provided. Runs against the local dev
// server on http://localhost:4200. Outputs PNGs into tools/visual-check/out/.
//
// Usage: node tools/visual-check/screenshot-button.mjs [label]
//   label: optional filename suffix (e.g. "baseline", "v1", "v2")

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const URL = process.env.URL || 'http://localhost:4200/';
const LABEL = process.argv[2] || 'snapshot';

async function shoot() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // retina screenshots for crisp comparison
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  console.log(`→ navigate ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

  // Wait for fonts + sections to settle.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  // Scroll to the "featured-products" section so the CTA is visible.
  const cta = page.locator('.featured-products__cta').first();
  await cta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Full button shot with a margin around to capture halo/glow effects.
  const box = await cta.boundingBox();
  if (!box) {
    throw new Error('CTA not found on page');
  }

  const margin = 40;
  const clip = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  };

  const outPath = join(OUT_DIR, `button-${LABEL}.png`);
  await page.screenshot({ path: outPath, clip });
  console.log(`✓ saved ${outPath}`);

  // Hover state too — for completeness.
  await cta.hover();
  await page.waitForTimeout(1800); // wait for sheen slide animation
  const hoverPath = join(OUT_DIR, `button-${LABEL}-hover.png`);
  await page.screenshot({ path: hoverPath, clip });
  console.log(`✓ saved ${hoverPath}`);

  await browser.close();
}

shoot().catch((e) => {
  console.error(e);
  process.exit(1);
});
