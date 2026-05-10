import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

interface Star {
  /** Índice estable para track. */
  i: number;
  /** Posición horizontal en % del hero. */
  x: number;
  /** Posición vertical en % del hero (0-50% solamente — solo cielo). */
  y: number;
  /** Diámetro del dot, px. */
  size: number;
  /** Brillo base (0..1). Algunas estrellas son más brillantes. */
  brightness: number;
  /** Período del titileo (segundos) — usados primos coprimos para que el
   *  ojo nunca detecte un patrón cíclico colectivo. */
  dur: number;
  /** Offset de fase del titileo (segundos). */
  delay: number;
}

/**
 * WolfSky — capa decorativa estática que vive sobre la imagen MK3 pero
 * debajo del canvas de los peces. Dos elementos:
 *
 *   1) Estrellas titilando — N dots posicionados deterministamente en el
 *      cielo del hero (top 50% del viewport). Cada uno con período prime
 *      coprimo (3.7s, 5.3s, 7.1s, 4.3s) y delay desfasado, así nunca se
 *      sincronizan visualmente — patrón clásico Apple/Linear/Stripe para
 *      titileo "vivo, no cronometrado".
 *
 *   2) Estrella fugaz — UN solo dot que cada ~14s destella brevemente y
 *      se desplaza ~1.5cm lateralmente hacia la ciudad (de izquierda a
 *      derecha), dejando un trail blanco delgado de ~1.4cm que crece
 *      detrás del dot a medida que avanza. Visible solo ~1.2s por ciclo.
 *      Diseñado para imitar una fugaz real vista desde tierra: destello
 *      corto y localizado, no streak dramático cruzando el cielo entero.
 *
 * Posiciones generadas determinísticamente (mismo PRNG por índice), así
 * el SSR y CSR producen el mismo resultado y no hay flash de re-position
 * en hidratación.
 *
 * z-index: 1 — encima del bg image (z=0), debajo del canvas de peces
 * (z=2). Así la fugaz y las estrellas son fondo del lago / no compiten
 * con los peces visualmente.
 */
@Component({
  selector: 'app-wolf-sky',
  template: `
    <!-- Estrellas titilando — divs absolute con box-shadow apilado para
         halo radial que late con el opacity. Patrón usado en sites como
         Apple TV+ para estrellas premium en backgrounds. -->
    <div class="sky-stars" aria-hidden="true">
      @for (s of stars(); track s.i) {
        <span
          class="sky-star"
          [class.sky-star--bright]="s.brightness > 0.55"
          [style.left.%]="s.x"
          [style.top.%]="s.y"
          [style.--size.px]="s.size"
          [style.--dur.s]="s.dur"
          [style.--delay.s]="s.delay"
        ></span>
      }
    </div>

    <!-- Estrella fugaz — un único dot blanco con halo que destella en el
         cuadrante superior-izquierdo del cielo, se desplaza ~1.5cm hacia
         la derecha (rumbo a la ciudad) y deja un trail fino que crece
         detrás. Subtle por diseño: mejor que el usuario lo "atrape" como
         un detalle vivo a que lo perciba como animación protagonista. -->
    <span class="sky-shooting-star" aria-hidden="true"></span>
  `,
  styleUrl: './wolf-sky.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfSky {
  /** 22 estrellas titilando — divs absolute con halo box-shadow.
   *  Pocas y bien distribuidas para que cada una se note como un
   *  twinkle individual, no un fondo de sky-noise. */
  protected readonly stars = computed<Star[]>(() => {
    const PERIODS = [2.8, 3.5, 4.3, 5.1, 5.9, 6.7]; // primes coprimos
    const out: Star[] = [];
    for (let i = 0; i < 22; i++) {
      const a = (i * 137 + 17) % 1000;
      const b = (i * 71 + 23) % 1000;
      const c = (i * 211 + 41) % 1000;
      const d = (i * 311 + 53) % 1000;
      out.push({
        i,
        x: a / 10,
        y: (b / 1000) * 40, // top 40% (cielo, sobre el horizonte)
        // 1.5-3 px de núcleo. El halo box-shadow agrega ~10-16px más.
        size: 1.5 + (c % 30) / 20,
        brightness: 0.4 + (d % 60) / 100,
        dur: PERIODS[i % PERIODS.length],
        delay: (c / 1000) * 6,
      });
    }
    return out;
  });
}
