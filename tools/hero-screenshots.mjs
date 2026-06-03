#!/usr/bin/env node
/**
 * Hero visual verification — toma screenshots en 7 viewports clave para
 * confirmar que cada variante del hero se ve premium en su breakpoint.
 *
 * Requiere que el dev server esté corriendo en http://localhost:4200
 * (yarn nx serve claudio-andrade-solutions).
 *
 * Output: tools/screenshots/hero-{viewport}.png
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL = 'http://localhost:4201';
const OUT = resolve(process.cwd(), 'tools/screenshots');

const VIEWPORTS = [
  { name: 'iphone-se-375x667',         w: 375,  h: 667  },
  { name: 'iphone-14-393x852',         w: 393,  h: 852  },
  { name: 'iphone-landscape-852x393',  w: 852,  h: 393  },
  { name: 'iphone-landscape-667x375',  w: 667,  h: 375  },
  { name: 'ipad-portrait-768x1024',    w: 768,  h: 1024 },
  { name: 'ipad-landscape-1024x768',   w: 1024, h: 768  },
  { name: 'laptop-1366x640-short',     w: 1366, h: 640  },
  { name: 'macbook-1440x900',          w: 1440, h: 900  },
  { name: 'desktop-1920x1080',         w: 1920, h: 1080 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const v of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      deviceScaleFactor: 1,
      // Forzamos hover:hover y pointer:fine para que el desktop styling se aplique
      // donde corresponda; en mobile breakpoints el media query domina igual.
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
    // Esperar a que las animaciones se asienten: hero canvases tienen
    // fade-in de hasta ~1.5s + stagger del contenido editorial. 4s da
    // margen cómodo y el frame final es estable visualmente.
    await page.waitForTimeout(4000);
    const file = resolve(OUT, `hero-${v.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ${v.name} → ${file}`);
    await ctx.close();
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
