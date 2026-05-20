/**
 * Hero variants — metadata compartida entre `<picture>` HTML y los canvases.
 *
 * Cada variante define:
 *   • mediaQuery: el mismo `<source media="...">` del <picture> del hero
 *   • image:      URL del archivo a samplear color (.png/.jpg/.webp)
 *   • lakeMask:   máscara hard-edge inset (para wolf-lake-canvas, peces)
 *   • waterMask:  máscara con blur (para wolf-lake-flow, shader del agua)
 *   • width/height: dimensiones nativas del asset
 *
 * CRÍTICO: el orden de evaluación coincide con el orden de los <source>
 * del <picture>. La primera coincidencia gana. La variante `desktop` es
 * el fallback (sin mediaQuery) — se usa cuando ningún breakpoint matchea.
 *
 * Si en el futuro se cambian los breakpoints en el HTML, ACTUALIZAR ACÁ
 * también — los dos sistemas deben estar perfectamente sincronizados o
 * los peces nadarán en una geometría distinta a la imagen visible.
 */

export interface HeroVariant {
  readonly name: 'cinematic' | 'tablet' | 'phone' | 'desktop';
  /** Media query que activa esta variante. `null` = fallback default. */
  readonly mediaQuery: string | null;
  /** URL del hero image (preferimos webp por liviano, sirve para sampleColor). */
  readonly image: string;
  /** Máscara para peces — polígono hard-edge inset 4%. */
  readonly lakeMask: string;
  /** Máscara para shader de agua — polígono con blur grueso. */
  readonly waterMask: string;
  readonly width: number;
  readonly height: number;
}

// Mismas media queries que en wolf-landscape.html — mantener sincronizado.
export const HERO_VARIANTS: ReadonlyArray<HeroVariant> = [
  {
    name: 'cinematic',
    // Match laptop chica corta (≥1024 ancho con altura ≤780) Y landscape
    // phone (cualquier ancho con altura ≤540 + orientation landscape).
    // El segundo query es CRÍTICO — antes landscape phone caía en tablet y
    // se servía la imagen 1:1 sobre un viewport horizontal 852×393, lo que
    // aplastaba la composición y cortaba la cabeza del lobo.
    mediaQuery: '(min-width: 1024px) and (max-height: 780px), (orientation: landscape) and (max-height: 540px)',
    image: '/hero-wolf/hero-mk6-cinematic.webp',
    lakeMask: '/hero-wolf/lake-mask-cinematic.png',
    waterMask: '/hero-wolf/water-mask-cinematic.png',
    width: 2520,
    height: 1080,
  },
  {
    name: 'tablet',
    // min-height: 640px excluye landscape phone (atrapado por la cinematic
    // arriba). max-aspect-ratio: 6/5 (=1.2) excluye iPad landscape (~1.33),
    // que cae al fallback desktop con MK6 16:9 — composición que encaja
    // mejor en orientaciones horizontales del tablet.
    mediaQuery: '(min-width: 641px) and (max-width: 1099px) and (min-height: 640px) and (max-aspect-ratio: 6/5)',
    image: '/hero-wolf/hero-mk6-tablet.webp',
    lakeMask: '/hero-wolf/lake-mask-tablet.png',
    waterMask: '/hero-wolf/water-mask-tablet.png',
    width: 1600,
    height: 1600,
  },
  {
    name: 'phone',
    mediaQuery: '(max-width: 640px)',
    image: '/hero-wolf/hero-mk6-phone.webp',
    lakeMask: '/hero-wolf/lake-mask-phone.png',
    waterMask: '/hero-wolf/water-mask-phone.png',
    width: 1080,
    height: 1920,
  },
  {
    name: 'desktop',
    mediaQuery: null, // default fallback
    image: '/hero-wolf/hero-mk6.webp',
    lakeMask: '/hero-wolf/lake-mask-mk3.png',
    waterMask: '/hero-wolf/water-mask-mk6.png',
    width: 1672,
    height: 941,
  },
];

/**
 * Devuelve la variante activa según el viewport actual.
 * Itera en orden hasta encontrar la primera media query que matchea.
 * Si ninguna matchea (raro — sería un viewport entre breakpoints), cae a
 * `desktop`.
 */
export function getActiveHeroVariant(): HeroVariant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // SSR / fallback — usar desktop.
    return HERO_VARIANTS[HERO_VARIANTS.length - 1];
  }
  for (const v of HERO_VARIANTS) {
    if (v.mediaQuery === null) continue;
    if (window.matchMedia(v.mediaQuery).matches) return v;
  }
  return HERO_VARIANTS[HERO_VARIANTS.length - 1];
}

/**
 * Escucha cambios de variant. Llama el callback cuando el viewport pasa de
 * una variante a otra (resize, rotación, ventana redimensionada).
 *
 * Retorna una función de cleanup que remueve todos los listeners.
 *
 * Implementación: registra un listener `change` en CADA media query y
 * comparamos por nombre — esto evita disparar el callback múltiples veces
 * cuando un solo resize cambia varios match al mismo tiempo (típico
 * cuando el user rota el dispositivo).
 */
export function onHeroVariantChange(
  callback: (variant: HeroVariant) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {
      // noop in SSR
    };
  }

  let lastVariantName = getActiveHeroVariant().name;
  const cleanups: Array<() => void> = [];

  const onChange = (): void => {
    const v = getActiveHeroVariant();
    if (v.name !== lastVariantName) {
      lastVariantName = v.name;
      callback(v);
    }
  };

  for (const v of HERO_VARIANTS) {
    if (v.mediaQuery === null) continue;
    const mql = window.matchMedia(v.mediaQuery);
    mql.addEventListener('change', onChange);
    cleanups.push(() => mql.removeEventListener('change', onChange));
  }

  return () => {
    for (const c of cleanups) c();
  };
}
