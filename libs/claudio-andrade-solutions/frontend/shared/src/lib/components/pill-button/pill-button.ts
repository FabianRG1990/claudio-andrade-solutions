import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { phosphorArrowUpRightBold } from '@ng-icons/phosphor-icons/bold';

/**
 * PillButton — botón con cápsula glass-bubble + esfera glass-bubble-icon
 * para el icono. Renderiza `<a>` con routerLink si se da `href`, o
 * `<button>` si solo hay handler.
 *
 * El icono por defecto es ArrowUpRight (bold). Para sobrescribir, proyecta
 * un `<ng-icon pillIcon name="...">` o un SVG dentro del slot `[pillIcon]`.
 */
@Component({
  selector: 'app-pill-button',
  imports: [RouterLink, NgIcon, NgTemplateOutlet],
  providers: [provideIcons({ phosphorArrowUpRightBold })],
  templateUrl: './pill-button.html',
  styleUrl: './pill-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PillButton {
  readonly href = input<string | undefined>(undefined);
  readonly type = input<'button' | 'submit'>('button');
  readonly clicked = output<void>();
}
