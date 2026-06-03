// Inspecciona las posiciones reales del lockup del hero para diagnosticar
// la asimetría del ícono.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('.hero__bg', { timeout: 10000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const hint = document.querySelector('.hero__scroll-hint');
  const scrollCue = document.querySelector('.hero__scroll-cue');
  const arrowIcon = document.querySelector('.hero__scroll-icon');
  const continuaText = document.querySelector('.hero__scroll-cue');
  const whatsappCue = document.querySelector('.hero__whatsapp-cue');
  const hablemos = document.querySelector('.hero__whatsapp-label');
  const anchor = document.querySelector('.hero__whatsapp-anchor');
  const pivot = document.querySelector('.companion__pivot');
  const hub = document.querySelector('.whatsapp-hub__trigger');

  const r = (el) => el ? el.getBoundingClientRect() : null;
  const cs = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return props.reduce((acc, p) => ({ ...acc, [p]: s.getPropertyValue(p) }), {});
  };

  return {
    hint: r(hint),
    scrollCue: r(scrollCue),
    arrowIcon: r(arrowIcon),
    whatsappCue: r(whatsappCue),
    whatsappCueStyles: cs(whatsappCue, ['padding-right', 'gap', 'display']),
    hablemos: r(hablemos),
    anchor: r(anchor),
    pivot: r(pivot),
    pivotTransform: pivot ? getComputedStyle(pivot).transform : null,
    hub: r(hub),
    hubStyles: cs(hub, ['width', 'height', 'opacity']),
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
