import nx from '@nx/eslint-plugin';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // ── Eje scope (aislamiento horizontal de dominio) ──
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:claudio-andrade-solutions',
              onlyDependOnLibsWithTags: ['scope:claudio-andrade-solutions', 'scope:shared'],
            },
            // ── Eje type (capas verticales — la dependencia fluye en una sola dirección) ──
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:util',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:util',
                'type:shared',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:shared'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util', 'type:shared'],
            },
            {
              sourceTag: 'type:shared',
              onlyDependOnLibsWithTags: ['type:shared', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },

  // ── Mantenibilidad: tamaño + complejidad ──────────────────────────────────
  // Introducidas como `warn` (no `error`) porque el repo es brown-field y hay
  // funciones que aún las violan (componentes gordos, motores canvas). Como
  // `warn` se hacen VISIBLES sin romper el build/CI. Promover a `error` cuando
  // las violaciones se hayan limpiado (separación de componentes — Tier B/C).
  // Señal primaria = complejidad cognitiva (branching), no longitud.
  {
    files: ['**/*.ts'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['warn', 15],
      complexity: ['warn', { max: 15 }],
      'max-depth': ['warn', 4],
      'max-nested-callbacks': ['warn', 4],
      'max-params': ['warn', { max: 4 }],
      'max-lines-per-function': [
        'warn',
        { max: 75, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-statements': ['warn', { max: 20 }],
      'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },

  // Motores de render canvas/WebGL/simulación: un concepto cohesivo, grandes
  // por naturaleza. Se exenta tamaño (líneas), NO complejidad por función.
  {
    files: ['**/*-canvas.ts', '**/*-three.ts', '**/*-flow.ts', '**/*-fish.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
    },
  },

  // Datos / contenido / fixtures: son datos, no lógica. Linterar longitud o
  // complejidad acá no aporta.
  {
    files: ['**/data/data.ts', '**/*.data.ts', '**/*.const.ts', '**/hero-variants.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'sonarjs/cognitive-complexity': 'off',
    },
  },

  // Specs: bloques arrange/act/assert legítimamente largos.
  {
    files: ['**/*.spec.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
    },
  },
];
