// =============================================================================
// data — fuente única de contenido del sitio.
//
// Antes este módulo describía un acuario (especies, biomas, conservación).
// Hoy describe Claudio Andrade Solutions: una consultora tecnológica que
// vende soluciones a medida — auditorías, sistemas, IA, automatización,
// landing pages premium, integraciones con el ecosistema Walmart.
//
// Los nombres de los tipos (`Exhibit`, `Species`, `ConservationStat`,
// `Ticket`) se conservan por inercia con los componentes existentes; lo
// que cambia es el contenido y el campo `image` apunta a las assets viejas
// hasta que las reemplacemos. Los componentes consumen `name`, `description`,
// `accent`, `status`, etc. — la semántica visual se mantiene; solo la
// narrativa cambia de "ecosistemas marinos" a "soluciones tecnológicas".
// =============================================================================

// ---- Productos ------------------------------------------------------------
// `Exhibit` se reutiliza como tipo "Producto/Solución". Cada card tiene un
// nombre, una categoría (`zone`), un timeline estimado (`depth`), un par de
// métricas (`species` = entregables, `liters` = cobertura) y una descripción
// corta. El `accent` controla los tintes en la UI existente.
export type Exhibit = {
  slug: string;
  name: string;
  zone: string;        // categoría (Auditoría, Sistema, IA, etc.)
  depth: string;       // timeline estimado (2-4 sem, 12+ sem...)
  species: number;     // entregables / módulos
  liters: string;      // cobertura / escala
  description: string;
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
  image: string;
};

export const exhibits: Exhibit[] = [
  {
    slug: 'auditoria-tecnologica',
    name: 'Auditoría tecnológica',
    zone: 'Discovery',
    depth: '2 — 4 semanas',
    species: 14,
    liters: '360°',
    description:
      'Diagnóstico completo del stack, los flujos y los procesos. Detectamos qué automatizar, qué reescribir y qué dejar quieto — con un mapa accionable y prioridades claras.',
    accent: 'lagoon',
    image: '/biomas/abismo-pacifico.png',
  },
  {
    slug: 'sistemas-a-medida',
    name: 'Sistemas a medida',
    zone: 'Build',
    depth: '12 — 24 semanas',
    species: 32,
    liters: '∞',
    description:
      'Plataformas internas, ERPs ligeros, dashboards de operaciones. Angular + Nx + Firebase, monorepo escalable, deploy continuo. Construidos para crecer con la empresa.',
    accent: 'kelp',
    image: '/biomas/bosque-de-kelp.png',
  },
  {
    slug: 'integraciones-ia',
    name: 'Integraciones de IA',
    zone: 'Inteligencia',
    depth: '4 — 10 semanas',
    species: 18,
    liters: 'Multi-modelo',
    description:
      'Agentes Claude, RAG sobre documentación interna, asistentes de soporte, generación de contenido y automatización de tickets. La IA pegada a tu proceso real.',
    accent: 'bioluminescent',
    image: '/biomas/arrecife-de-coral.png',
  },
  {
    slug: 'apps-walmart',
    name: 'Apps proveedores Walmart',
    zone: 'Vertical',
    depth: '6 — 12 semanas',
    species: 22,
    liters: 'Retail Link',
    description:
      'Aplicaciones específicas para proveedores: integración con Retail Link, OTIF, scorecards, forecast assist y conciliación automática. Built once, escala por SKU.',
    accent: 'coral',
    image: '/biomas/tunel-azul.png',
  },
  {
    slug: 'landing-premium',
    name: 'Landing premium',
    zone: 'Brand',
    depth: '3 — 6 semanas',
    species: 9,
    liters: 'Lighthouse 95+',
    description:
      'Páginas de marca con presupuesto editorial — animaciones canvas, glass-morphism real, performance auditado. La que estás viendo es de las nuestras.',
    accent: 'lagoon',
    image: '/biomas/manglar.png',
  },
  {
    slug: 'automatizacion-procesos',
    name: 'Automatización de procesos',
    zone: 'Operaciones',
    depth: '4 — 8 semanas',
    species: 16,
    liters: 'n8n · Zapier · Make',
    description:
      'Pipelines que conectan tus herramientas — ETL ligeros, sync entre sistemas, alertas inteligentes. Reducimos trabajo manual sin reemplazar lo que ya funciona.',
    accent: 'kelp',
    image: '/biomas/polo-sur.png',
  },
];

