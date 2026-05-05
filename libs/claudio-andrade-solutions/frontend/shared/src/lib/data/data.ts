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
    zone: 'Diagnóstico',
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
    zone: 'Desarrollo',
    depth: '12 — 24 semanas',
    species: 32,
    liters: '∞',
    description:
      'Plataformas internas, ERPs ligeros, tableros de operaciones. Angular + Nx + Firebase, monorepo escalable, despliegue continuo. Construidos para crecer con la empresa.',
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
      'Agentes Claude, RAG sobre documentación interna, asistentes de soporte, generación de contenido y automatización de tareas de soporte. IA integrada a tu proceso real.',
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
      'Aplicaciones específicas para proveedores: integración con Retail Link, OTIF, scorecards, forecast assist y conciliación automática. Una sola construcción, escala por SKU.',
    accent: 'coral',
    image: '/biomas/tunel-azul.png',
  },
  {
    slug: 'landing-premium',
    name: 'Landing premium',
    zone: 'Marca',
    depth: '3 — 6 semanas',
    species: 9,
    liters: 'Lighthouse 95+',
    description:
      'Páginas de marca con presupuesto editorial — animaciones canvas, glass-morphism real, rendimiento auditado. La que estás viendo es de las nuestras.',
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
      'Pipelines que conectan tus herramientas — ETL ligeros, sincronización entre sistemas, alertas inteligentes. Reducimos trabajo manual sin reemplazar lo que ya funciona.',
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
  // accent: tono visual de la card (corner-glow + category eyebrow). Mismo
  // sistema que `Exhibit.accent` — los 4 valores corresponden a los tokens
  // de color del proyecto.
  accent?: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
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
    scientific: 'Diagnóstico 360° de stack, procesos y oportunidades de IA.',
    habitat: 'Diagnóstico',
    status: 'Estable',
    depth: '2 — 4 semanas',
    diet: 'Plan de acción a 12 meses',
    image: '/especies/tiburon-ballena.jpg',
    icon: 'phosphorPulseBold',
    accent: 'lagoon',
  },
  {
    slug: 'sistemas-medida',
    common: 'Sistemas a medida',
    scientific: 'Plataformas internas y ERPs ligeros que crecen con la empresa.',
    habitat: 'Desarrollo',
    status: 'Estable',
    depth: '12 — 24 semanas',
    diet: 'App productiva en 90 días',
    image: '/especies/pulpo-mimo.jpg',
    icon: 'phosphorTerminalWindowBold',
    accent: 'kelp',
  },
  {
    slug: 'integraciones-ia',
    common: 'Integraciones de IA',
    scientific: 'Agentes Claude, RAG sobre tu documentación, asistentes que entienden el negocio.',
    habitat: 'Inteligencia',
    status: 'Vulnerable',
    depth: '4 — 10 semanas',
    diet: 'IA en producción, no en demo',
    image: '/especies/medusa-luna.jpg',
    icon: 'phosphorRobotBold',
    accent: 'bioluminescent',
  },
  {
    slug: 'apps-walmart',
    common: 'Apps proveedores Walmart',
    scientific: 'Retail Link, OTIF, scorecards y forecast assist sin fricción con el sistema.',
    habitat: 'Vertical · Retail',
    status: 'En peligro',
    depth: '6 — 12 semanas',
    diet: 'Conciliación automatizada por SKU',
    image: '/especies/pez-dragon.jpg',
    icon: 'phosphorPackageBold',
    accent: 'coral',
  },
  {
    slug: 'landing-premium',
    common: 'Landing premium',
    scientific: 'Páginas de marca con presupuesto editorial y rendimiento auditado.',
    habitat: 'Marca',
    status: 'Estable',
    depth: '3 — 6 semanas',
    diet: 'Lighthouse 95+ garantizado',
    image: '/especies/manta-gigante.jpg',
    icon: 'phosphorBrowsersBold',
    accent: 'lagoon',
  },
  {
    slug: 'apps-moviles',
    common: 'Apps móviles',
    scientific: 'iOS, Android y multiplataforma con un solo equipo y una sola lista de tareas.',
    habitat: 'Móvil',
    status: 'Vulnerable',
    depth: '8 — 16 semanas',
    diet: 'Listo para App Store y Play Store',
    image: '/especies/caballito-leafy.png',
    icon: 'phosphorDeviceMobileBold',
    accent: 'kelp',
  },
  {
    slug: 'analisis-flujos',
    common: 'Análisis de flujos',
    scientific: 'Procesos, métricas y cuellos de botella mapeados al detalle.',
    habitat: 'Operaciones',
    status: 'Estable',
    depth: '2 — 6 semanas',
    diet: 'Fricciones priorizadas por impacto',
    image: '/especies/calamar-vampiro.webp',
    icon: 'phosphorChartLineUpBold',
    accent: 'bioluminescent',
  },
  {
    slug: 'automatizacion',
    common: 'Automatización',
    scientific: 'Pipelines, webhooks y ETL ligeros que conectan lo que ya tenés.',
    habitat: 'Integración',
    status: 'Estable',
    depth: '4 — 8 semanas',
    diet: 'Horas-hombre liberadas',
    image: '/especies/nudibranquio-azul.jpg',
    icon: 'phosphorGearBold',
    accent: 'coral',
  },
  {
    slug: 'consultoria-cloud',
    common: 'Consultoría cloud',
    scientific: 'Firebase, Google Cloud y Edge bien afinados — costos auditados.',
    habitat: 'Infraestructura',
    status: 'Estable',
    depth: '2 — 8 semanas',
    diet: 'Costos optimizados, despliegues estables',
    image: '/especies/tiburon-ballena.jpg',
    icon: 'phosphorCloudCheckBold',
    accent: 'lagoon',
  },
  {
    slug: 'consultoria-estrategica',
    common: 'Consultoría estratégica',
    scientific: 'CTO fraccional y acompañamiento técnico para empresas en crecimiento.',
    habitat: 'Asesoría',
    status: 'En peligro',
    depth: 'Mensual',
    diet: 'Decisiones técnicas con respaldo',
    image: '/especies/pulpo-mimo.jpg',
    icon: 'phosphorBrainBold',
    accent: 'kelp',
  },
];

