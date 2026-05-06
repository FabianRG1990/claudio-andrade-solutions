import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorPaperPlaneTiltBold } from '@ng-icons/phosphor-icons/bold';
import {
  phosphorEnvelopeSimpleDuotone,
  phosphorMapPinDuotone,
  phosphorPhoneDuotone,
} from '@ng-icons/phosphor-icons/duotone';

import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

/**
 * ContactoPage — single-screen layout (desktop): header inline + form +
 * 3 info-cards (email, teléfono, dirección). Sin scroll en ≥1024px. En
 * mobile la misma información se apila verticalmente.
 *
 * Las info-cards heredan el sistema premium del proyecto: glass-shell +
 * glass-core con halo `data-accent` (lagoon · bioluminescent · kelp) y
 * texto reforzado en contraste para mantener legibilidad sobre el cristal.
 */
@Component({
  selector: 'app-contacto-page',
  imports: [Eyebrow, NgIcon, RevealDirective],
  providers: [
    provideIcons({
      phosphorEnvelopeSimpleDuotone,
      phosphorMapPinDuotone,
      phosphorPaperPlaneTiltBold,
      phosphorPhoneDuotone,
    }),
  ],
  templateUrl: './contacto.html',
  styleUrl: './contacto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactoPage {}
