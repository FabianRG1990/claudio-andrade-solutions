import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorBracketsCurlyBold,
  phosphorBrowsersBold,
  phosphorChartScatterBold,
  phosphorCheckBold,
  phosphorCloudArrowUpBold,
  phosphorCpuBold,
  phosphorDatabaseBold,
  phosphorDevicesBold,
  phosphorFileCodeBold,
  phosphorGearSixBold,
  phosphorRobotBold,
} from '@ng-icons/phosphor-icons/bold';
import { phosphorClock } from '@ng-icons/phosphor-icons/regular';

import { Service, ServiceStatus, services } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

// `ServiceStatus` se mapea a tonos SCSS y etiquetas humanas para el chip
// de la card.
const STATUS_TONES: Record<ServiceStatus, string> = {
  Estable: 'estable',          // verde · disponible al instante
  Vulnerable: 'vulnerable',    // coral suave · arrancando
  'En peligro': 'en-peligro',  // coral · cupo limitado
  Crítico: 'critico',          // coral intenso · premium
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  Estable: 'Disponible',
  Vulnerable: 'En arranque',
  'En peligro': 'Cupo limitado',
  Crítico: 'Premium',
};

interface ReelItem extends Service {
  reelKey: string;
  // sequence: "01", "02", ..., "10". Calculado a partir del índice módulo
  // total de servicios — así el segundo set duplicado vuelve a 01..10 y
  // el lector ve la misma numeración cada vuelta del carrusel.
  sequence: string;
}

/**
 * ServicesMarquee — capítulo 02 "Lo que ofrecemos". Carrusel infinito con
 * cards premium estilo glass-shell + glass-core (mismo lenguaje que las
 * tarjetas de engagements) más un halo de color por categoría que vive en
 * la esquina superior. Sin imágenes: la lectura es 100 % editorial — icono
 * grande, número de secuencia, nombre, tagline y dos highlights con check.
 *
 * El loop CSS sigue funcionando igual: `[...services, ...services]` duplica
 * la lista, el keyframe -50% recorre las 10 únicas y al volver a 0 los
 * frames 11..20 son réplicas exactas → loop seamless.
 */
@Component({
  selector: 'app-services-marquee',
  imports: [Eyebrow, NgIcon, RevealDirective, CompanionDockDirective],
  providers: [
    provideIcons({
      phosphorBracketsCurlyBold,
      phosphorBrowsersBold,
      phosphorChartScatterBold,
      phosphorCheckBold,
      phosphorClock,
      phosphorCloudArrowUpBold,
      phosphorCpuBold,
      phosphorDatabaseBold,
      phosphorDevicesBold,
      phosphorFileCodeBold,
      phosphorGearSixBold,
      phosphorRobotBold,
    }),
  ],
  templateUrl: './services-marquee.html',
  styleUrl: './services-marquee.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesMarquee {
  protected readonly reel = computed<ReelItem[]>(() =>
    [...services, ...services].map((sp, i) => ({
      ...sp,
      reelKey: `${sp.slug}-${i}`,
      sequence: `${(i % services.length) + 1}`.padStart(2, '0'),
    })),
  );

  protected statusToneAttr(status: ServiceStatus): string {
    return STATUS_TONES[status];
  }

  protected statusLabel(status: ServiceStatus): string {
    return STATUS_LABEL[status];
  }
}
