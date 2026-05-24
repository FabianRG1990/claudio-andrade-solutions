import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowUpRightBold,
  phosphorBrowsersBold,
} from '@ng-icons/phosphor-icons/bold';
import {
  phosphorClock,
  phosphorMapPin,
  phosphorTicket,
} from '@ng-icons/phosphor-icons/regular';

import { availability } from '@cas-ui-shared/data/data';
import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';
import { CompanionDockDirective } from '@cas-ui-shared/companion/companion-dock.directive';

/**
 * Availability — capítulo 05 "Empezar". Columna izquierda sticky con
 * manifiesto + CTAs (pedir reunión, ver productos); columna derecha con 3
 * cards informativas: disponibilidad para discovery, operación remota, y la
 * propuesta del discovery sin costo.
 */
@Component({
  selector: 'app-availability',
  imports: [RouterLink, NgIcon, Eyebrow, RevealDirective, CompanionDockDirective],
  providers: [
    provideIcons({
      phosphorArrowUpRightBold,
      phosphorBrowsersBold,
      phosphorClock,
      phosphorMapPin,
      phosphorTicket,
    }),
  ],
  templateUrl: './availability.html',
  styleUrl: './availability.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Availability {
  protected readonly availability = availability;
}