// ---- Casos destacados (capítulo 04) ---------------------------------------
// El capítulo 04 dejó de ser un único showcase para volverse una fila de tres
// casos reales — moofy / acuario / adrian — con layout alternado (imagen
// izquierda · stats derecha, luego espejo, luego espejo). Cada caso conserva
// la dramaturgia del original: hero landscape grande + mini-carrusel de
// capturas mobile que ciclan + métricas verificables al lado opuesto.
export type CaseSlide = {
  src: string;
  alt: string;
  caption: string;
  /**
   * `object-position` opcional para cuando el aspect de la captura difiere
   * del estándar 414×896 mobile (header arriba). Útil cuando el contenido
   * crítico vive en el medio o abajo de la imagen — ej. anatomy renders
   * que tienen muscle diagrams al pie. Default: `center top`.
   */
  position?: string;
};

export type ConservationStat = {
  label: string;
  value: string;
  suffix: string;
};

export type FeaturedCase = {
  slug: string;
  badgeLabel: string;          // "Caso · moofy.vip"
  name: string;                // título card (línea principal, ~20-24 px)
  tagline: string;             // subtítulo card (1 línea)
  year: string;                // "2026"
  status: string;              // pill "Live · …" (constante por caso, ≤24 chars)
  slides: ReadonlyArray<CaseSlide>;
  stats: ReadonlyArray<ConservationStat>;  // 3 métricas máx — más es densidad
  resultsEyebrow: string;      // "Resultados · moofy.vip"
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
};

