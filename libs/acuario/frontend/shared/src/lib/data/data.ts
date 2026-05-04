// =============================================================================
// data — port directo de `lib/data.ts` del proyecto Next. Mismas estructuras,
// mismos contenidos, mismas tonalidades de accent. Las imágenes apuntan a los
// assets ya copiados en `apps/acuario/public/`.
// =============================================================================

export type Exhibit = {
  slug: string;
  name: string;
  zone: string;
  depth: string;
  species: number;
  liters: string;
  description: string;
  accent: 'lagoon' | 'kelp' | 'coral' | 'bioluminescent';
  image: string;
};

export const exhibits: Exhibit[] = [
  {
    slug: 'abismo-pacifico',
    name: 'Abismo Pacífico',
    zone: 'Nivel −2',
    depth: '1.840 m',
    species: 47,
    liters: '2.4 M',
    description:
      'Un descenso al océano abisal donde la luz desaparece y los organismos generan su propia bioluminiscencia.',
    accent: 'bioluminescent',
    image: '/biomas/abismo-pacifico.png',
  },
  {
    slug: 'bosque-de-kelp',
    name: 'Bosque de Kelp',
    zone: 'Nivel 0',
    depth: '12 m',
    species: 86,
    liters: '1.1 M',
    description:
      'Una catedral viva de algas gigantes, refugio de tiburones leopardo, garibaldis y nutrias marinas.',
    accent: 'kelp',
    image: '/biomas/bosque-de-kelp.png',
  },
  {
    slug: 'arrecife-coral',
    name: 'Arrecife de Coral',
    zone: 'Nivel +1',
    depth: '4 m',
    species: 312,
    liters: '780 K',
    description:
      'Un Indo-Pacífico íntegro: 312 especies coexistiendo en una geometría imposible de luz, color y simbiosis.',
    accent: 'coral',
    image: '/biomas/arrecife-de-coral.png',
  },
  {
    slug: 'tunel-azul',
    name: 'Túnel Azul',
    zone: 'Nivel 0',
    depth: '9 m',
    species: 24,
    liters: '3.6 M',
    description:
      'Sesenta metros de tránsito bajo el océano abierto. Tiburones tigre de arena, mantarrayas y atunes patrullando en silencio.',
    accent: 'lagoon',
    image: '/biomas/tunel-azul.png',
  },
  {
    slug: 'manglar',
    name: 'Manglar',
    zone: 'Nivel +1',
    depth: '1.5 m',
    species: 58,
    liters: '320 K',
    description:
      'Frontera entre tierra y mar. Un ecosistema híbrido donde se reproduce la mayoría de la vida marina costera.',
    accent: 'kelp',
    image: '/biomas/manglar.png',
  },
  {
    slug: 'polo-sur',
    name: 'Polo Sur',
    zone: 'Nivel −1',
    depth: '−1.8 °C',
    species: 19,
    liters: '640 K',
    description:
      'Recreación criogénica del mar de Ross con pingüinos emperador, focas de Weddell y peces dragón antárticos.',
    accent: 'bioluminescent',
    image: '/biomas/polo-sur.png',
  },
];

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
  // Custom focal point per species — needed because each photo has its
  // subject in a different spot. Format: any valid CSS object-position.
  imagePosition?: string;
};