// ---- Servicios (carrusel del home) ----------------------------------------
// `Species` se reutiliza como "Service" dentro del marquee del home: el
// componente ya consume `common`, `scientific`, `habitat`, `status`, `depth`.
// Re-mapeo conceptual:
//   common      → nombre del servicio
//   scientific  → tagline editorial
//   habitat     → categoría
//   status      → estado/etiqueta de disponibilidad
//   depth       → alcance/escala
//   diet        → entregable principal
//   image       → reutilizada como icono de fallback (no se mostrará en el card)
//
// Se agrega `icon` para el ng-icon que reemplaza la imagen.
export type SpeciesStatus = 'Estable' | 'Vulnerable' | 'En peligro' | 'Crítico';

export type Species = {
  slug: string;
  common: string;
  scientific: string;
  habitat: string;
  status: SpeciesStatus;
  depth: string;
  diet: string;
  image: string;
  imagePosition?: string;
  icon?: string;
};

// Status → mapping a "tono" visual existente:
//   'Estable'    = Disponible      (kelp / verde — todo verde, listo para arrancar)
//   'Vulnerable' = En arranque     (coral suave — recién lanzado)
//   'En peligro' = Cupo limitado   (coral fuerte — pocas plazas)
//   'Crítico'    = Premium         (coral intenso — el caro)
// El mapping es un detalle de UI; los strings los lee `STATUS_TONES` en el
// marquee.
export const species: Species[] = [
  {
    slug: 'auditoria-tech',
    common: 'Auditoría tecnológica',
    scientific: 'Diagnóstico 360°',
    habitat: 'Discovery',
    status: 'Estable',
    depth: '2 — 4 sem',
    diet: 'Roadmap accionable',
    image: '/especies/tiburon-ballena.jpg',
    icon: 'phosphorMagnifyingGlassBold',
  },
  {
    slug: 'sistemas-medida',
    common: 'Sistemas a medida',
    scientific: 'Plataformas internas · ERP ligero',
    habitat: 'Build',
    status: 'Estable',
    depth: '12+ sem',
    diet: 'App productiva en 90 días',
    image: '/especies/pulpo-mimo.jpg',
    icon: 'phosphorTerminalWindowBold',
  },
  {
    slug: 'integraciones-ia',
    common: 'Integraciones de IA',
    scientific: 'Agentes Claude · RAG · Automatización',
    habitat: 'Inteligencia',
    status: 'Vulnerable',
    depth: '4 — 10 sem',
    diet: 'Workflows con IA en producción',
    image: '/especies/medusa-luna.jpg',
    icon: 'phosphorRobotBold',
  },
  {
    slug: 'apps-walmart',
    common: 'Apps proveedores Walmart',
    scientific: 'Retail Link · OTIF · Forecast',
    habitat: 'Vertical · Retail',
    status: 'En peligro',
    depth: '6 — 12 sem',
    diet: 'Conciliación automatizada',
    image: '/especies/pez-dragon.jpg',
    icon: 'phosphorShoppingBagBold',
  },
  {
    slug: 'landing-premium',
    common: 'Landing premium',
    scientific: 'Marca, performance, conversión',
    habitat: 'Brand',
    status: 'Estable',
    depth: '3 — 6 sem',
    diet: 'Lighthouse 95+ garantizado',
    image: '/especies/manta-gigante.jpg',
    icon: 'phosphorBrowsersBold',
  },
  {
    slug: 'apps-moviles',
    common: 'Apps móviles',
    scientific: 'iOS · Android · Multiplataforma',
    habitat: 'Mobile',
    status: 'Vulnerable',
    depth: '8 — 16 sem',
    diet: 'Stores listos en una entrega',
    image: '/especies/caballito-leafy.png',
    icon: 'phosphorDeviceMobileBold',
  },
  {
    slug: 'analisis-flujos',
    common: 'Análisis de flujos',
    scientific: 'Procesos · Métricas · Cuellos de botella',
    habitat: 'Operaciones',
    status: 'Estable',
    depth: '2 — 6 sem',
    diet: 'Mapa de fricciones priorizado',
    image: '/especies/calamar-vampiro.webp',
    icon: 'phosphorFlowArrowBold',
  },
  {
    slug: 'automatizacion',
    common: 'Automatización',
    scientific: 'ETL · Webhooks · Pipelines',
    habitat: 'Integración',
    status: 'Estable',
    depth: '4 — 8 sem',
    diet: 'Horas-hombre liberadas',
    image: '/especies/nudibranquio-azul.jpg',
    icon: 'phosphorLightningBold',
  },
  {
    slug: 'consultoria-cloud',
    common: 'Consultoría cloud',
    scientific: 'Firebase · Google Cloud · Edge',
    habitat: 'Infraestructura',
    status: 'Estable',
    depth: '2 — 8 sem',
    diet: 'Costos optimizados, deploys verdes',
    image: '/especies/tiburon-ballena.jpg',
    icon: 'phosphorCloudCheckBold',
  },
  {
    slug: 'consultoria-estrategica',
    common: 'Consultoría estratégica',
    scientific: 'CTO fraccional · Acompañamiento',
    habitat: 'Advisory',
    status: 'En peligro',
    depth: 'Mensual',
    diet: 'Decisiones técnicas con respaldo',
    image: '/especies/pulpo-mimo.jpg',
    icon: 'phosphorCompassBold',
  },
];

