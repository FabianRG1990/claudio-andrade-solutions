import { ChangeDetectionStrategy, Component } from '@angular/core';

import { WolfLakeCanvas } from './wolf-lake-canvas';

/**
 * WolfLandscape — segmento de apertura, antes del hero principal.
 * El bg es UNA SOLA imagen compuesta (paisaje fotorreal + lobo poligonal
 * azul + montículo de roca + reflejo cyan del lobo en el lago) generada
 * por nano-banana-pro a partir del fondo y el lobo originales. Por eso
 * la luz, las sombras, la paleta y el reflejo en el agua son físicas
 * reales, no compositing apilado en CSS.
 *
 * Sobre la imagen va el componente WolfLakeCanvas: WebGL2 que muestrea la
 * imagen original, anima la niebla en loop perfecto (4D simplex), agita
 * el reflejo cuando hay ondas, y un canvas 2D arriba con peces que
 * patrullan y reaccionan al cursor. La <img> queda como fallback puro
 * para WebGL ausente o prefers-reduced-motion.
 *
 * La sección mide 100dvh y termina con un fade al abismo (#06091A) para
 * que la siguiente sección entre sin línea de costura visible.
 */
@Component({
  selector: 'app-wolf-landscape',
  imports: [WolfLakeCanvas],
  templateUrl: './wolf-landscape.html',
  styleUrl: './wolf-landscape.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLandscape {}
