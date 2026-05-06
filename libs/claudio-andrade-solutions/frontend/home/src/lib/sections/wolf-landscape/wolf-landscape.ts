import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * WolfLandscape — segmento de apertura, antes del hero principal.
 * El bg es UNA SOLA imagen compuesta (paisaje fotorreal + lobo poligonal
 * azul + montículo de roca + reflejo cyan del lobo en el lago) generada
 * por nano-banana-pro a partir del fondo y el lobo originales. Por eso
 * la luz, las sombras, la paleta y el reflejo en el agua son físicas
 * reales, no compositing apilado en CSS.
 *
 * La sección mide 100dvh y termina con un fade al abismo (#06091A) para
 * que la siguiente sección entre sin línea de costura visible.
 */
@Component({
  selector: 'app-wolf-landscape',
  templateUrl: './wolf-landscape.html',
  styleUrl: './wolf-landscape.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLandscape {}
