import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Conservation } from '../../sections/conservation/conservation';
import { FeaturedExhibits } from '../../sections/featured-exhibits/featured-exhibits';
import { Hero } from '../../sections/hero/hero';
import { Membership } from '../../sections/membership/membership';
import { SpeciesMarquee } from '../../sections/species-marquee/species-marquee';
import { Timeline } from '../../sections/timeline/timeline';
import { Visit } from '../../sections/visit/visit';
import { WolfLandscape } from '../../sections/wolf-landscape/wolf-landscape';

/**
 * HomePage — composición del manifiesto. WolfLandscape es un segmento
 * autónomo que abre la página antes del hero (en construcción —
 * iteramos visual con el cliente).
 *   WolfLandscape → Hero → FeaturedExhibits → SpeciesMarquee →
 *   Membership → Conservation → Visit → Timeline.
 */
@Component({
  selector: 'app-home',
  imports: [
    WolfLandscape,
    Hero,
    FeaturedExhibits,
    SpeciesMarquee,
    Membership,
    Conservation,
    Visit,
    Timeline,
  ],
  template: `
    <app-wolf-landscape />
    <app-hero />
    <app-featured-exhibits />
    <app-species-marquee />
    <app-membership />
    <app-conservation />
    <app-visit />
    <app-timeline />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
