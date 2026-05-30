import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  input,
  signal,
  viewChild,
} from '@angular/core';
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
