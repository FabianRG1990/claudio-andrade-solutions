import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

interface Milestone {
  year: string;
  body: string;
}

const MILESTONES: ReadonlyArray<Milestone> = [
  { year: '2019', body: 'Fundación de la consultora. Primeros proyectos en e-commerce y portales corporativos.' },
  { year: '2021', body: 'Migración a Angular + Nx + Firebase como stack base. Primer monorepo enterprise.' },
  { year: '2023', body: 'Integraciones con Walmart Retail Link para 12 proveedores LATAM.' },
  { year: '2024', body: 'Lanzamiento de la práctica de IA: agentes Claude, RAG sobre documentación interna.' },
  { year: '2025', body: 'Equipo distribuido en 4 países. 80+ proyectos productivos sin un solo rollback crítico.' },
  { year: '2026', body: 'Lanzamiento del modelo Acompañamiento: CTO fraccional + soporte 24/7 para empresas en crecimiento.' },
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
