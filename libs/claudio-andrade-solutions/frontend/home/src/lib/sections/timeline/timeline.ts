import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  phosphorCloudCheckBold,
  phosphorCodeBlockBold,
  phosphorRobotBold,
  phosphorStackBold,
} from '@ng-icons/phosphor-icons/bold';

import { Eyebrow } from '@cas-ui-shared/components/eyebrow/eyebrow';
import { RevealDirective } from '@cas-ui-shared/directives/reveal/reveal.directive';

interface Milestone {
  year: string;
  body: string;
}

interface Stat {
  value: string;
  label: string;
}

interface Tech {
  name: string;
  category: string;
  icon: string;
  reason: string;
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
}

const STATS: ReadonlyArray<Stat> = [
  { value: '07', label: 'años de oficio' },
  { value: '04', label: 'países atendidos' },
  { value: '34', label: 'integraciones de IA' },
  { value: '99.97%', label: 'uptime promedio' },
];

const MILESTONES: ReadonlyArray<Milestone> = [
  { year: '2019', body: 'Fundación de la consultora. Primeros proyectos en e-commerce y portales corporativos.' },
  { year: '2021', body: 'Migración a Angular + Nx + Firebase como stack base. Primer monorepo enterprise.' },
  { year: '2023', body: 'Integraciones con Walmart Retail Link para 12 proveedores LATAM.' },
  { year: '2024', body: 'Lanzamiento de la práctica de IA: agentes Claude, RAG sobre documentación interna.' },
  { year: '2025', body: 'Equipo distribuido en 4 países. 80+ proyectos productivos sin un solo rollback crítico.' },
  { year: '2026', body: 'Lanzamiento del modelo Acompañamiento: CTO fraccional + soporte 24/7 para empresas en crecimiento.' },
];

// Tech stack — 4 pilares organizados por capa, con la razón concreta por
// la cual elegimos cada uno. Cada card pinta su propio accent (mismo
// sistema que las service-cards del capítulo 2) — el lector escanea el
// stack a velocidad de portada.
const TECH_STACK: ReadonlyArray<Tech> = [
  {
    name: 'Angular + TypeScript',
    category: 'Frontend',
    icon: 'phosphorCodeBlockBold',
    reason:
      'Type safety de extremo a extremo, signals para reactivity moderna y ecosistema enterprise con soporte LTS de Google. La base sobre la que armamos cada proyecto serio.',
    accent: 'lagoon',
  },
  {
    name: 'Nx + Yarn',
    category: 'Monorepo',
    icon: 'phosphorStackBold',
    reason:
      'Builds incrementales, código compartido entre apps y workspaces deterministas. Un solo repo, varios productos, sin duplicar lógica ni configuración.',
    accent: 'kelp',
  },
  {
    name: 'Firebase + Google Cloud',
    category: 'Infraestructura',
    icon: 'phosphorCloudCheckBold',
    reason:
      'Auth, Firestore en tiempo real, Cloud Run para tareas asíncronas y logs auditables. Despliegue en minutos, escalado automático y costos predecibles.',
    accent: 'bioluminescent',
  },
  {
    name: 'Claude · IA',
    category: 'Inteligencia',
    icon: 'phosphorRobotBold',
    reason:
      'Razonamiento avanzado, contexto largo y agentes con tool use. IA integrada al proceso real del negocio — no un complemento que se queda en demo.',
    accent: 'coral',
  },
];

/**
 * Timeline — última sección del home. Antes mostraba solo los 6 hitos del
 * proyecto en un grid plano. Ahora cuenta la historia completa:
 *   1. Header editorial · oficio + criterio
 *   2. Stats hero · 4 cifras de respaldo
 *   3. Hitos · timeline vertical con dots y linea de conexión
 *   4. Stack & por qué · 4 cards (lenguaje glass-shell+core, mismo que cap.2)
 *
 * El objetivo: cierre que comunica "trayectoria + tecnología elegida con
 * criterio" antes del footer. Lectura completa de quiénes somos.
 */
@Component({
  selector: 'app-timeline',
  imports: [Eyebrow, NgIcon, RevealDirective],
  providers: [
    provideIcons({
      phosphorCloudCheckBold,
      phosphorCodeBlockBold,
      phosphorRobotBold,
      phosphorStackBold,
    }),
  ],
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Timeline {
  protected readonly stats = STATS;
  protected readonly milestones = MILESTONES;
  protected readonly techStack = TECH_STACK;
}
