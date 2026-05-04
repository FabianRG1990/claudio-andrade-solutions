import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface Bubble {
  index: number;
  left: number; // %
  size: number; // px
  delay: number; // s
  duration: number; // s
}

/**
 * BubbleStream — flujo de burbujas ascendentes calculadas de forma
 * determinística (mismo seed por índice → mismo resultado SSR + CSR).
 * Cada burbuja usa la animación `animate-rise` definida en _keyframes.scss.
 */
@Component({
  selector: 'app-bubble-stream',
  templateUrl: './bubble-stream.html',
  styleUrl: './bubble-stream.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BubbleStream {
  readonly count = input(14);

  protected readonly bubbles = computed<Bubble[]>(() =>
    Array.from({ length: this.count() }, (_, i) => ({
      index: i,
      left: (i * 137) % 100,
      size: 4 + ((i * 11) % 12),
      delay: (i * 0.7) % 9,
      duration: 7 + ((i * 3) % 6),
    })),
  );
}
