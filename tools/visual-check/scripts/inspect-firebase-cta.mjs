#!/usr/bin/env node
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto('https://claudio-andrade-solutions.web.app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(1500);

  const data = await page.evaluate(() => {
    const cta = document.querySelector('.engagement-card:not(.engagement-card--highlight) .engagement-card__cta');
    if (!cta) return { error: 'CTA not found' };
    const cs = getComputedStyle(cta);
    const label = cta.querySelector('.engagement-card__cta-label');
    const labelCs = label ? getComputedStyle(label) : null;
    const icon = cta.querySelector('.engagement-card__cta-icon');
    const iconCs = icon ? getComputedStyle(icon) : null;
    return {
      cta: {
        background: cs.background,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        border: cs.border,
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        color: cs.color,
        padding: cs.padding,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform,
        height: cs.height,
        width: cs.width,
        display: cs.display,
      },
      label: labelCs ? {
        color: labelCs.color,
        fontWeight: labelCs.fontWeight,
        fontSize: labelCs.fontSize,
        letterSpacing: labelCs.letterSpacing,
      } : null,
      icon: iconCs ? {
        color: iconCs.color,
        background: iconCs.background,
        backgroundColor: iconCs.backgroundColor,
        width: iconCs.width,
        height: iconCs.height,
      } : null,
    };
  });

  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
