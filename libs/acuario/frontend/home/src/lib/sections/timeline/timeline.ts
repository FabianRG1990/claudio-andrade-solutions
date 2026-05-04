import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Eyebrow } from '@acuario-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';

interface Milestone {
  year: string;
  body: string;
}

const MILESTONES: ReadonlyArray<Milestone> = [
  { year: '1992', body: 'Fundación del instituto. Primer tanque de manglar.' },
  { year: '2003', body: 'Programa de rehabilitación de tortugas marinas.' },
  { year: '2011', body: 'Apertura del Túnel Azul · 60 m de inmersión.' },
  { year: '2018', body: 'Laboratorio coralino. Primeras cepas reintroducidas.' },
  { year: '2024', body: 'Galería Abismo Pacífico · 1.840 m simulados.' },
  { year: '2026', body: 'Reserva marina propia · 38.420 ha protegidas.' },
];

/**
 * Timeline — 6 hitos del instituto, presentados en grid responsive con
 * stagger. Cada hito: año en serif grande + cuerpo descriptivo.
 */
@Component({
  selector: 'app-timeline',
  imports: [Eyebrow, RevealDirective],
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Timeline {
  protected readonly milestones = MILESTONES;
}