export const species: Species[] = [
  {
    slug: 'tiburon-ballena',
    common: 'Tiburón ballena',
    scientific: 'Rhincodon typus',
    habitat: 'Aguas tropicales abiertas',
    status: 'En peligro',
    depth: '0 — 1.928 m',
    diet: 'Plancton, krill',
    image: '/especies/tiburon-ballena.jpg',
    imagePosition: 'center 40%',
  },
  {
    slug: 'pulpo-mimo',
    common: 'Pulpo mimo',
    scientific: 'Thaumoctopus mimicus',
    habitat: 'Indo-Pacífico fangoso',
    status: 'Vulnerable',
    depth: '2 — 30 m',
    diet: 'Crustáceos pequeños',
    image: '/especies/pulpo-mimo.jpg',
    imagePosition: 'center 35%',
  },
  {
    slug: 'medusa-luna',
    common: 'Medusa luna',
    scientific: 'Aurelia aurita',
    habitat: 'Mares templados costeros',
    status: 'Estable',
    depth: '0 — 200 m',
    diet: 'Zooplancton',
    image: '/especies/medusa-luna.jpg',
    imagePosition: 'center 35%',
  },
  {
    slug: 'pez-dragon',
    common: 'Pez dragón',
    scientific: 'Stomias boa',
    habitat: 'Zona mesopelágica',
    status: 'Estable',
    depth: '200 — 1.500 m',
    diet: 'Peces e invertebrados',
    image: '/especies/pez-dragon.jpg',
    imagePosition: 'center 40%',
  },
  {
    slug: 'manta-gigante',
    common: 'Manta gigante',
    scientific: 'Mobula birostris',
    habitat: 'Océano abierto tropical',
    status: 'En peligro',
    depth: '0 — 1.000 m',
    diet: 'Plancton, kril',
    image: '/especies/manta-gigante.jpg',
    imagePosition: 'center center',
  },
  {
    slug: 'caballito-leafy',
    common: 'Dragón marino foliáceo',
    scientific: 'Phycodurus eques',
    habitat: 'Bosques de algas australes',
    status: 'Vulnerable',
    depth: '8 — 30 m',
    diet: 'Misidáceos',
    image: '/especies/caballito-leafy.png',
    imagePosition: 'center 35%',
  },
  {
    slug: 'calamar-vampiro',
    common: 'Calamar vampiro',
    scientific: 'Vampyroteuthis infernalis',
    habitat: 'Zona afótica',
    status: 'Estable',
    depth: '600 — 1.200 m',
    diet: 'Detritos marinos',
    image: '/especies/calamar-vampiro.webp',
    imagePosition: 'center 30%',
  },
  {
    slug: 'nudibranquio-azul',
    common: 'Nudibranquio azul',
    scientific: 'Glaucus atlanticus',
    habitat: 'Superficie pelágica',
    status: 'Estable',
    depth: '0 — 5 m',
    diet: 'Cnidarios',
    image: '/especies/nudibranquio-azul.jpg',
    imagePosition: 'center 40%',
  },
];

export type ConservationStat = {
  label: string;
  value: string;
  suffix: string;
};

export const conservationStats: ConservationStat[] = [
  { label: 'Especies bajo cuidado', value: '1.247', suffix: '' },
  { label: 'Hectáreas marinas protegidas', value: '38.420', suffix: ' ha' },
  { label: 'Tortugas rehabilitadas', value: '2.612', suffix: ' desde 2003' },
  { label: 'Investigación abierta', value: '94', suffix: ' papers' },
];

export const visitInfo = {
  hours: [
    { day: 'Lunes — Jueves', hours: '10:00 — 19:30' },
    { day: 'Viernes', hours: '10:00 — 22:00 · Noche bioluminiscente' },
    { day: 'Sábado — Domingo', hours: '09:00 — 21:00' },
  ],
  address: 'Paseo Marítimo 1492, San José',
  ticketingNote:
    'La capacidad es limitada. Las entradas se liberan en olas cada 30 minutos para mantener la inmersión.',
} as const;

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
    name: 'General',
    price: '$28',
    cadence: 'por persona',
    description:
      'Acceso a todas las galerías permanentes y al Túnel Azul. Audioguía incluida.',
    perks: [
      'Acceso a 6 galerías',
      'Túnel Azul de 60 m',
      'Audioguía multi-idioma',
      'Reentrada el mismo día',
    ],
    accent: 'foam',
  },
  {
    name: 'Inmersión',
    price: '$74',
    cadence: 'por persona',
    description:
      'Recorrido guiado por curador, acceso anticipado y observación tras-bambalinas del laboratorio de coral.',
    perks: [
      'Acceso anticipado · 09:00',
      'Tour curador (90 min)',
      'Laboratorio coralino',
      'Catálogo editorial firmado',
    ],
    accent: 'lagoon',
    highlight: true,
  },
  {
    name: 'Patronato',
    price: '$1.840',
    cadence: 'anual',
    description:
      'Membresía fundadora. Acceso ilimitado, expediciones anuales y créditos en el programa de conservación.',
    perks: [
      'Entrada ilimitada x2',
      'Cena anual con curaduría',
      'Crédito 1 ha en reserva marina',
      'Eventos privados',
    ],
    accent: 'coral',
  },
];
