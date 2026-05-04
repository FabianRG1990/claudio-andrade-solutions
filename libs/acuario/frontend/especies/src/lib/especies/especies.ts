import { ChangeDetectionStrategy, Component } from '@angular/core';

import { conservationStats, species } from '@acuario-ui-shared/data/data';
import { ImgFadeDirective } from '@acuario-ui-shared/directives/img-fade/img-fade.directive';
import { PageHeader } from '@acuario-ui-shared/components/page-header/page-header';
import { RevealDirective } from '@acuario-ui-shared/directives/reveal/reveal.directive';

interface Program {
  code: string;
  title: string;
  region: string;
  body: string;
  image: string;
}

const FILTERS = ['Todas', 'Pelágicas', 'Bentónicas', 'Abisales', 'Costeras'] as const;

const PROGRAMS: ReadonlyArray<Program> = [
  {
    code: 'PR-01',
    title: 'Reefscape · Cultivo de coral',
    region: 'Caribe · Tela, Honduras',
    body: 'Cultivamos 38 cepas de coral en laboratorio para repoblar arrecifes degradados. En 2025 reintroducimos 12.400 colonias.',
    image: 'https://picsum.photos/seed/acuario-pr1/1200/900',
  },
  {
    code: 'PR-02',
    title: 'Tortuga Verde · Rehabilitación',
    region: 'Pacífico · Guanacaste',
    body: 'Recibimos tortugas heridas por colisiones, redes fantasma y ingesta de plásticos. 2.612 ejemplares devueltos al mar desde 2003.',
    image: 'https://picsum.photos/seed/acuario-pr2/1200/900',
  },
  {
    code: 'PR-03',
    title: 'Bioluminiscencia · Investigación',
    region: 'Mar abierto · 1.200 m',
    body: 'Cinco expediciones anuales para estudiar comunidades abisales. Todos los datasets se publican abiertos bajo licencia CC-BY.',
    image: 'https://picsum.photos/seed/acuario-pr3/1200/900',
  },
  {
    code: 'PR-04',
    title: 'Educación pública',
    region: 'Toda Centroamérica',
    body: '84 escuelas en programa anual. Cada estudiante visita el instituto al menos una vez sin costo durante el ciclo lectivo.',
    image: 'https://picsum.photos/seed/acuario-pr4/1200/900',
  },
];

/**
 * GaleriaPage — catálogo vivo de las 1.247 especies + bridge editorial a
 * conservación + stats de impacto + 4 programas activos. Replica las cuatro
 * secciones del `/especies` original sin perder un solo data point.
 */
@Component({
  selector: 'app-especies-page',
  imports: [ImgFadeDirective, PageHeader, RevealDirective],
  templateUrl: './especies.html',
  styleUrl: './especies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EspeciesPage {
  protected readonly species = species;
  protected readonly stats = conservationStats;
  protected readonly filters = FILTERS;
  protected readonly programs = PROGRAMS;

  protected statusToneClass(status: string): string {
    switch (status) {
      case 'Estable':
        return 'is-stable';
      case 'Vulnerable':
        return 'is-vulnerable';
      case 'En peligro':
        return 'is-endangered';
      case 'Crítico':
        return 'is-critical';
      default:
        return 'is-stable';
    }
  }

  protected imagePosition(sp: (typeof species)[number]): string {
    return sp.imagePosition ?? 'center 38%';
  }
}
