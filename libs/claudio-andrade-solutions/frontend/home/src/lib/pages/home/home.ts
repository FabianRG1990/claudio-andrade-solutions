import { ChangeDetectionStrategy, Component } from '@angular/core';

import { CaseStudies } from '../../sections/case-studies/case-studies';
import { FeaturedProducts } from '../../sections/featured-products/featured-products';
import { Engagements } from '../../sections/engagements/engagements';
import { ServicesMarquee } from '../../sections/services-marquee/services-marquee';
import { Timeline } from '../../sections/timeline/timeline';
import { Availability } from '../../sections/availability/availability';
import { WolfLandscape } from '../../sections/wolf-landscape/wolf-landscape';

/**
 * HomePage — composición del manifiesto. WolfLandscape es ahora el hero
 * único de la portada (lago + lobo + niebla + peces, copy editorial encima).
 *   WolfLandscape → FeaturedProducts → ServicesMarquee → Engagements →
 *   CaseStudies → Availability → Timeline.
 */
@Component({
  selector: 'app-home',
  imports: [
    WolfLandscape,
    FeaturedProducts,
    ServicesMarquee,
    Engagements,
    CaseStudies,
    Availability,
    Timeline,
  ],
  template: `
    <app-wolf-landscape />
    <app-featured-products />
    <app-services-marquee />
    <app-engagements />
    <app-case-studies />
    <app-availability />
    <app-timeline />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
