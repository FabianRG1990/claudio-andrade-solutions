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
    body: 'Sistema de conciliación automatizada para proveedores Walmart con integración Retail Link, seguimiento OTIF y forecast assist. 4 países, 80+ usuarios concurrentes, sin una caída crítica desde el lanzamiento.',
    image: '/casos/caso-01-walmart.png',
    accent: 'coral',
  },
  {
    code: 'CS-02',
    title: 'Asistente IA · soporte interno',
    region: 'Empresa de logística · México',
    body: 'Agente Claude con RAG sobre 14.000 documentos internos: políticas, procedimientos y casuística. Resuelve el 62 % de las consultas L1 sin escalado humano y aprende de cada feedback.',
    image: '/casos/caso-02-ia-soporte.png',
    accent: 'bioluminescent',
  },
  {
    code: 'CS-03',
    title: 'Auditoría tecnológica · fintech regional',
    region: 'Sector fintech · Centroamérica',
    body: 'Diagnóstico completo de stack heredado. Identificamos 26 puntos de riesgo y una hoja de ruta de migración a Angular + Firebase priorizada por impacto. Ahorro proyectado: 38 % anual en infraestructura.',
    image: '/casos/caso-03-auditoria-fintech.png',
    accent: 'lagoon',
  },
  {
    code: 'CS-04',
    title: 'Landing premium + analytics',
    region: 'B2B SaaS · Costa Rica',
    body: 'Página de marca construida desde cero con animaciones canvas y glass-morphism real. Lighthouse 98, conversión a demo +47 % vs. la versión anterior, todo el despliegue en Firebase Hosting.',
    image: '/casos/caso-04-landing-premium.png',
    accent: 'kelp',
  },
];

/**
 * NosotrosPage — página "Acerca de nosotros". Header con manifiesto de la
 * empresa + grid de 4 casos recientes.
 */
@Component({
  selector: 'app-nosotros-page',
  imports: [ImgFadeDirective, PageHeader, RevealDirective],
  templateUrl: './nosotros.html',
  styleUrl: './nosotros.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NosotrosPage {
  protected readonly programs = PROGRAMS;
}
