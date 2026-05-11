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
 * WolfSky — capa decorativa con 40 estrellas que titilan sobre el cielo
 * del hero. Posiciones generadas determinísticamente desde el índice
 * (mismo resultado SSR/CSR, sin flash de re-position en hidratación).
 *
 * Diseño:
 *   • Estrellas en el top 1-18 % del hero — la franja de cielo limpio de
 *     MK6, encima del horizonte/skyline y de las copas de los árboles.
 *   • X 8-92 % — los árboles laterales recortan los bordes del cielo,
 *     así que dejamos margen para no pintar sobre follaje.
 *   • Tamaño 1.8-3 px — un toque más grandes que las pintadas en el
 *     poster para que se lean como "twinkling encima", no como copias.
 *   • Pico de opacidad variado 0.65-0.95 — naturalismo: en un cielo real
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
    for (let i = 0; i < 40; i++) {
      // PRNG determinístico por índice — multiplicadores primos para
      // que la distribución se sienta uniforme sin patrón visible.
      const a = (i * 137 + 17) % 1000;
      const b = (i * 71 + 23) % 1000;
      const c = (i * 211 + 41) % 1000;
      const d = (i * 311 + 53) % 1000;
      const e = (i * 433 + 89) % 1000;

      out.push({
        i,
        // Margen 8-92 % horizontal — los árboles laterales recortan los
        // bordes del cielo en MK6, así que dejamos hueco para no pintar
        // sobre follaje.
        x: 8 + (a / 1000) * 84,
        // Cielo limpio: 1-18 % vertical. En MK6 el horizonte/skyline vive
        // ~20-25 %, así que cualquier estrella debajo de 18 % cae sobre
        // árboles, edificios o reflejos en el lago.
        y: 1 + (b / 1000) * 17,
        // 1.8-3 px de núcleo. Un toque más grandes que las estrellas
        // pintadas del poster para que el twinkle se lea como capa
        // animada por encima, no como copia que se confunde con el fondo.
        size: 1.8 + (c / 1000) * 1.2,
        // 0.65-0.95 — pico variado. Subido respecto a la versión MK3
        // porque el cielo de MK6 ya trae estrellas pintadas; las animadas
        // necesitan brillar un punto más para no perderse entre ellas.
        peak: 0.65 + (d / 1000) * 0.3,
        dur: PERIODS[i % PERIODS.length],
        // 0..8 s de fase — cubre más que el período máximo, así el ciclo
        // colectivo arranca completamente desfasado entre estrellas.
        delay: (e / 1000) * 8,
      });
    }
    return out;
  });
}
