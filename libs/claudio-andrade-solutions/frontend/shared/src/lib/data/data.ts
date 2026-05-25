// =============================================================================
// data — fuente única de contenido del sitio.
//
// Describe Claudio Andrade Solutions: una consultora tecnológica que vende
// soluciones a medida — auditorías, sistemas, IA, automatización, landing
// pages premium, integraciones con el ecosistema Walmart.
// =============================================================================

// ---- Productos ------------------------------------------------------------
// Cada producto tiene un nombre, una categoría (`zone`), un timeline estimado,
// un par de métricas (entregables + cobertura) y una descripción corta. El
// `accent` controla los tintes en la UI existente.
export type Product = {
  slug: string;
  name: string;
  zone: string;          // categoría (Auditoría, Sistema, IA, etc.)
  timeline: string;      // timeline estimado (2-4 sem, 12+ sem...)
  deliverables: number;  // cantidad de entregables / módulos
  coverage: string;      // cobertura / escala
  tagline: string;       // resumen corto (1 línea) — usado en cards del home
  description: string;   // descripción extendida — usada en /productos
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
  image: string;
};

export const products: Product[] = [
  {
    slug: 'auditoria-tecnologica',
    name: 'Sistemas a medida',
    zone: 'Diagnóstico',
    timeline: '2 — 4 semanas',
    deliverables: 14,
    coverage: '360°',
    tagline: 'Stack, flujos y procesos auditados con mapa accionable.',
    description:
      'Diagnóstico completo del stack, los flujos y los procesos. Detectamos qué automatizar, qué reescribir y qué dejar quieto — con un mapa accionable y prioridades claras.',
    accent: 'lagoon',
    image: '/productos/auditoria-tecnologica.png',
  },
  {
    slug: 'sistemas-a-medida',
    name: 'Landing premium',
    zone: 'Desarrollo',
    timeline: '12 — 24 semanas',
    deliverables: 32,
    coverage: '∞',
    tagline: 'Plataformas internas y ERPs en Angular, Nx y Firebase.',
    description:
      'Plataformas internas, ERPs ligeros, tableros de operaciones. Angular + Nx + Firebase, monorepo escalable, despliegue continuo. Construidos para crecer con la empresa.',
    accent: 'kelp',
    image: '/productos/sistemas-a-medida.png',
  },
  {
    slug: 'integraciones-ia',
    name: 'Integraciones de IA',
    zone: 'Inteligencia',
    timeline: '4 — 10 semanas',
    deliverables: 18,
    coverage: 'Multi-modelo',
    tagline: 'Agentes Claude y RAG sobre tu documentación interna.',
    description:
      'Agentes Claude, RAG sobre documentación interna, asistentes de soporte, generación de contenido y automatización de tareas de soporte. IA integrada a tu proceso real.',
    accent: 'bioluminescent',
    image: '/productos/integraciones-ia.png',
  },
  {
    slug: 'apps-walmart',
    name: 'Apps Para proveedores de Walmart',
    zone: 'Vertical',
    timeline: '6 — 12 semanas',
    deliverables: 22,
    coverage: 'Retail Link',
    tagline: 'Retail Link, OTIF, scorecards y conciliación automatizada.',
    description:
      'Aplicaciones específicas para proveedores: integración con Retail Link, OTIF, scorecards, forecast assist y conciliación automática. Una sola construcción, escala por SKU.',
    accent: 'coral',
    image: '/productos/apps-walmart.png',
  },
  {
    slug: 'landing-premium',
    name: 'Auditoría de tecnología',
    zone: 'Marca',
    timeline: '3 — 6 semanas',
    deliverables: 9,
    coverage: 'Lighthouse 95+',
    tagline: 'Páginas editoriales con animaciones canvas y rendimiento auditado.',
    description:
      'Páginas de marca con presupuesto editorial — animaciones canvas, glass-morphism real, rendimiento auditado. La que estás viendo es de las nuestras.',
    accent: 'lagoon',
    image: '/productos/landing-premium.png',
  },
  {
    slug: 'automatizacion-procesos',
    name: 'Automatización de procesos',
    zone: 'Operaciones',
    timeline: '4 — 8 semanas',
    deliverables: 16,
    coverage: 'n8n · Zapier · Make',
    tagline: 'Pipelines y ETL ligeros que conectan tus herramientas.',
    description:
      'Pipelines que conectan tus herramientas — ETL ligeros, sincronización entre sistemas, alertas inteligentes. Reducimos trabajo manual sin reemplazar lo que ya funciona.',
    accent: 'kelp',
    image: '/productos/automatizacion-procesos.png',
  },
];

