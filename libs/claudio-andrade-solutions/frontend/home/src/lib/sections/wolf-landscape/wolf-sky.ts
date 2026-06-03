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

/**
 * Hash determinístico estilo GLSL. Para el mismo `i` y `salt` siempre
 * devuelve el mismo número en [0..1), uniformemente distribuido y sin
 * patrón visible.
 *
 * Lo usamos en vez de la versión anterior `(i * primo) % 1000` que producía
 * pasos lineales perfectamente regulares — combinados x e y daban DOS
 * diagonales (una por cada "pasada" antes del wrap del módulo) que el ojo
 * leía como dos rayas de estrellas. El sin-hash da distribución uniforme
 * de verdad, así las estrellas quedan repartidas por todo el cielo.
 */
function hash(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * WolfSky — capa decorativa con 30 estrellas que titilan sobre el cielo
 * del hero. Posiciones generadas determinísticamente desde el índice
 * (mismo resultado SSR/CSR, sin flash de re-position en hidratación).
 *
 * Diseño:
 *   • Estrellas en el top 1-18 % del hero — la franja de cielo limpio de
 *     MK6, encima del horizonte/skyline y de las copas de los árboles.
 *   • X 8-92 % — los árboles laterales recortan los bordes del cielo,
 *     así que dejamos margen para no pintar sobre follaje.
 *   • Tamaño 1.2-1.8 px — pequeñas, mismo orden de magnitud que las
 *     estrellas pintadas en el poster. Al pulsar no se hinchan: el ojo
 *     debe leer "esa estrella brilló", no "apareció un punto grande".
 *   • Pico de opacidad variado 0.65-0.95 — naturalismo: en un cielo real
 *     no todas las estrellas brillan igual.
 *   • Animación fade in → pico → fade out → BASELINE (no a 0). El valle
 *     queda en ~35 % del pico de cada estrella, así "apagada" sigue
 *     visible como las estrellas pintadas. El twinkle suma luz sobre
 *     esa baseline, no aparece y desaparece.
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
      <!-- Estrella fugaz — sale del punto rojo (73%, 14%) y termina en el
           verde (58%, 24%) del screenshot que pasó el usuario. Trayecto y
           ángulo de la cola están definidos en SCSS porque son fijos. -->
      <span class="sky-shooting-star"></span>
    </div>
  `,
  styleUrl: './wolf-sky.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfSky {
  protected readonly stars = computed<Star[]>(() => {
    const out: Star[] = [];
    for (let i = 0; i < 30; i++) {
      out.push({
        i,
        // Margen 8-92 % horizontal — los árboles laterales recortan los
        // bordes del cielo en MK6, así que dejamos hueco para no pintar
        // sobre follaje.
        x: 8 + hash(i, 0) * 84,
        // Cielo limpio: 1-18 % vertical. En MK6 el horizonte/skyline vive
        // ~20-25 %, así que cualquier estrella debajo de 18 % cae sobre
        // árboles, edificios o reflejos en el lago.
        y: 1 + hash(i, 1) * 17,
        // Radio EXTERIOR del gradient en px (incluye núcleo brillante + halo
        // soft). 1.3-2.0 px de radio = 2.6-4.0 px de diámetro total visible.
        // El núcleo brillante interno es sólo 18 % de ese radio (~0.25-0.36
        // px), el resto es fade soft — estrella con halo natural, no pelota.
        size: 1.3 + hash(i, 2) * 0.7,
        // 0.85-1.0 de pico — todas llegan a blanco casi macizo en peak.
        // Combinado con valle al 60 % del pico (ver SCSS), el promedio
        // de brillo es alto: las estrellas siempre están bien presentes
        // y la pulsación es sutil sobre ese fondo brillante.
        peak: 0.85 + hash(i, 3) * 0.15,
        // Período 6-10 s. Combinado con la keyframe multi-stop del SCSS
        // (5 puntos por ciclo, 2 sub-picos por estrella), cada sub-pico
        // toma 3-5 s — ritmo "respiración" pausado, lo que el ojo lee
        // como twinkle natural, no parpadeo apresurado.
        dur: 6 + hash(i, 4) * 4,
        // 0..8 s de fase — cubre más que el período máximo, así el ciclo
        // colectivo arranca completamente desfasado entre estrellas.
        delay: hash(i, 5) * 8,
      });
    }
    return out;
  });
}
