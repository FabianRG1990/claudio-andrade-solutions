import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

interface Star {
  /** Índice estable para track. */
  i: number;
  /** Posición horizontal en % del hero. */
  x: number;
  /** Posición vertical en % del hero (cielo, top ~40%). */
  y: number;
  /** Diámetro del núcleo en px. Coincide con el tamaño de las estrellas
   *  pintadas en el poster (1.5-2.5 px) — la idea es que se vean como
   *  más, no como otro tipo de objeto. */
  size: number;
  /** Pico de opacidad del titileo (0..1). Variado por estrella así algunas
   *  son más brillantes y otras más tenues — evita el efecto "árbol de
   *  navidad" donde todo pulsa al mismo nivel. */
  peak: number;
  /** Período del titileo (segundos) — primos coprimos por estrella, así
   *  el ojo nunca capta sincronía colectiva. */
  dur: number;
  /** Offset de fase (segundos) — desfasa cuándo cada estrella entra en
   *  ciclo dentro de su propio período. */
  delay: number;
}

/** Períodos primos coprimos. Cualquier subset que se sortee da un patrón
 *  arrítmico al ojo. 4.7s..8.3s son cadencias "respiración lenta", no
 *  parpadeo nervioso — la sensación realista que pediste. */
const PERIODS = [4.7, 5.3, 6.1, 6.9, 7.7, 8.3];

/**
 * WolfSky — capa decorativa con 22 estrellas que titilan sobre el cielo
 * del hero. Posiciones generadas determinísticamente desde el índice
 * (mismo resultado SSR/CSR, sin flash de re-position en hidratación).
 *
 * Diseño:
 *   • Estrellas en el top 40 % del hero — no bajan al horizonte ni al lago.
 *   • Tamaño 1.5-2.5 px — coincide con las estrellas pintadas en el poster
 *     (no compiten visualmente, parecen "una más" que respira).
 *   • Pico de opacidad variado 0.55-0.9 — naturalismo: en un cielo real
 *     no todas las estrellas brillan igual.
 *   • Animación fade in → pico → fade out → 0 puro. El "apagado" es total
 *     entre ciclos: la estrella desaparece y vuelve, no oscila sobre un
 *     fondo siempre encendido.
 *   • ease-in-out + períodos coprimos 4.7-8.3 s + delays desfasados →
 *     nunca se sincronizan en pantalla, parece cielo vivo.
 *
 * z-index: 1 — encima del video del hero, debajo del canvas de los peces.
 */
@Component({
  selector: 'app-wolf-sky',
  template: `
    <div class="sky-stars" aria-hidden="true">
      @for (s of stars(); track s.i) {
        <span
          class="sky-star"
          [style.left.%]="s.x"
          [style.top.%]="s.y"
          [style.--size.px]="s.size"
          [style.--peak]="s.peak"
          [style.--dur.s]="s.dur"
          [style.--delay.s]="s.delay"
        ></span>
      }
    </div>
  `,
  styleUrl: './wolf-sky.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfSky {
  protected readonly stars = computed<Star[]>(() => {
    const out: Star[] = [];
    for (let i = 0; i < 22; i++) {
      // PRNG determinístico por índice — multiplicadores primos para
      // que la distribución se sienta uniforme sin patrón visible.
      const a = (i * 137 + 17) % 1000;
      const b = (i * 71 + 23) % 1000;
      const c = (i * 211 + 41) % 1000;
      const d = (i * 311 + 53) % 1000;
      const e = (i * 433 + 89) % 1000;

      out.push({
        i,
        // Margen 4-96 % horizontal — evita que un dot quede pegado al borde.
        x: 4 + (a / 1000) * 92,
        // Cielo: 2-38 % vertical. No bajamos al horizonte (50 %) ni a las
        // copas de los árboles laterales (~35-45 %).
        y: 2 + (b / 1000) * 36,
        // 1.5-2.5 px de núcleo. El halo `box-shadow` agrega ~2-3 px más,
        // así el "objeto" total coincide con las estrellas pintadas.
        size: 1.5 + (c / 1000) * 1,
        // 0.55-0.9 — pico variado. La mitad inferior del rango da estrellas
        // tenues, la superior da estrellas más notables. Naturalismo.
        peak: 0.55 + (d / 1000) * 0.35,
        dur: PERIODS[i % PERIODS.length],
        // 0..8 s de fase — cubre más que el período máximo, así el ciclo
        // colectivo arranca completamente desfasado entre estrellas.
        delay: (e / 1000) * 8,
      });
    }
    return out;
  });
}
