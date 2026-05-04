// Public API curada del lib `@acuario-ui-shared`.
//
// Para imports más quirúrgicos (sin pasar por este barrel) los consumers
// pueden usar el path mapping `@acuario-ui-shared/*` declarado en
// `tsconfig.base.json`. Por ejemplo:
//
//   import { PageHeader } from '@acuario-ui-shared/components/page-header/page-header';
//
// Esto es preferido cuando solo necesitás un componente puntual y querés
// evitar tirarle al bundler todo el árbol de re-exports del barrel.

// ─── Layout (aplicaciones que componen su shell) ───────────────────────────
export { FloatingNav } from './lib/layout/floating-nav/floating-nav';
export { Footer } from './lib/layout/footer/footer';
export { OceanBackground } from './lib/layout/ocean-background/ocean-background';
export { GlassPillCanvas } from './lib/layout/glass-pill-canvas/glass-pill-canvas';

// ─── UI atoms ──────────────────────────────────────────────────────────────
export { Eyebrow } from './lib/components/eyebrow/eyebrow';
export { PillButton } from './lib/components/pill-button/pill-button';
export { PageHeader } from './lib/components/page-header/page-header';
export { SectionHeading } from './lib/components/section-heading/section-heading';
export { CausticBg } from './lib/components/caustic-bg/caustic-bg';
export { BubbleStream } from './lib/components/bubble-stream/bubble-stream';
export { DepthTransition } from './lib/components/depth-transition/depth-transition';
export { BrandLockup } from './lib/components/brand-mark/brand-lockup';
export { EmblemMark } from './lib/components/brand-mark/emblem-mark';
export { EmblemStamp } from './lib/components/brand-mark/emblem-stamp';

// ─── Directives ────────────────────────────────────────────────────────────
export { RevealDirective } from './lib/directives/reveal/reveal.directive';
export { ImgFadeDirective } from './lib/directives/img-fade/img-fade.directive';

// ─── Data + types ──────────────────────────────────────────────────────────
export {
  exhibits,
  species,
  conservationStats,
  visitInfo,
  tickets,
} from './lib/data/data';
export type {
  Exhibit,
  Species,
  SpeciesStatus,
  ConservationStat,
  Ticket,
} from './lib/data/data';
