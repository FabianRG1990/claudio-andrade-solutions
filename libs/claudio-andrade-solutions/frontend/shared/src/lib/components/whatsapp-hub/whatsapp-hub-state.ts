import { Injectable, computed, signal } from '@angular/core';

/**
 * Estado global "¿hay algún WhatsappHub con el popover abierto?". Lo
 * consume el FloatingNav para ocultar el rail (pill + burger) mientras
 * la lista de contactos está desplegada — sin esto, el burger del navbar
 * tapa parte del popover cuando el companion está anclado a docks cerca
 * del top-right del viewport.
 *
 * Contador de instancias abiertas (no boolean) porque en teoría puede
 * haber más de un hub en pantalla (footer + companion). Mientras al
 * menos uno esté abierto, el navbar se oculta.
 */
@Injectable({ providedIn: 'root' })
export class WhatsappHubState {
  private readonly openCount = signal(0);
  readonly anyOpen = computed(() => this.openCount() > 0);

  notifyOpen(): void {
    this.openCount.update((c) => c + 1);
  }

  notifyClose(): void {
    this.openCount.update((c) => Math.max(0, c - 1));
  }
}