// ---- Servicios (carrusel del home) ----------------------------------------
// Cada card del marquee tiene nombre, tagline editorial, categoría, status,
// timeline, outcome principal e icono ng-icon.
export type ServiceStatus = 'Estable' | 'Vulnerable' | 'En peligro' | 'Crítico';

export type Service = {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  status: ServiceStatus;
  timeline: string;
  outcome: string;
  image: string;
  imagePosition?: string;
  icon?: string;
  // accent: tono visual de la card (corner-glow + category eyebrow). Mismo
  // sistema que `Product.accent` — los 4 valores corresponden a los tokens
  // de color del proyecto.
  accent?: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
  // iconColor: color del icono del card (tile rounded-square). Va separado
  // del `accent` del halo para que cada card tenga su propia identidad sin
  // limitarse a la paleta de 4 accents. Paleta abisal/bioluminiscente —
  // hex válidos para usar como `var(--icon-color)` en SCSS.
  iconColor: string;
};

// Status → mapping a "tono" visual existente:
//   'Estable'    = Disponible      (kelp / verde — todo verde, listo para arrancar)
//   'Vulnerable' = En arranque     (coral suave — recién lanzado)
//   'En peligro' = Cupo limitado   (coral fuerte — pocas plazas)
//   'Crítico'    = Premium         (coral intenso — el caro)
// El mapping es un detalle de UI; los strings los lee `STATUS_TONES` en el
// marquee.
export const services: Service[] = [
  {
    slug: 'auditoria-tech',
    name: 'Auditoría tecnológica',
    tagline: 'Diagnóstico 360° de stack, procesos y oportunidades de IA.',
    category: 'Diagnóstico',
    status: 'Estable',
    timeline: '2 — 4 semanas',
    outcome: 'Plan de acción a 12 meses',
    image: '',
    icon: 'phosphorFileCodeBold',
    accent: 'lagoon',
    iconColor: '#5EC4D1',
  },
  {
    slug: 'sistemas-medida',
    name: 'Sistemas a medida',
    tagline: 'Plataformas internas y ERPs ligeros que crecen con la empresa.',
    category: 'Desarrollo',
    status: 'Estable',
    timeline: '12 — 24 semanas',
    outcome: 'App productiva en 90 días',
    image: '',
    icon: 'phosphorBracketsCurlyBold',
    accent: 'kelp',
    iconColor: '#7FE3A8',
  },
  {
    slug: 'integraciones-ia',
    name: 'Integraciones de IA',
    tagline: 'Agentes Claude, RAG sobre tu documentación, asistentes que entienden el negocio.',
    category: 'Inteligencia',
    status: 'Vulnerable',
    timeline: '4 — 10 semanas',
    outcome: 'IA en producción, no en demo',
    image: '',
    icon: 'phosphorRobotBold',
    accent: 'bioluminescent',
    iconColor: '#9C8AF5',
  },
  {
    slug: 'apps-walmart',
    name: 'Apps proveedores Walmart',
    tagline: 'Retail Link, OTIF, scorecards y forecast assist sin fricción con el sistema.',
    category: 'Vertical · Retail',
    status: 'En peligro',
    timeline: '6 — 12 semanas',
    outcome: 'Conciliación automatizada por SKU',
    image: '',
    icon: 'phosphorDatabaseBold',
    accent: 'coral',
    // Antes #F0B870 (amarillo-naranja Walmart). El usuario pidió eliminar
    // todo naranja de las cards del marquee — el icono se ve en un tile de
    // 24px pero el hue cálido contra el resto azul rompía la unidad. Cambio
    // a sky-blue para mantenerlo distinguible del resto de iconos azules.
    iconColor: '#5BB8E5',
  },
  {
    slug: 'landing-premium',
    name: 'Landing premium',
    tagline: 'Páginas de marca con presupuesto editorial y rendimiento auditado.',
    category: 'Marca',
    status: 'Estable',
    timeline: '3 — 6 semanas',
    outcome: 'Lighthouse 95+ garantizado',
    image: '',
    icon: 'phosphorBrowsersBold',
    accent: 'lagoon',
    iconColor: '#E879B8',
  },
  {
    slug: 'apps-moviles',
    name: 'Apps móviles',
    tagline: 'iOS, Android y multiplataforma con un solo equipo y una sola lista de tareas.',
    category: 'Móvil',
    status: 'Vulnerable',
    timeline: '8 — 16 semanas',
    outcome: 'Listo para App Store y Play Store',
    image: '',
    icon: 'phosphorDevicesBold',
    accent: 'kelp',
    iconColor: '#7B98F0',
  },
  {
    slug: 'analisis-flujos',
    name: 'Análisis de flujos',
    tagline: 'Procesos, métricas y cuellos de botella mapeados al detalle.',
    category: 'Operaciones',
    status: 'Estable',
    timeline: '2 — 6 semanas',
    outcome: 'Fricciones priorizadas por impacto',
    image: '',
    icon: 'phosphorChartScatterBold',
    accent: 'bioluminescent',
    iconColor: '#7FE3D6',
  },
  {
    slug: 'automatizacion',
    name: 'Automatización',
    tagline: 'Pipelines, webhooks y ETL ligeros que conectan lo que ya tenés.',
    category: 'Integración',
    status: 'Estable',
    timeline: '4 — 8 semanas',
    outcome: 'Horas-hombre liberadas',
    image: '',
    icon: 'phosphorGearSixBold',
    accent: 'coral',
    // Antes #F0876B (coral). Mismo motivo que apps-walmart — sin naranja en
    // los iconos del marquee. Lavender-blue distinto del #7B98F0 (apps-moviles)
    // y del #9DAEEF (consultoria-cloud) para que no luzca duplicado.
    iconColor: '#88A8F2',
  },
  {
    slug: 'consultoria-cloud',
    name: 'Consultoría cloud',
    tagline: 'Firebase, Google Cloud y Edge bien afinados — costos auditados.',
    category: 'Infraestructura',
    status: 'Estable',
    timeline: '2 — 8 semanas',
    outcome: 'Costos optimizados, despliegues estables',
    image: '',
    icon: 'phosphorCloudArrowUpBold',
    accent: 'lagoon',
    iconColor: '#9DAEEF',
  },
  {
    slug: 'consultoria-estrategica',
    name: 'Consultoría estratégica',
    tagline: 'CTO fraccional y acompañamiento técnico para empresas en crecimiento.',
    category: 'Asesoría',
    status: 'En peligro',
    timeline: 'Mensual',
    outcome: 'Decisiones técnicas con respaldo',
    image: '',
    icon: 'phosphorCpuBold',
    accent: 'kelp',
    iconColor: '#5FD89F',
  },
];

