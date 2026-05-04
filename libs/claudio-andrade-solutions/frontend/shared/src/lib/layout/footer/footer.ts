import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [RouterLink, EmblemMark],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Footer {
  protected readonly currentYear = new Date().getFullYear();

  protected readonly navLinks: readonly NavLink[] = [
    { label: 'Exhibiciones', href: '/exhibiciones' },
    { label: 'Galería', href: '/especies' },
    { label: 'Conservación', href: '/especies' },
    { label: 'Investigación', href: '/especies' },
    { label: 'Noche bioluminiscente', href: '/exhibiciones' },
  ];

  protected readonly metaItems: readonly string[] = [
    'Aviso legal',
    'Privacidad',
    'Sostenibilidad',
    'Prensa',
  ];
}
