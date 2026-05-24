import {
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  inject,
  input,
} from '@angular/core';

import { CompanionDockRegistry } from './companion-dock.service';

let DOCK_AUTO_ID = 0;

/**
 * Marca un elemento como dock anchor para el WhatsappCompanion. El
 * companion se anclará al borde derecho del elemento marcado y nadará
 * de uno a otro al cambiar el dock activo según el scroll.
 *
 * Uso típico sobre el título de una sección:
 *   <h2 appCompanionDock="cap-01" order="10">Seis productos.</h2>
 *
 * `order` define la posición lógica en la secuencia de docks. Si dos
 * docks comparten `order`, el orden DOM resuelve. Usar incrementos
 * grandes (10, 20, 30...) deja espacio para insertar docks entre dos
 * existentes sin renumerar todo.
 */
@Directive({
  selector: '[appCompanionDock]',
  standalone: true,
})
export class CompanionDockDirective implements OnInit, OnDestroy {
  private readonly registry = inject(CompanionDockRegistry);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  // ID del dock (opcional). Se usa para tracking + debugging. Si no se
  // pasa, se asigna uno auto-incremental.
  readonly appCompanionDock = input<string>('');

  // Orden lógico en la secuencia de docks. Default 0 = se inserta al
  // inicio. El companion ordena por `order` ascendente.
  readonly order = input<number>(0);

  // Label opcional — solo para debug / a11y. No se renderiza.
  readonly label = input<string>('');

  // Offset horizontal del centro del ícono respecto al borde derecho del
  // anchor. Si no se pasa, el companion usa su default (16). Para anchors
  // que son pills con padding (ej. <app-eyebrow>), pasar un valor mayor
  // (~28) para que el ícono no quede pegado al borde redondeado.
  readonly offsetX = input<number | null>(null);

  private id = '';

  ngOnInit(): void {
    this.id = this.appCompanionDock() || `dock-${++DOCK_AUTO_ID}`;
    const offset = this.offsetX();
    this.registry.register({
      id: this.id,
      el: this.elementRef.nativeElement,
      label: this.label() || undefined,
      order: this.order(),
      offsetX: offset === null ? undefined : offset,
    });
  }

  ngOnDestroy(): void {
    this.registry.unregister(this.id);
  }
}
