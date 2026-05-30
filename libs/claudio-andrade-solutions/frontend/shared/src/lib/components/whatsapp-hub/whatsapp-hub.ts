import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  PLATFORM_ID,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowUpRightBold,
  phosphorWhatsappLogoBold,
} from '@ng-icons/phosphor-icons/bold';

interface WhatsappContact {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly initial: string;
  readonly href: string | null;
  readonly aria: string;
}

/**
 * WhatsappHub — trigger circular WhatsApp-green con popover de contactos.
 *
 * Vive en el footer (variante `lg`, 40px) y en el hero como CTA inline
 * (variante `sm`, 32px). El popover es idéntico en ambos casos: lista de
 * contactos con avatar, nombre, rol y flecha de salida a wa.me.
 *
 * Estado:
 *   • Click toggle abre/cierra el menu (fuente de verdad única — antes
 *     había `:hover` y `:focus-within` que peleaban con el click en touch).
 *   • Click fuera del hub cierra.
 *   • Escape cierra.
 */
@Component({
  selector: 'app-whatsapp-hub',
  imports: [NgIcon],
  providers: [
    provideIcons({ phosphorWhatsappLogoBold, phosphorArrowUpRightBold }),
  ],
  templateUrl: './whatsapp-hub.html',
  styleUrl: './whatsapp-hub.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappHub {
  // Tamaño del trigger. `lg` (40px) en footer; `sm` (32px) para CTA inline
  // (hero). El popover mantiene su tamaño en ambas variantes — no escala
  // con el trigger, vive en su propia capa.
  readonly size = input<'lg' | 'sm'>('lg');

  // Cuando true, el componente NO pinta el trigger circular verde. El caller
  // proyecta su propio trigger via <ng-content> y dispara `toggleMenu()` con
  // un template ref. Uso: pill buttons existentes (ej. "Pedir propuesta" en
  // /productos) que abren el mismo popover sin romper su lenguaje visual.
  readonly triggerless = input(false, { transform: (v: boolean | '') => v === '' || v === true });

  @HostBinding('class.whatsapp-hub--sm')
  protected get isSmall(): boolean {
    return this.size() === 'sm';
  }

  @HostBinding('class.whatsapp-hub--triggerless')
  protected get isTriggerless(): boolean {
    return this.triggerless();
  }

  protected readonly open = signal(false);
  // Read-only view del state — expuesta para que un trigger proyectado
  // (modo triggerless) pueda bindear aria-expanded desde el template ref.
  readonly isOpen = this.open.asReadonly();
  private readonly hub = viewChild<ElementRef<HTMLElement>>('hub');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    // Cada vez que el popover se abre, reposicionarlo viewport-aware:
    // anclar al lado donde haya más espacio horizontal y clamp dentro del
    // viewport para que NUNCA quede cortado. La caret se desplaza igual que
    // el popover para mantener la lectura "anclada al trigger".
    effect(() => {
      if (!this.open()) return;
      if (!isPlatformBrowser(this.platformId)) return;
      // rAF: dejar que Angular pinte la clase .is-open y el layout estabilice.
      requestAnimationFrame(() => this.adjustPopoverPosition());
    });
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  // Público — llamado desde un trigger proyectado (modo triggerless) o desde
  // el companion al iniciar swim para asegurar el estado del popover.
  toggleMenu(event?: Event): void {
    event?.stopPropagation();
    this.open.update((v) => !v);
  }

  close(): void {
    if (this.open()) this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const hub = this.hub()?.nativeElement;
    if (hub && hub.contains(event.target as Node)) return;
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    if (!this.open()) return;
    if (!isPlatformBrowser(this.platformId)) return;
    requestAnimationFrame(() => this.adjustPopoverPosition());
  }

  /**
   * Reposiciona el popover (`.whatsapp-hub__menu`) en función de la
   * posición REAL del trigger en el viewport. Reglas:
   *
   *   1. Anclar el popover al lado del trigger donde haya MÁS espacio
   *      horizontal. Si el trigger está en la mitad derecha → popover
   *      extiende a la izquierda (default). Si está en la mitad
   *      izquierda → extiende a la derecha.
   *   2. Clamp el popover dentro del viewport con un margen de seguridad
   *      (12px) en ambos lados. Esto garantiza que NUNCA quede cortado,
   *      sin importar dónde esté el trigger (companion ancla a docks que
   *      pueden estar cerca de cualquier borde).
   *   3. La caret se desplaza la misma cantidad que el popover para
   *      mantenerse apuntando al trigger. Si el shift es muy grande
   *      (caret se iría fuera del popover), se clampa cerca del borde.
   *
   * El método se invoca al abrir el menu y al resize. No se actualiza en
   * scroll: el popover vive dentro del pivot page-anchored, ambos se
   * mueven juntos con la página → su relación trigger↔popover no cambia
   * al scrollear.
   */
  private adjustPopoverPosition(): void {
    const menuEl = this.menu()?.nativeElement;
    const hubEl = this.hub()?.nativeElement;
    if (!menuEl || !hubEl) return;

    // Reset overrides previos para medir el ancho natural del popover.
    menuEl.style.right = '';
    menuEl.style.removeProperty('--caret-right');
    hubEl.classList.remove('whatsapp-hub--flipped');

    const hubRect = hubEl.getBoundingClientRect();
    const menuWidth = menuEl.offsetWidth;
    const menuHeight = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const SAFE = 12;
    const NATURAL_OFFSET = 4; // matchea el `right: -0.25rem` del SCSS
    const VERTICAL_GAP = 12; // matchea el `0.75rem` del SCSS

    // ─── Eje vertical: flip arriba/abajo si no entra arriba ──────────
    // Default: popover arriba del trigger (bottom anchor). Si arriba no
    // entra y abajo sí, flip. Si ninguno entra, ir al lado con más espacio.
    const popoverTopIfUp = hubRect.top - VERTICAL_GAP - menuHeight;
    const popoverBottomIfDown = hubRect.bottom + VERTICAL_GAP + menuHeight;
    const fitsUp = popoverTopIfUp >= SAFE;
    const fitsDown = popoverBottomIfDown <= vh - SAFE;
    let flipped = false;
    if (!fitsUp && fitsDown) {
      flipped = true;
    } else if (!fitsUp && !fitsDown) {
      const spaceUp = hubRect.top;
      const spaceDown = vh - hubRect.bottom;
      flipped = spaceDown > spaceUp;
    }
    if (flipped) hubEl.classList.add('whatsapp-hub--flipped');

    // Posición natural: borde derecho del popover 4px afuera del borde
    // derecho del hub (extiende hacia la izquierda).
    const naturalPopoverRight = hubRect.right + NATURAL_OFFSET;

    // Decidir el lado preferido según dónde haya más espacio.
    const triggerCenterX = (hubRect.left + hubRect.right) / 2;
    const spaceLeft = triggerCenterX;
    const spaceRight = vw - triggerCenterX;
    let desiredPopoverRight: number;
    if (spaceLeft >= spaceRight) {
      // Más espacio a la izquierda → extiende a la izquierda (default).
      desiredPopoverRight = naturalPopoverRight;
    } else {
      // Más espacio a la derecha → extiende a la derecha. Anclar el borde
      // izquierdo del popover al borde izquierdo del hub menos el offset.
      const desiredPopoverLeft = hubRect.left - NATURAL_OFFSET;
      desiredPopoverRight = desiredPopoverLeft + menuWidth;
    }

    // Clamp final dentro del viewport con margen de seguridad.
    const minRight = SAFE + menuWidth;
    const maxRight = vw - SAFE;
    if (desiredPopoverRight < minRight) desiredPopoverRight = minRight;
    if (desiredPopoverRight > maxRight) desiredPopoverRight = maxRight;

    // shiftRight > 0 = popover empujado a la derecha respecto al default.
    const shiftRight = desiredPopoverRight - naturalPopoverRight;
    if (Math.abs(shiftRight) < 0.5) return; // ya está en su lugar natural

    // CSS `right` relativo al hub: más negativo = popover más a la derecha.
    menuEl.style.right = `${-NATURAL_OFFSET - shiftRight}px`;

    // Mover la caret la misma cantidad para que siga apuntando al trigger.
    // Natural CSS right de la caret: 14px. Si el popover se mueve N px a
    // la derecha, la caret debe alejarse N px del borde derecho (right
    // value aumenta).
    const NATURAL_CARET_RIGHT = 14;
    const CARET_EDGE_PAD = 12;
    const CARET_WIDTH = 10;
    const desiredCaretRight = NATURAL_CARET_RIGHT + shiftRight;
    const clampedCaretRight = Math.max(
      CARET_EDGE_PAD,
      Math.min(menuWidth - CARET_EDGE_PAD - CARET_WIDTH, desiredCaretRight),
    );
    menuEl.style.setProperty('--caret-right', `${clampedCaretRight}px`);
  }

  protected readonly contacts: readonly WhatsappContact[] = [
    {
      id: 'claudio',
      name: 'Claudio Andrade',
      role: 'CEO y desarrollador',
      initial: 'C',
      href: 'https://wa.me/50672091418',
      aria: 'Contactar a Claudio Andrade por WhatsApp',
    },
    {
      id: 'fabian',
      name: 'Fabián Rodríguez',
      role: 'Diseñador y desarrollador',
      initial: 'F',
      href: 'https://wa.me/50689836762',
      aria: 'Contactar a Fabián Rodríguez por WhatsApp',
    },
    {
      id: 'krissia',
      name: 'Krissia Bolaños',
      role: 'Agente de ventas',
      initial: 'K',
      href: 'https://wa.me/50688780709',
      aria: 'Contactar a Krissia Bolaños por WhatsApp',
    },
  ];
}
