// device-capability — detecta si el dispositivo es un TELÉFONO real
// (NO tablet, NO desktop) que requiere reducciones de WebGL para no
// crashear por OOM. El user fue explícito: la optimización aplica
// "únicamente y exclusivamente para teléfono", ningún otro dispositivo
// debe verse afectado.
//
// Por qué existe:
//   El home monta 3 contextos WebGL simultáneos en el hero (wolf-lake-flow
//   shader + wolf-fish-three renderer + companion-fish renderer). Cada uno
//   alloca framebuffers, render targets de bloom, texturas del GLB y env
//   cubemaps. En desktop y tablet esto fluye; en mobile Safari/Chrome la
//   suma rebasa el budget de GPU memory del browser (iOS Safari mata tabs
//   ~250 MB), produciendo crashes tipo "A problem repeatedly occurred"
//   (Safari) o "Can't open this page" (Chrome Android).
//
//   La política mobile: mantenemos TODAS las animaciones (peces nadando,
//   estrellas titilando, companion pez↔icono, agua animada) pero
//   reducimos quirúrgicamente:
//     • DPR 1.0 (en lugar de 2.0) → -75% framebuffer
//     • Sin UnrealBloomPass → -5 render targets internos por renderer
//     • Sin cursor fish (touch devices no tienen cursor real)
//     • 3 peces ambient (en lugar de 4)
//     • Skip del fish texture upload en flow shader
//
// Detección phone (no incluye tablet):
//   • Touch device (`pointer: coarse`) requerido para descartar desktops
//     con viewport chico (ventana redimensionada). Sin coarse, los users
//     desktop con browser angosto NO entran en modo low-power.
//   • Phone portrait: max-width: 767 (iPhone 15 Pro Max portrait = 430,
//     iPad mini portrait = 744 — el threshold 767 excluye iPad mini).
//   • Phone landscape: max-height: 480 (iPhone Pro Max landscape height
//     = 430, iPad landscape height = 768+ — excluye tablets).
//
// SSR safe: en server, todas las APIs son undefined → retornamos false
// (= correr WebGL full quality). El consumer típicamente usa este helper
// dentro de `afterNextRender` o detrás de `isPlatformBrowser`.

/**
 * `true` si el dispositivo es un teléfono real (phone) — touch device con
 * viewport pequeño en cualquier orientación. Tablets, desktops y desktops
 * con browser angosto retornan `false` (full quality, sin afectación).
 *
 * El nombre histórico `shouldSkipHeavyWebGL` se mantiene como re-export
 * para no romper imports existentes; semánticamente significa "phone".
 */
export function isMobilePhone(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;

  // Touch device REQUERIDO. Sin esto, un desktop con ventana redimensionada
  // a 600 px de ancho entraría en modo low-power — el user pidió que solo
  // phones se vean afectados.
  if (!window.matchMedia('(pointer: coarse)').matches) return false;

  // Phone portrait O phone landscape.
  // Portrait phones: width ≤ 767 (iPhone Pro Max portrait = 430; iPad
  // mini portrait = 744 quedaría en 768 pero a veces reporta 744 — el
  // límite 767 lo excluye).
  // Landscape phones: height ≤ 480 (iPhone Pro Max landscape height =
  // 430; iPad landscape height ≥ 768 — excluido).
  const isPhonePortrait = window.matchMedia('(max-width: 767px)').matches;
  const isPhoneLandscape = window.matchMedia('(max-height: 480px)').matches;

  return isPhonePortrait || isPhoneLandscape;
}

/**
 * Alias retrocompatible — antes este helper se llamaba así y aplicaba
 * un criterio más amplio (incluía tablets). El user clarificó: solo phones.
 * El nombre `isMobilePhone` es el canónico de aquí en adelante.
 */
export function shouldSkipHeavyWebGL(): boolean {
  return isMobilePhone();
}

/**
 * `true` si el usuario pidió reducir movimiento (`prefers-reduced-motion:
 * reduce`). Centraliza el chequeo que vivía duplicado inline en múltiples
 * componentes/animaciones.
 *
 * SSR safe: en server (sin `window`/`matchMedia`) retorna `false` → no reduce
 * (= correr animación full); el server no anima de todos modos.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
