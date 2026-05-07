import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorWhatsappLogoBold } from '@ng-icons/phosphor-icons/bold';

import { EmblemMark } from '../../components/brand-mark/emblem-mark';

interface NavLink {
  readonly label: string;
  readonly href: string;
}

/**
 * Footer — shell inferior compacto. Brand reducido a emblema + meta inline,
 * nav horizontal y bottom bar de una línea (en desktop). Antes usaba el
 * BrandLockup 150×180 — sumaba ~180px de altura solo por la marca; el
 * emblema 36px transmite la misma identidad ocupando 5× menos espacio.
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink, NgIcon, EmblemMark],
  providers: [provideIcons({ phosphorWhatsappLogoBold })],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Footer {
  protected readonly currentYear = new Date().getFullYear();
  // Número de WhatsApp del negocio. wa.me requiere el formato sin "+" ni
  // espacios — el display sí los lleva para legibilidad.
  protected readonly whatsappNumber = '+506 7209 1418';
  protected readonly whatsappHref = 'https://wa.me/50672091418';

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
