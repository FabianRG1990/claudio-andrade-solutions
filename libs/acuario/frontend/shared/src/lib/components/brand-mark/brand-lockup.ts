import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * BrandLockup — marca completa: emblema + wordmark "AQUARIUM" + tagline.
 * Renderiza el PNG composite (`/logo/aquarium-logo.png`) sin recortes.
 */
@Component({
  selector: 'app-brand-lockup',
  templateUrl: './brand-lockup.html',
  styleUrl: './brand-lockup.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandLockup {
  readonly width = input(220);
  readonly height = input(260);
  readonly alt = input('Aquarium');
}
