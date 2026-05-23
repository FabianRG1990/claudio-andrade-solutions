import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EmblemMark } from '../../components/brand-mark/emblem-mark';
import { WhatsappHub } from '../../components/whatsapp-hub/whatsapp-hub';

interface NavLink {
  readonly label: string;
  readonly href: string;
}

@Component({
  selector: 'app-footer',
  imports: [RouterLink, EmblemMark, WhatsappHub],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Footer {
  protected readonly currentYear = new Date().getFullYear();

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
