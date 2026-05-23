import { ChangeDetectionStrategy, Component } from '@angular/core';
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

  // Tres contactos de WhatsApp para el footer. Por ahora solo el primero
  // está ligado (Claudio Andrade). Los otros dos se completarán cuando el
  // usuario provea los números — `href: null` los marca como pendientes y
  // el template los renderiza sin atributo `href` (no son clicables) pero
  // mantienen el estilo del card.
  protected readonly whatsappContacts: readonly WhatsappContact[] = [
    {
      id: 'claudio',
      name: 'Claudio Andrade',
      href: 'https://wa.me/50672091418',
      aria: 'Contactar a Claudio Andrade por WhatsApp',
    },
    {
      id: 'contact-2',
      name: 'Próximamente',
      href: null,
      aria: 'Contacto de WhatsApp próximamente',
    },
    {
      id: 'contact-3',
      name: 'Próximamente',
      href: null,
      aria: 'Contacto de WhatsApp próximamente',
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
