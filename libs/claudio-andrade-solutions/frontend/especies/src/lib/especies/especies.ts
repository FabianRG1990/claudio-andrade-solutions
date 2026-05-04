import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ImgFadeDirective } from '@cas-ui-shared/directives/img-fade/img-fade.directive';
import { PageHeader } from '@cas-ui-shared/components/page-header/page-header';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

interface Program {
  code: string;
  title: string;
  region: string;
  body: string;
  image: string;
}

const PROGRAMS: ReadonlyArray<Program> = [
  {
    code: 'PR-01',
    title: 'Reefscape · Cultivo de coral',
    region: 'Caribe · Tela, Honduras',
    body: 'Cultivamos 38 cepas de coral en laboratorio para repoblar arrecifes degradados. En 2025 reintroducimos 12.400 colonias.',
    image: 'https://picsum.photos/seed/cas-pr1/1200/900',
  },
  {
    code: 'PR-02',
    title: 'Tortuga Verde · Rehabilitación',
    region: 'Pacífico · Guanacaste',
    body: 'Recibimos tortugas heridas por colisiones, redes fantasma y ingesta de plásticos. 2.612 ejemplares devueltos al mar desde 2003.',
    image: 'https://picsum.photos/seed/cas-pr2/1200/900',
  },
  {
    code: 'PR-03',
    title: 'Bioluminiscencia · Investigación',
    region: 'Mar abierto · 1.200 m',
    body: 'Cinco expediciones anuales para estudiar comunidades abisales. Todos los datasets se publican abiertos bajo licencia CC-BY.',
    image: 'https://picsum.photos/seed/cas-pr3/1200/900',
  },
  {
    code: 'PR-04',
    title: 'Educación pública',
    region: 'Toda Centroamérica',
    body: '84 escuelas en programa anual. Cada estudiante visita el instituto al menos una vez sin costo durante el ciclo lectivo.',
    image: 'https://picsum.photos/seed/cas-pr4/1200/900',
  },
];

/**
 * GaleriaPage — solo header + 4 programas activos. Antes tenía 4 segmentos
 * (catálogo de especies, bridge editorial, stats de impacto, programas);
 * los 3 primeros se quitaron por decisión de producto. Si vuelven a hacer
 * falta, el git history conserva la versión anterior.
 */
@Component({
  selector: 'app-especies-page',
  imports: [ImgFadeDirective, PageHeader, RevealDirective],
  templateUrl: './especies.html',
  styleUrl: './especies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EspeciesPage {
  protected readonly programs = PROGRAMS;
}
