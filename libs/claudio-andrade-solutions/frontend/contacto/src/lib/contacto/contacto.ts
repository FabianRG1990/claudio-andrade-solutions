import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowRightBold } from '@ng-icons/phosphor-icons/bold';

import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

const SERVICES = [
  'Desarrollo Web',
  'Diseño UX/UI',
  'Branding',
  'Apps Móviles',
  'Motion Design',
] as const;

type Service = (typeof SERVICES)[number];

const BUDGETS = [
  '$2k – $5k',
  '$5k – $10k',
  '$10k – $20k',
  '$30k – $40k',
  '$50k+',
] as const;

type Budget = (typeof BUDGETS)[number];

/**
 * ContactoPage — formulario de solicitud con chip-selectors.
 * Layout: header centrado + 2 columnas (form izq · selectors der).
 * El servicio + presupuesto seleccionados viven en signals (single-select
 * por grupo) — al hacer submit irían adjuntos al payload del form.
 */
@Component({
  selector: 'app-contacto-page',
  imports: [Eyebrow, NgIcon, RevealDirective],
  providers: [provideIcons({ phosphorArrowRightBold })],
  templateUrl: './contacto.html',
  styleUrl: './contacto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactoPage {
  protected readonly services = SERVICES;
  protected readonly budgets = BUDGETS;

  // Pre-selected como en la imagen de referencia: primer servicio + primer
  // presupuesto. El usuario puede tocar otro chip para cambiar (single-select).
  protected readonly selectedService = signal<Service>(SERVICES[0]);
  protected readonly selectedBudget = signal<Budget>(BUDGETS[0]);

  protected selectService(s: Service): void {
    this.selectedService.set(s);
  }

  protected selectBudget(b: Budget): void {
    this.selectedBudget.set(b);
  }
}
