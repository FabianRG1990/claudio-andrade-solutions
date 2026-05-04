import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorBrowsersBold,
  phosphorCheckBold,
  phosphorCloudCheckBold,
  phosphorCompassBold,
  phosphorDeviceMobileBold,
  phosphorFlowArrowBold,
  phosphorLightningBold,
  phosphorMagnifyingGlassBold,
  phosphorRobotBold,
  phosphorShoppingBagBold,
  phosphorTerminalWindowBold,
} from '@ng-icons/phosphor-icons/bold';
import { phosphorClock } from '@ng-icons/phosphor-icons/regular';

import { Species, SpeciesStatus, species } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

// `SpeciesStatus` se conserva como enum del schema viejo. Acá lo mapeamos
// a tonos SCSS y a etiquetas humanas para el chip de la card.
const STATUS_TONES: Record<SpeciesStatus, string> = {
  Estable: 'estable',          // verde · disponible al instante
  Vulnerable: 'vulnerable',    // coral suave · arrancando
  'En peligro': 'en-peligro',  // coral · cupo limitado
  Crítico: 'critico',          // coral intenso · premium
};

const STATUS_LABEL: Record<SpeciesStatus, string> = {
  Estable: 'Disponible',
  Vulnerable: 'En arranque',
  'En peligro': 'Cupo limitado',
  Crítico: 'Premium',
};

interface ReelItem extends Species {
  reelKey: string;
  // sequence: "01", "02", ..., "10". Calculado a partir del índice módulo
  // total de servicios — así el segundo set duplicado vuelve a 01..10 y
  // el lector ve la misma numeración cada vuelta del carrusel.
  sequence: string;
}

/**
 * SpeciesMarquee — capítulo 02 "Lo que ofrecemos". Carrusel infinito con
 * cards premium estilo glass-shell + glass-core (mismo lenguaje que las
 * tarjetas de membership) más un halo de color por categoría que vive en
 * la esquina superior. Sin imágenes: la lectura es 100 % editorial — icono
 * grande, número de secuencia, nombre, tagline y dos highlights con check.
 *
 * El loop CSS sigue funcionando igual: `[...species, ...species]` duplica
 * la lista, el keyframe -50% recorre las 10 únicas y al volver a 0 los
 * frames 11..20 son réplicas exactas → loop seamless.
 */
@Component({
  selector: 'app-species-marquee',
  imports: [Eyebrow, NgIcon, RevealDirective],
  providers: [
    provideIcons({
      phosphorBrowsersBold,
      phosphorCheckBold,
      phosphorClock,
      phosphorCloudCheckBold,
      phosphorCompassBold,
      phosphorDeviceMobileBold,
      phosphorFlowArrowBold,
      phosphorLightningBold,
      phosphorMagnifyingGlassBold,
      phosphorRobotBold,
      phosphorShoppingBagBold,
      phosphorTerminalWindowBold,
    }),
  ],
  templateUrl: './species-marquee.html',
  styleUrl: './species-marquee.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesMarquee {
  protected readonly reel = computed<ReelItem[]>(() =>
    [...species, ...species].map((sp, i) => ({
      ...sp,
      reelKey: `${sp.slug}-${i}`,
      sequence: `${(i % species.length) + 1}`.padStart(2, '0'),
    })),
  );

  protected statusToneAttr(status: SpeciesStatus): string {
    return STATUS_TONES[status];
  }

  protected statusLabel(status: SpeciesStatus): string {
    return STATUS_LABEL[status];
  }
}
