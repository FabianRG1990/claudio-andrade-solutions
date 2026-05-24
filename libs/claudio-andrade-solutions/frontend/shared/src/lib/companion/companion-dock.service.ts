import { Injectable, signal } from '@angular/core';

/**
 * Anchor registrado por la directiva `[appCompanionDock]`. El companion
 * lee la lista para decidir cuál anchor está activo según la posición de
 * scroll. El orden importa: refleja el orden DOM (primer registrado =
 * primero del documento) salvo que se especifique `order` explícito.
 */
export interface CompanionDock {
  readonly id: string;
  readonly el: HTMLElement;
  readonly label?: string;
  readonly order: number;
  // Offset horizontal (px) entre el borde derecho del anchor y el centro
  // del ícono del companion. Default: el companion usa su DOCK_OFFSET_X
  // global (16) si este campo viene undefined. Útil para eyebrows tipo
  // pill, donde el ícono queda pegado al borde redondeado si no hay
  // offset extra.
  readonly offsetX?: number;
}

/**
 * Registry global de docks. La directiva registra cada anchor en su
 * `ngOnInit` y lo des-registra en `ngOnDestroy`. El companion suscribe
 * al signal `docks()` para reaccionar a cambios (mount/unmount de
 * secciones, route changes).
 *
 * Sin DI factory — instancia única `providedIn: 'root'`.
 */
@Injectable({ providedIn: 'root' })
export class CompanionDockRegistry {
  // Signal: la lista actual de docks ordenada por `order` ascendente.
  // Se re-emite cuando register/unregister modifica la lista.
  readonly docks = signal<readonly CompanionDock[]>([]);

  register(dock: CompanionDock): void {
    this.docks.update((prev) => {
      const next = prev.filter((d) => d.id !== dock.id).concat(dock);
      next.sort((a, b) => a.order - b.order);
      return next;
    });
  }

  unregister(id: string): void {
    this.docks.update((prev) => prev.filter((d) => d.id !== id));
  }
}