// ---- Métricas de la empresa (sustituyen "ConservationStat") ---------------
export type ConservationStat = {
  label: string;
  value: string;
  suffix: string;
};

export const conservationStats: ConservationStat[] = [
  { label: 'Proyectos entregados', value: '120', suffix: '+ desde 2019' },
  { label: 'Uptime promedio', value: '99.97', suffix: ' % anual' },
  { label: 'Integraciones IA productivas', value: '34', suffix: '' },
  { label: 'Equipos acompañados', value: '46', suffix: ' empresas' },
];

// ---- Info de contacto / disponibilidad ------------------------------------
// `visitInfo` se mantiene; cambia el contenido: en lugar de horarios de un
// acuario, muestra disponibilidad de la consultoría para reuniones de
// descubrimiento.
export const visitInfo = {
  hours: [
    { day: 'Lunes — Jueves', hours: '08:00 — 19:00' },
    { day: 'Viernes', hours: '08:00 — 16:00 · Cierre temprano' },
    { day: 'Sábado — Domingo', hours: 'Bajo demanda · proyectos críticos' },
  ],
  address: 'Costa Rica · Operación 100 % remota · LATAM y USA',
  ticketingNote:
    'Trabajamos por cohortes: arrancamos máximo dos proyectos nuevos por mes para mantener el nivel de atención. Pedí tu reunión de descubrimiento — sin costo y sin compromiso.',
} as const;

// ---- Modelos de engagement (sustituyen "Tickets") -------------------------
// `Ticket` se reutiliza para describir cómo se contrata el trabajo:
// auditoría puntual, proyecto cerrado, partnership recurrente.
export type Ticket = {
  name: string;
  price: string;
  cadence: string;
  description: string;
  perks: readonly string[];
  accent: 'foam' | 'lagoon' | 'coral';
  highlight?: boolean;
};

export const tickets: Ticket[] = [
  {
    name: 'Auditoría',
    price: 'Desde $1.8K',
    cadence: 'engagement de 2-4 sem',
    description:
      'Diagnóstico tecnológico completo. Mapeo de stack, riesgos, oportunidades de automatización e IA, y un roadmap priorizado por impacto.',
    perks: [
      'Discovery con stakeholders',
      'Inventario de stack y procesos',
      'Roadmap accionable a 12 meses',
      'Sesión de cierre con C-level',
    ],
    accent: 'foam',
  },
  {
    name: 'Proyecto cerrado',
    price: 'Desde $14K',
    cadence: 'alcance fijo',
    description:
      'Construcción end-to-end de una solución concreta. Estimación cerrada, hitos quincenales, demo viva en cada sprint y handoff documentado.',
    perks: [
      'Alcance y precio cerrados',
      'Sprints de 2 semanas con demo',
      'Stack premium (Angular · Firebase · IA)',
      'Documentación y handoff incluidos',
    ],
    accent: 'lagoon',
    highlight: true,
  },
  {
    name: 'Partnership',
    price: 'Desde $4.5K',
    cadence: 'mensual',
    description:
      'Acompañamiento continuo: equipo de producto fraccional, sprints rolling, soporte 24/7 y prioridad en agenda. Ideal para empresas en crecimiento sostenido.',
    perks: [
      'Equipo dedicado fraccional',
      'Soporte y guardia 24/7',
      'Prioridad en agenda',
      'CTO fraccional incluido',
    ],
    accent: 'coral',
  },
];
