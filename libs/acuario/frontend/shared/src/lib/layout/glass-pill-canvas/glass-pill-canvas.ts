import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * GlassPillCanvas — pill 3D fotorreal sin gris en el cuerpo.
 *
 * Custom ShaderMaterial que solo dibuja los HIGHLIGHTS del cristal:
 *  - Rim glow (efecto Fresnel en los bordes vistos en ángulo rasante)
 *  - Top catchlight (luz cayendo sobre la cara superior)
 *
 * El cuerpo del pill se DISCARD-ea directo en el fragment shader (línea
 * `if (alpha < 0.04) discard;`). No se renderiza ni un solo pixel del
 * body — es matemáticamente invisible. El gris es imposible que aparezca
 * porque no hay píxeles dibujados ahí.
 *
 * El motor (Three.js) corre solo en el browser (afterNextRender garantiza
 * SSR-safe).
 */
@Component({
  selector: 'app-glass-pill-canvas',
  templateUrl: './glass-pill-canvas.html',
  styleUrl: './glass-pill-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlassPillCanvas {
  private readonly containerRef =
    viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const cleanup = this.initThreeJs();
      this.destroyRef.onDestroy(() => cleanup?.());
    });
  }

  private initThreeJs(): (() => void) | void {
    const container = this.containerRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;

    // prefers-reduced-motion → no canvas WebGL. Estado pill plano puro CSS.
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotion) return;

    // ─── Renderer ────────────────────────────────────────────────
    // antialias: false (antes true). MSAA es muy costoso en GPU. El pill es
    // una geometría pequeña con sólo highlights — los bordes apenas se notan
    // sin antialias gracias al fragment-discard del shader.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    // DPR 1.5 (antes 2). Pill chico, diferencia visual mínima.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    // ─── Scene + Camera ──────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);

    // ─── Custom ShaderMaterial — solo rim glow + top catchlight.
    //     Sin env map, sin lights, sin transmission. El cuerpo NUNCA se
    //     dibuja porque el fragment shader lo discarea.
    const material = new THREE.ShaderMaterial({
      uniforms: {
        rimIntensity: { value: 0.65 },
        topIntensity: { value: 0.5 },
        rimPower: { value: 2.5 },
        topPower: { value: 2.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        uniform float rimIntensity;
        uniform float topIntensity;
        uniform float rimPower;
        uniform float topPower;

        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(vViewDir);

          // Fresnel rim: 0 cuando la cara mira directo a la cámara,
          // 1 en ángulo rasante (los bordes laterales de la geometría)
          float facing = max(dot(N, V), 0.0);
          float fresnel = pow(1.0 - facing, rimPower);

          // Top catchlight: las caras que apuntan hacia arriba reciben
          // un highlight definido (la luz "del cielo")
          float topDot = max(vWorldNormal.y, 0.0);
          float topness = pow(topDot, topPower);

          float alpha = fresnel * rimIntensity + topness * topIntensity;
          alpha = clamp(alpha, 0.0, 1.0);

          // DISCARD: si el alpha es menor a 0.04, no dibujamos nada.
          // Pura transparencia matemática — sin píxeles del body.
          if (alpha < 0.04) discard;

          vec3 color = vec3(1.0);
          gl_FragColor = vec4(color * alpha, alpha);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    // ─── Geometría inicial (se reescala con resize) ──────────────
    let geometry = new RoundedBoxGeometry(6, 1, 0.45, 12, 0.45);
    const pill = new THREE.Mesh(geometry, material);
    scene.add(pill);

    // ─── Resize ──────────────────────────────────────────────────
    // Calcula camera.z exacta para que el pill ocupe ~95% del canvas.
    // visible_height = 2 * cameraZ * tan(FOV/2)
    // Para que pillH llene el 95%: visible_height = pillH / 0.95
    // → cameraZ = pillH / (2 * tan(FOV/2) * 0.95)
    const FOV_RAD = (28 * Math.PI) / 180;
    const TAN_HALF_FOV = Math.tan(FOV_RAD / 2);

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      const pillH = 1.0;
      const pillW = (pillH * w) / h;
      const pillD = 0.42;
      const radius = pillH / 2 - 0.04;
      geometry.dispose();
      geometry = new RoundedBoxGeometry(pillW, pillH, pillD, 16, radius);
      pill.geometry = geometry;

      camera.position.z = pillH / (2 * TAN_HALF_FOV * 0.95);
    };

    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    updateSize();

    // ─── Pointer tilt sutil ──────────────────────────────────────
    let targetRotX = 0;
    let targetRotY = 0;
    const onMove = (e: PointerEvent): void => {
      const rect = container.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      targetRotY = nx * 0.2;
      targetRotX = -ny * 0.12;
    };
    const onLeave = (): void => {
      targetRotX = 0;
      targetRotY = 0;
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);

    // ─── Render loop ─────────────────────────────────────────────
    // Pausa cuando la tab está oculta. Adicionalmente, solo redibuja cuando
    // el pill todavía está animando (rotación hacia targetRot* > epsilon) o
    // cuando el cursor lo está manipulando. Estado quieto = 0 frames GPU.
    let raf = 0;
    let isTabVisible = !document.hidden;

    const start = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onVisChange = (): void => {
      isTabVisible = !document.hidden;
      if (isTabVisible) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVisChange);

    const tick = (): void => {
      const dx = targetRotX - pill.rotation.x;
      const dy = targetRotY - pill.rotation.y;
      pill.rotation.x += dx * 0.08;
      pill.rotation.y += dy * 0.08;
      renderer.render(scene, camera);

      // Si el pill ya está sentado en el target y no hay interacción, deja
      // de pedir frames. Se reanuda solo cuando onMove vuelva a cambiar el
      // target (y onMove llama start() abajo).
      const settled =
        Math.abs(dx) < 0.0005 &&
        Math.abs(dy) < 0.0005 &&
        Math.abs(targetRotX) < 0.001 &&
        Math.abs(targetRotY) < 0.001;
      if (settled) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    // Reaviva el RAF cuando llegan eventos (o el ResizeObserver dispara).
    const onMoveWithWake = (e: PointerEvent): void => {
      onMove(e);
      if (isTabVisible) start();
    };
    const onLeaveWithWake = (): void => {
      onLeave();
      if (isTabVisible) start();
    };
    container.removeEventListener('pointermove', onMove);
    container.removeEventListener('pointerleave', onLeave);
    container.addEventListener('pointermove', onMoveWithWake);
    container.addEventListener('pointerleave', onLeaveWithWake);

    // Reanuda render tras un resize (geometry cambió → necesita un repaint).
    const updateSizeWithWake = (): void => {
      updateSize();
      if (isTabVisible) start();
    };
    ro.disconnect();
    const ro2 = new ResizeObserver(updateSizeWithWake);
    ro2.observe(container);

    start();

    return () => {
      stop();
      ro2.disconnect();
      document.removeEventListener('visibilitychange', onVisChange);
      container.removeEventListener('pointermove', onMoveWithWake);
      container.removeEventListener('pointerleave', onLeaveWithWake);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }
}