// ---- Casos destacados (capítulo 04) ---------------------------------------
// Una fila de tres casos reales — moofy / acuario / adrian — con layout
// alternado (imagen izquierda · stats derecha, luego espejo, luego espejo).
// Cada caso lleva: hero landscape grande + mini-carrusel de capturas mobile
// que ciclan + métricas verificables al lado opuesto.
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

export type Metric = {
  label: string;
  value: string;
  suffix: string;
};

export type CaseStudy = {
  slug: string;
  badgeLabel: string;          // "Caso · moofy.vip"
  name: string;                // título card (línea principal, ~20-24 px)
  tagline: string;             // subtítulo card (1 línea)
  year: string;                // "2026"
  status: string;              // pill "Live · …" (constante por caso, ≤24 chars)
  slides: ReadonlyArray<CaseSlide>;
  stats: ReadonlyArray<Metric>;            // 3 métricas máx — más es densidad
  resultsEyebrow: string;      // "Resultados · moofy.vip"
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
};

export const caseStudies: ReadonlyArray<CaseStudy> = [
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

// ---- Disponibilidad / contacto --------------------------------------------
// Disponibilidad de la consultoría para reuniones de descubrimiento.
export const availability = {
  hours: [
    { day: 'Lunes — Jueves', hours: '08:00 — 19:00' },
    { day: 'Viernes', hours: '08:00 — 16:00 · Cierre temprano' },
    { day: 'Sábado — Domingo', hours: 'Bajo demanda · proyectos críticos' },
  ],
  address: 'Costa Rica · Operación 100 % remota · LATAM y USA',
  ticketingNote:
    'Trabajamos por cohortes: arrancamos máximo dos proyectos nuevos por mes para mantener el nivel de atención. Pedí tu reunión de descubrimiento — sin costo y sin compromiso.',
} as const;

// ---- Modelos de engagement ------------------------------------------------
// Tres ofertas concretas: mantenimiento de apps existentes, proyecto a medida
// (app + landing + automatización), y landing page suelto.
export type Engagement = {
  name: string;
  // Precio actual. Incluye símbolo de moneda cuando aplica ("$250", "$550",
  // "Personalizado"). El estilo del card maneja el peso visual.
  price: string;
  // Precio ancla (tachado encima del actual) — efecto "Price Anchoring".
  // No usado por la oferta actual; se conserva por si vuelve a aplicar.
  originalPrice?: string;
  // Línea complementaria pequeña debajo del precio (ej. "entrega única
  // · 1-2 semanas"). Aclara unidades o entregables sin saturar el precio.
  priceBreakdown?: string;
  cadence: string;
  description: string;
  // Lista de capacidades concretas que incluye este engagement. Cada card
  // tiene su propia lista — no hay matrix de inclusión cumulativa porque la
  // oferta ya no es jerárquica (un landing NO incluye mantenimiento mensual,
  // y mantenimiento NO incluye build de landing — son verticales distintas).
  features: readonly string[];
  // Mensaje de escasez (solo en plan destacado) — refuerza cohorte limitada
  // que ya vive en `availability.ticketingNote`.
  scarcityNote?: string;
  accent: 'foam' | 'lagoon' | 'coral';
  highlight?: boolean;
};

export const engagements: Engagement[] = [
  {
    name: 'Mantenimiento de apps',
    price: '$250',
    priceBreakdown: 'mensual · sobre apps en producción',
    cadence: 'retainer mensual',
    description:
      'Servicio independiente para una aplicación que ya está viva. Bug fixes, actualizaciones de dependencias, monitoreo y mejoras incrementales — para mantener tu plataforma estable y al día.',
    features: [
      'Bug fixes y hotfixes',
      'Actualizaciones de dependencias',
      'Monitoreo de salud y errores',
      'Mejoras incrementales mensuales',
      'Soporte por canal directo',
    ],
    accent: 'foam',
  },
  {
    name: 'Solución a medida',
    price: 'Personalizado',
    priceBreakdown: 'alcance ajustado a tu caso',
    cadence: 'build cerrado',
    description:
      'Aplicación a medida con su landing y un sistema robusto de automatización integrado. Discovery, arquitectura, sprints quincenales con demo viva y entrega documentada con garantía.',
    features: [
      'Discovery y arquitectura',
      'App + landing + automatización IA',
      'Sprints quincenales con demo viva',
      'Stack premium (Angular · Firebase · IA)',
      'Documentación técnica completa',
      'Garantía post-entrega de 30 días',
    ],
    scarcityNote: '2 cupos abiertos · cohorte actual',
    accent: 'lagoon',
    highlight: true,
  },
  {
    name: 'Landing page',
    price: '$550',
    priceBreakdown: 'entrega única · 1-2 semanas',
    cadence: 'proyecto cerrado',
    description:
      'Sitio de una página premium para vender un producto o servicio. Diseño, copy, performance, SEO técnico y deploy listo para producción.',
    features: [
      'Diseño y copy a medida',
      'Performance optimizada (Lighthouse ≥ 95)',
      'SEO técnico y metadata',
      'Stack moderno y deploy incluido',
      'Mobile-first responsive',
    ],
    accent: 'coral',
  },
];
