import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * CausticBg — tres orbes de luz cáustica desenfocados, animados con
 * `animate-caustic` (definido en _keyframes.scss). Capa decorativa, vive
 * detrás del contenido textual.
 */
@Component({
  selector: 'app-caustic-bg',
  templateUrl: './caustic-bg.html',
  styleUrl: './caustic-bg.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CausticBg {}