export const featuredCases: ReadonlyArray<FeaturedCase> = [
  // ─── 01 · moofy.vip — plataforma operativa para proveedores Walmart ──────
  {
    slug: 'moofy',
    badgeLabel: 'Caso · moofy.vip',
    name: 'Plataforma para proveedores Walmart',
    tagline: 'Retail Link · scraper Cloud Run · analytics',
    year: '2026',
    status: 'Live · sin fallas',
    slides: [
      {
        src: '/casos/moofy-landing.png',
        alt: 'Pantalla de acceso de moofy.vip — entrada con cuatro módulos: órdenes, estadísticas, ajustes y buscador',
        caption: 'Acceso · 4 módulos',
      },
      {
        src: '/casos/moofy-dashboard.png',
        alt: 'Dashboard de Órdenes de Compra — monitoreo del scraper en Cloud Run con ocho corridas exitosas',
        caption: 'Monitoreo · scraper Cloud Run',
      },
      {
        src: '/casos/moofy-stats.png',
        alt: 'Estadísticas — comparador mensual de rutas, métricas y períodos',
        caption: 'Analytics · comparador mensual',
      },
      {
        src: '/casos/moofy-settings.png',
        alt: 'Ajustes de Rutas — editor con búsqueda, asignación de supercenters y configuración por ruta',
        caption: 'Cobertura · editor de rutas',
      },
    ],
    stats: [
      { label: 'Horas liberadas', value: '120', suffix: ' al mes · operativas' },
      { label: 'Sincronización', value: '8×', suffix: ' al día · sin fallas' },
      { label: 'Trazabilidad', value: '100%', suffix: ' de cada cambio' },
    ],
    resultsEyebrow: 'Resultados · moofy.vip',
    accent: 'lagoon',
  },

  // ─── 02 · acuario — landing inmersiva con storytelling editorial ─────────
  {
    slug: 'acuario',
    badgeLabel: 'Caso · acuario.cr',
    name: 'Landing inmersiva editorial',
    tagline: 'Angular SSR · cinemática · tipografía editorial',
    year: '2026',
    status: 'Online · cinemática',
    slides: [
      {
        src: '/casos/acuario-home.png',
        alt: 'Hero mobile del acuario — "Inmersión en lo profundo" con próxima ola y métricas live',
        caption: 'Hero · 1.247 especies',
      },
      {
        src: '/casos/acuario-exhibiciones.png',
        alt: 'Card de bioma "Manglar" — fotografía split underwater de raíces sumergidas y garza posada en mangle, con ficha de especies y capacidad',
        caption: 'Exhibiciones · Manglar',
        position: 'center top',
      },
      {
        src: '/casos/acuario-contacto.png',
        alt: 'Formulario de contacto — diseño glass sobre la paleta abisal',
        caption: 'Contacto · form glass',
      },
    ],
    stats: [
      { label: 'Capítulos narrativos', value: '04', suffix: ' secciones inmersivas' },
      { label: 'Especies catalogadas', value: '1.247', suffix: ' en seis biomas' },
      { label: 'Lighthouse', value: '95+', suffix: ' SSR · imágenes diferidas' },
    ],
    resultsEyebrow: 'Resultados · acuario.cr',
    accent: 'bioluminescent',
  },

  // ─── 03 · adrian-badilla.com — coach digital + auth + panel ──────────────
  {
    slug: 'adrian',
    badgeLabel: 'Caso · adrian-badilla.com',
    name: 'Plataforma de coaching digital',
    tagline: 'Angular 21 · Firebase Auth · NgRx Signals',
    year: '2026',
    status: 'Live · auth + panel',
    slides: [
      {
        src: '/casos/adrian-ejercicio.png',
        alt: 'Detalle de ejercicio — render anatómico con posición inicial y mapa de músculos trabajados (glúteos, isquiotibiales, lumbares)',
        caption: 'Ejercicio · anatomía',
        // Imagen 372×558 (≈2/3) con render arriba y muscle diagrams abajo;
        // `center` en lugar de `top` mantiene visible la posición inicial +
        // los muscle diagrams (ambos críticos para vender el detalle).
        position: 'center',
      },
      {
        src: '/casos/adrian-auth.png',
        alt: 'Pantalla de login — correo, contraseña, Google SSO y registro',
        caption: 'Auth · 5 flujos Firebase',
      },
      {
        src: '/casos/adrian-rutinas.png',
        alt: 'Vista de Rutinas Semanales — tarjetas detalladas: masa muscular, tonificación, fuerza funcional, metabolismo',
        caption: 'Rutinas · plan semanal',
      },
      {
        src: '/casos/adrian-planes.png',
        alt: 'Sección Físico y Nutrición — planes de Nutrición y Estilo de Vida + Fuerza y Musculación con bullets y precio',
        caption: 'Planes · físico y nutrición',
        // Imagen 414×876 muy alta (≈9/19) con título arriba, foto al medio
        // y card de plan abajo; `25%` (un cuarto del top) deja ver el título
        // + foto sin perder por completo el inicio de la card de plan.
        position: 'center 25%',
      },
    ],
    stats: [
      { label: 'Stack', value: 'NG 21', suffix: ' + Material + Firebase' },
      { label: 'Flujos auth', value: '05', suffix: ' login · register · reset · verify · SSO' },
      { label: 'Módulos lazy', value: '06', suffix: ' landing · auth · panel · rutinas · dietas' },
    ],
    resultsEyebrow: 'Resultados · adrian-badilla.com',
    accent: 'coral',
  },
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
    cadence: 'trabajo de 2 a 4 semanas',
    description:
      'Diagnóstico tecnológico completo. Mapeo de stack, riesgos, oportunidades de automatización e IA, y una hoja de ruta priorizada por impacto.',
    perks: [
      'Sesiones con responsables clave',
      'Inventario de stack y procesos',
      'Hoja de ruta a 12 meses',
      'Sesión de cierre con dirección',
    ],
    accent: 'foam',
  },
  {
    name: 'Proyecto cerrado',
    price: 'Desde $14K',
    cadence: 'alcance fijo',
    description:
      'Construcción integral de una solución concreta. Estimación cerrada, hitos quincenales, demo viva en cada sprint y entrega documentada.',
    perks: [
      'Alcance y precio cerrados',
      'Sprints de 2 semanas con demo',
      'Stack premium (Angular · Firebase · IA)',
      'Documentación y entrega incluidos',
    ],
    accent: 'lagoon',
    highlight: true,
  },
  {
    name: 'Acompañamiento',
    price: 'Desde $4.5K',
    cadence: 'mensual',
    description:
      'Compromiso a largo plazo: equipo de producto fraccional, sprints continuos, soporte 24/7 y prioridad en agenda. Ideal para empresas en crecimiento sostenido.',
    perks: [
      'Equipo dedicado fraccional',
      'Soporte y guardia 24/7',
      'Prioridad en agenda',
      'CTO fraccional incluido',
    ],
    accent: 'coral',
  },
];
