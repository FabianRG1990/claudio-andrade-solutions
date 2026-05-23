import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorArrowUpRightBold,
  phosphorWhatsappLogoBold,
} from '@ng-icons/phosphor-icons/bold';

import { EmblemMark } from '../../components/brand-mark/emblem-mark';

interface NavLink {
  readonly label: string;
  readonly href: string;
}

interface WhatsappContact {
  readonly id: string;
  readonly name: string;
  // Rol o descripción corta del contacto — sale debajo del nombre en
  // itálica dentro del popover (ej. "CEO y desarrollador").
  readonly role: string;
  // Inicial del contacto para el avatar circular (1-2 letras). Mantener
  // en mayúscula para que el círculo se vea consistente.
  readonly initial: string;
  readonly href: string | null;
  readonly aria: string;
}

@Component({
  selector: 'app-footer',
  imports: [RouterLink, NgIcon, EmblemMark],
  providers: [
    provideIcons({ phosphorWhatsappLogoBold, phosphorArrowUpRightBold }),
  ],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Footer {
  protected readonly currentYear = new Date().getFullYear();

  // Estado del popover de WhatsApp. Antes la apertura era CSS-only via
  // `:hover` + `:focus-within`, pero en touch el segundo tap no cerraba el
  // menu porque el button conservaba el foco y `:focus-within` seguía true.
  // Ahora el click es la fuente de verdad — toggle limpio en cualquier
  // dispositivo. El hover sigue funcionando en desktop (regla `:hover` en
  // SCSS) como apertura sin click; el cierre por hover-out lo gestiona la
  // misma regla CSS. En touch solo aplica el toggle.
  protected readonly whatsappOpen = signal(false);
  private readonly whatsappHub =
    viewChild<ElementRef<HTMLElement>>('whatsappHub');

  protected toggleWhatsapp(event: Event): void {
    event.stopPropagation();
    this.whatsappOpen.update((v) => !v);
  }

  protected closeWhatsapp(): void {
    if (this.whatsappOpen()) this.whatsappOpen.set(false);
  }

  // Click fuera del hub cierra el popover. Click dentro (incluso en un
  // contact link <a>) no cierra — el target del link es manejado por su
  // propio comportamiento (abre WhatsApp en nueva pestaña).
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.whatsappOpen()) return;
    const hub = this.whatsappHub()?.nativeElement;
    if (hub && hub.contains(event.target as Node)) return;
    this.whatsappOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closeWhatsapp();
  }

  // Tres contactos de WhatsApp para el footer. Cada contacto se renderiza
  // dentro del popover como un card premium: avatar circular con inicial +
  // status dot bioluminescent, nombre, rol en itálica, y flecha (si está
  // ligado) o tag "Pronto" (si está pendiente). Solo el primero está
  // ligado por ahora; los otros dos se completan cuando el usuario provea
  // los números.
  protected readonly whatsappContacts: readonly WhatsappContact[] = [
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

  protected readonly navLinks: readonly NavLink[] = [
    { label: 'Productos', href: '/productos' },
    { label: 'Casos', href: '/nosotros' },
    { label: 'Acerca de nosotros', href: '/nosotros' },
    { label: 'Auditoría', href: '/contacto' },
    { label: 'Contáctenos', href: '/contacto' },
  ];

  protected readonly metaItems: readonly string[] = [
    'Aviso legal',
    'Privacidad',
    'Términos',
    'Prensa',
  ];
}
