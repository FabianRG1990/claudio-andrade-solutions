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
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
}

const PROGRAMS: ReadonlyArray<Program> = [
  {
    code: 'CS-01',
    title: 'Plataforma de proveedores · retail enterprise',
    region: 'Sector retail · LATAM',
    body: 'Sistema de conciliación automatizada para proveedores Walmart con integración Retail Link, OTIF tracking y forecast assist. 4 países, 80+ usuarios concurrentes, sin un downtime crítico desde el go-live.',
    image: 'https://picsum.photos/seed/cas-pr1/1200/900',
    accent: 'coral',
  },
  {
    code: 'CS-02',
    title: 'Asistente IA · soporte interno',
    region: 'Empresa de logística · México',
    body: 'Agente Claude con RAG sobre 14.000 documentos internos: políticas, procedimientos y casuística. Resuelve el 62 % de las consultas L1 sin escalado humano y aprende de cada feedback.',
    image: 'https://picsum.photos/seed/cas-pr2/1200/900',
    accent: 'bioluminescent',
  },
  {
    code: 'CS-03',
    title: 'Auditoría tecnológica · fintech regional',
    region: 'Sector fintech · Centroamérica',
    body: 'Diagnóstico completo de stack legacy. Identificamos 26 puntos de riesgo y un roadmap de migración a Angular + Firebase priorizado por impacto. Ahorro proyectado: 38 % anual en infra.',
    image: 'https://picsum.photos/seed/cas-pr3/1200/900',
    accent: 'lagoon',
  },
  {
    code: 'CS-04',
    title: 'Landing premium + analytics',
    region: 'B2B SaaS · Costa Rica',
    body: 'Página de marca construida desde cero con animaciones canvas y glass-morphism real. Lighthouse 98, conversión a demo +47 % vs. la versión anterior, todo el deploy en Firebase Hosting.',
    image: 'https://picsum.photos/seed/cas-pr4/1200/900',
    accent: 'kelp',
  },
];

/**
 * EspeciesPage — página "Acerca de nosotros". Header con manifiesto de la
 * empresa + grid de 4 casos recientes. El componente conserva el nombre
 * "EspeciesPage" por inercia con el routing; conceptualmente es About Us.
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
