import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorBrowsersBold,
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

import { Species, SpeciesStatus, species } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

// Mapeo del enum visual (`SpeciesStatus`) que sobrevive del schema antiguo a
// la semántica nueva: cada estado es un nivel de disponibilidad del servicio.
// El `data-status` del DOM sigue cayendo en los mismos selectores SCSS, así
// los tonos (kelp/coral) ya pintan las etiquetas sin tocar estilos.
const STATUS_TONES: Record<SpeciesStatus, string> = {
  Estable: 'estable',          // verde · disponible al instante
  Vulnerable: 'vulnerable',    // coral suave · arrancando
  'En peligro': 'en-peligro',  // coral · cupo limitado
  Crítico: 'critico',          // coral intenso · premium
};

// Etiqueta de UI para el chip — el enum interno se mantiene por compatibilidad
// con el tipo, pero al usuario le mostramos algo coherente con "servicios".
const STATUS_LABEL: Record<SpeciesStatus, string> = {
  Estable: 'Disponible',
  Vulnerable: 'En arranque',
  'En peligro': 'Cupo limitado',
  Crítico: 'Premium',
};

interface ReelItem extends Species {
  reelKey: string;
}

/**
 * SpeciesMarquee — capítulo 02 "Lo que ofrecemos". Carrusel CSS infinito de
 * cards de servicio (10 únicos × 2 = 20 frames) con duración 50s. Antes
 * mostraba especies con foto; ahora muestra servicios con icono + texto.
 *
 * El loop seamless funciona igual: lista duplicada → keyframe -50% → al
 * volver a 0 los frames visibles son los mismos. Velocidad y composición
 * viven en SCSS / `_keyframes.scss`.
 */
@Component({
  selector: 'app-species-marquee',
  imports: [Eyebrow, NgIcon, RevealDirective],
  providers: [
    provideIcons({
      phosphorBrowsersBold,
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
    })),
  );

  protected statusToneAttr(status: SpeciesStatus): string {
    return STATUS_TONES[status];
  }

  protected statusLabel(status: SpeciesStatus): string {
    return STATUS_LABEL[status];
  }
}
