import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowDown } from '@ng-icons/phosphor-icons/regular';
import { phosphorFishSimpleDuotone } from '@ng-icons/phosphor-icons/duotone';

import { BubbleStream } from '@acuario-ui-shared/components/bubble-stream/bubble-stream';
import { PillButton } from '@acuario-ui-shared/components/pill-button/pill-button';
import { HeroFishCanvas } from './hero-fish-canvas';

/**
 * Hero — capítulo de apertura. Estructura preparada para alojar el canvas
 * 2D del pez articulado (HeroFishCanvas) bajo una capa superior con copy
 * editorial, badge de temporada, CTA y la "próxima ola" en glass-shell.
 *
 * Layout estable: copy y controles viven en z-10 sobre el canvas (z-0)
 * sin desplazarse cuando la animación se enchufa.
 */
@Component({
  selector: 'app-hero',
  imports: [NgIcon, BubbleStream, PillButton, HeroFishCanvas],
  providers: [provideIcons({ phosphorArrowDown, phosphorFishSimpleDuotone })],
  templateUrl: './hero.html',
  styleUrl: './hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Hero {}
