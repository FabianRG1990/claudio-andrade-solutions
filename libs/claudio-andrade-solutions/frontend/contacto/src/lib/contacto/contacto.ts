import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorPaperPlaneTiltBold,
  phosphorWhatsappLogoBold,
} from '@ng-icons/phosphor-icons/bold';
import {
  phosphorEnvelopeSimpleDuotone,
  phosphorMapPinDuotone,
} from '@ng-icons/phosphor-icons/duotone';

import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { WhatsappHub } from '@cas-ui-shared/components/whatsapp-hub/whatsapp-hub';

/**
 * ContactoPage — single-screen layout (desktop): header inline + form +
 * 3 info-cards (email, WhatsApp, dirección). Sin scroll en ≥1024px. En
 * mobile la misma información se apila verticalmente.
 *
 * El card de WhatsApp ocupa el slot que antes era Teléfono — mismo tamaño,
 * misma surface navy, mismo border, misma tipografía. Solo el icon-pill
 * cambia al verde oficial de WhatsApp (#25D366 → #128C7E) como única
 * marca de identidad. Al click abre el WhatsappHub popover con los 3
 * contactos (ventas, CEO, diseño).
 *
 * Las info-cards heredan el sistema premium del proyecto: glass-shell +
 * glass-core con halo `data-accent` (lagoon · whatsapp · kelp).
 */
@Component({
  selector: 'app-contacto-page',
  imports: [Eyebrow, NgIcon, RevealDirective, WhatsappHub],
  providers: [
    provideIcons({
      phosphorEnvelopeSimpleDuotone,
      phosphorMapPinDuotone,
      phosphorPaperPlaneTiltBold,
      phosphorWhatsappLogoBold,
    }),
  ],
  templateUrl: './contacto.html',
  styleUrl: './contacto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactoPage {}
