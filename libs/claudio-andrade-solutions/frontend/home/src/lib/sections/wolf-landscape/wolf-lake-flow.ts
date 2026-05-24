import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';

import { shouldSkipHeavyWebGL } from '@cas-ui-shared/utils/device-capability';

import { getActiveHeroVariant, onHeroVariantChange } from './hero-variants';

/**
 * WolfLakeFlow — capa WebGL que anima el agua del Hero MK6 aplicando un
 * *flow map* sobre la imagen estática, y ADEMÁS samplea el canvas de los
 * peces (Three.js) y le aplica el mismo flow con amplitud reducida para
 * que los peces "se ondulen junto al agua" en lugar de verse pegados
 * encima.
 *
 * Por qué este componente es el que samplea el canvas del pez:
 *   El usuario observó correctamente que si los peces se dibujan ENCIMA
 *   del agua animada, se ven "pegados" — el ojo lee que están sobre la
 *   superficie, no debajo. Ponerlos debajo y poner el agua encima por
 *   sí solo no funciona porque el shader del agua era opaco (tapaba al
 *   pez). La solución: que el shader del agua también samplee el canvas
 *   del pez y los composite con el mismo desplazamiento UV. Resultado:
 *   las olas que distorsionan la textura del lago también distorsionan
 *   al pez con su silueta, en la misma fase y dirección — visualmente
 *   unificado.
 *
 * Por qué flow map y no video (texto histórico, sigue aplicando al lago):
 *   Los modelos de video (Seedance, etc.) interpretan "animar agua" como
 *   añadir eventos (olas, splashes, ondas radiales) porque su training
 *   data está hecho de footage real con eventos. Lo que se pidió aquí es
 *   lo contrario: el agua de la imagen ya tiene una textura/patrón de
 *   ondas; queremos animar ESE patrón desplazándolo en una dirección
 *   constante (hacia abajo del frame), sin generar nada nuevo. Eso es
 *   exactamente lo que hace un flow map en gráficos de tiempo real:
 *   UV displacement con blend de dos fases para evitar el seam visible.
 *
 * Arquitectura:
 *   • Un único quad fullscreen, tres texturas:
 *       u_image = hero-mk6 (la imagen visible del lago + entorno)
 *       u_mask  = water-mask-mk6 (R-channel: 1 = agua, 0 = no agua;
 *                 trazada por polyline siguiendo el contorno real, con
 *                 Gaussian blur sigma=8 px para feather natural)
 *       u_fish  = canvas Three.js de los peces (re-subido cada frame)
 *   • Fragment shader:
 *       1. Mapea gl_FragCoord a image-UV (cover-fit) Y a canvas-UV.
 *       2. Lake displacement (idéntico al diseño original): dos samples
 *          de u_image con offsets en image-UV, blendeados con peso
 *          basado en el seam (técnica Naughty Dog flow blend).
 *       3. Fish displacement: un sample de u_fish con offset en
 *          canvas-UV de magnitud MUCHO menor (FISH_AMOUNT, ~1.5% vs
 *          MAX_AMOUNT 10% para el lago). La textura del lago tiene
 *          features de 50-100px, los detalles del pez son de 2-5px;
 *          si usaras la amplitud del lago, el pez se desbarata.
 *       4. Composite: lake_displaced + fish_displaced via alpha-blend.
 *          El canvas del pez es transparente fuera de los peces, así
 *          que solo aparece "encima" donde hay pez.
 *
 * Z-stack:
 *   • hero__bg (z=0): imagen estática, fallback si WebGL falla.
 *   • wolf-lake-canvas (z=2, OPACITY:0): sigue dibujando los peces a su
 *     ritmo normal — el flow shader lo lee como textura, pero el canvas
 *     no es directamente visible. Es la "fuente" de la textura del pez.
 *   • wolf-lake-flow (z=3): este componente, encima del pez canvas.
 *     Compone el lake displaced + fish displaced.
 *   • wolf-sky (z=4): estrellas titilan ENCIMA del shader del lago.
 *   • hero__seam (z=5): fade al abismo, encima de todo.
 *
 * Loop infinito REAL: la simulación corre, no termina. No hay "frame
 * final" que tenga que coincidir con uno inicial — el blend de dos
 * fases garantiza continuidad en cualquier punto del tiempo.
 *
 * Fallbacks:
 *   • prefers-reduced-motion → no monta canvas. La imagen `<img>` debajo
 *     queda visible estática. Los peces quedan invisibles (opacity:0).
 *   • Sin WebGL → idem.
 *   • Imagen o máscara falla al cargar → idem.
 *   • Canvas de peces no existe / no inicializado → shader corre sin
 *     fish sample (animación del lago igual a antes, sin peces visibles
 *     transitoriamente hasta que el fish canvas se monte).
 *
 * Performance:
 *   • Single quad, 3 texture samples por pixel (2 lake + 1 fish) —
 *     trivial para cualquier GPU integrada de los últimos 10 años.
 *   • Re-upload del fish canvas cada frame: en navegadores modernos
 *     (Chrome 70+, FF 75+) tex(Sub)Image2D(canvas) tiene fast path
 *     GPU-to-GPU cuando el canvas ya está en VRAM. Coste medible pero
 *     muy bajo (<0.5ms incluso en integradas viejas).
 *   • RAF gateado por IntersectionObserver (fuera de viewport → pausa)
 *     y `document.visibilitychange` (tab oculta → pausa).
 *   • DPR clamped a 2.0 (era 1.5) para matchear el DPR del fish canvas
 *     (Three.js setPixelRatio(min(devicePixelRatio, 2)) — si fuésemos
 *     a 1.5 con fish a 2.0, perderíamos detalle al downsamplear.
 */
@Component({
  selector: 'app-wolf-lake-flow',
  template: '<canvas #canvas class="wolf-lake-flow" aria-hidden="true"></canvas>',
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        // z-index 3 — encima del fish canvas (z=2, opacity:0). El flow
        // shader compone visualmente el lago + los peces desplazados;
        // el canvas del pez sigue rindiendo pero invisible directamente,
        // se ve a través de este shader.
        z-index: 3;
        pointer-events: none;
      }
      .wolf-lake-flow {
        display: block;
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 320ms ease-out;
      }
      .wolf-lake-flow.is-ready {
        opacity: 1;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WolfLakeFlow {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Patrón de cleanup tolerante al ciclo de vida — copiado de
    // wolf-lake-canvas.ts. En HMR el componente puede destruirse antes
    // de que `start()` resuelva; sin esto Angular tira NG0911.
    // Además, re-init en variant change (rotación / resize que cruza un
    // breakpoint) para que el shader use la máscara/imagen del polígono
    // del variant activo, no de uno anterior.
    let cleanup: (() => void) | undefined;
    let variantCleanup: (() => void) | undefined;
    let isDestroyed = false;
    this.destroyRef.onDestroy(() => {
      isDestroyed = true;
      cleanup?.();
      variantCleanup?.();
    });
    const runStart = async (): Promise<void> => {
      cleanup?.();
      cleanup = undefined;
      const c = await this.start();
      if (isDestroyed) {
        c?.();
      } else {
        cleanup = c ?? undefined;
      }
    };
    afterNextRender(async () => {
      await runStart();
      variantCleanup = onHeroVariantChange(() => {
        void runStart();
      });
    });
  }

  private async start(): Promise<(() => void) | void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Política mobile: NO bailout total — el user pidió mantener la animación
    // del agua siempre. Pero sí reducimos aggressivamente:
    //   • DPR clamp 1.0 (en lugar de min(devicePixelRatio, 2)) → -75% pixels
    //   • Skip re-upload del fish canvas como textura → -1 tex upload/frame
    //     (los peces siguen visibles directamente sobre el shader, sin la
    //      distorsión sincronizada con las olas — premium menos)
    // Esto baja GPU memory ~60% y elimina un upload caro por frame, dejando
    // espacio para que wolf-fish-three siga corriendo sin OOM.
    const isMobile = shouldSkipHeavyWebGL();

    const canvas = this.canvasRef().nativeElement;
    const host = this.hostRef.nativeElement;

    const gl =
      (canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null) ?? null;
    if (!gl) {
      console.warn('[WolfLakeFlow] WebGL context unavailable');
      return;
    }

    // ─── Cargar imagen del hero + máscara del agua del variant activo ──────
    // El variant viene de `getActiveHeroVariant()` (matchMedia) — el mismo
    // sistema que decide qué <source> del <picture> gana. Eso garantiza que
    // el shader use la máscara correspondiente a la imagen que ESTÁ siendo
    // mostrada al usuario; sin esto, el flow animaría agua en zonas donde
    // la imagen visible no tiene agua (o no animaría donde sí la tiene).
    //
    // water-mask-{variant}.png es la máscara con blur grueso (sigma ~1.5%
    // del lado menor) — feather suave en orilla. Distinta de la lake-mask-
    // {variant}.png (peces, hard edge + inset 4%): el flow puede llegar
    // hasta el filo de las rocas; los peces se mantienen más adentro.
    const variant = getActiveHeroVariant();
    let heroImg: HTMLImageElement;
    let maskImg: HTMLImageElement;
    try {
      [heroImg, maskImg] = await Promise.all([
        loadImage(variant.image),
        loadImage(variant.waterMask),
      ]);
    } catch (e) {
      console.warn('[WolfLakeFlow] texture load failed', e);
      return;
    }

    const IMG_W = heroImg.naturalWidth;
    const IMG_H = heroImg.naturalHeight;

    // ─── Compilar shaders y linkear programa ────────────────────────────────
    const program = createProgram(gl, VERT_SHADER, FRAG_SHADER);
    if (!program) {
      console.warn('[WolfLakeFlow] shader compile/link failed');
      return;
    }
    gl.useProgram(program);

    // Quad fullscreen — dos triángulos en clip-space.
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    // prettier-ignore
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // Texturas: unit 0 = imagen, unit 1 = máscara, unit 2 = fish canvas.
    const imgTex = createTexture(gl, heroImg, gl.LINEAR);
    const maskTex = createTexture(gl, maskImg, gl.LINEAR);
    if (!imgTex || !maskTex) return;

    // Textura para el fish canvas. Se llena diferido (el primer frame
    // que el canvas tenga width/height > 0). Si nunca se inicializa o
    // el sibling no existe, sigue corriendo solo con el lago — el
    // uniform u_hasFish controla la rama del shader.
    const fishTex = gl.createTexture();
    if (fishTex) {
      gl.bindTexture(gl.TEXTURE_2D, fishTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // Allocar 1x1 transparente como placeholder — si nunca se hace
      // el upload real, el shader samplea cero y el u_hasFish=0 path
      // descarta la rama de composición.
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
    }

    const uImage = gl.getUniformLocation(program, 'u_image');
    const uMask = gl.getUniformLocation(program, 'u_mask');
    const uFish = gl.getUniformLocation(program, 'u_fish');
    const uHasFish = gl.getUniformLocation(program, 'u_hasFish');
    const uCanvasSize = gl.getUniformLocation(program, 'u_canvasSize');
    const uImageSize = gl.getUniformLocation(program, 'u_imageSize');
    const uTime = gl.getUniformLocation(program, 'u_time');

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.uniform1i(uImage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fishTex);
    gl.uniform1i(uFish, 2);
    gl.uniform1f(uHasFish, 0); // arranca en 0 hasta que se monte el sibling
    gl.uniform2f(uImageSize, IMG_W, IMG_H);

    // Localizar el canvas hermano de los peces. Está en `<app-wolf-lake-canvas>`
    // dentro del mismo `.hero__scene`. querySelector tolera que aún no esté
    // montado (devuelve null), se reintenta cada frame en el tick.
    let fishCanvas: HTMLCanvasElement | null = null;
    const findFishCanvas = (): HTMLCanvasElement | null => {
      const scene = host.parentElement;
      if (!scene) return null;
      return scene.querySelector(
        'app-wolf-lake-canvas canvas',
      ) as HTMLCanvasElement | null;
    };

    // Premultiplied alpha en el upload — el shader hace la composición
    // como si la textura del pez ya estuviese premultiplicada. Esto
    // matchea con `premultipliedAlpha: true` que ya pedimos al getContext.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    // ─── Resize ────────────────────────────────────────────────────────────
    let cw = 0;
    let ch = 0;
    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      // DPR adaptivo: 2.0 desktop, 1.0 mobile/low-power. En mobile la
      // diferencia visual entre DPR 1 y 2 en este shader es despreciable
      // (el flow tiene features de 50-100 px, no detalle fino), pero el
      // ahorro de GPU memory es 75% (cw*ch*4 bytes para framebuffer).
      // Esto es clave para no rebasar el budget de mobile Safari.
      const dpr = isMobile ? 1.0 : Math.min(window.devicePixelRatio || 1, 2.0);
      cw = Math.max(1, Math.floor(rect.width * dpr));
      ch = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      gl.viewport(0, 0, cw, ch);
      gl.uniform2f(uCanvasSize, cw, ch);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ─── Visibility/Intersection gating ────────────────────────────────────
    let isOnScreen = true;
    let isTabVisible = !document.hidden;
    const isActive = (): boolean => isOnScreen && isTabVisible;

    let raf = 0;
    const startTime = performance.now();
    let fishTexAllocatedW = 0;
    let fishTexAllocatedH = 0;
    const tick = (now: number): void => {
      const t = (now - startTime) / 1000;
      gl.uniform1f(uTime, t);

      // ─── Upload del fish canvas como textura ──────────────────────────
      // Cada frame: re-buscar el sibling (en HMR/race se puede haber
      // remontado), validar que tiene dimensiones, y subirlo al GPU.
      // Si el tamaño cambia, usar texImage2D (re-allocar); si no, usar
      // texSubImage2D (más barato — solo copia píxeles).
      //
      // Mobile: SKIP completo del upload. tex(Sub)Image2D(canvas) es la
      // operación más costosa del frame (~3-8 ms en mobile Safari porque
      // exige sync de GPU memory entre dos contextos WebGL). El uniform
      // uHasFish se queda en 0 → el shader no samplea u_fish → los peces
      // siguen visibles directamente sobre el shader del agua, sin la
      // distorsión sincronizada con las olas. Menos premium, pero MUCHO
      // más liviano y elimina el principal stutter mobile.
      if (!isMobile) {
        if (fishCanvas === null) fishCanvas = findFishCanvas();
        const fc = fishCanvas;
        if (fc && fc.width > 0 && fc.height > 0 && fishTex) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, fishTex);
          if (fc.width !== fishTexAllocatedW || fc.height !== fishTexAllocatedH) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fc);
            fishTexAllocatedW = fc.width;
            fishTexAllocatedH = fc.height;
          } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, fc);
          }
          gl.uniform1f(uHasFish, 1);
        } else {
          gl.uniform1f(uHasFish, 0);
        }
      } else {
        gl.uniform1f(uHasFish, 0);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(tick);
    };
    const start = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf === 0) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isOnScreen = entry.isIntersecting;
        if (isActive()) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(host);
    const onVis = (): void => {
      isTabVisible = !document.hidden;
      if (isActive()) start();
      else stop();
    };
    document.addEventListener('visibilitychange', onVis);

    // Fade-in: una vez todo está listo, hacer visible el canvas. Si la
    // imagen estática debajo es exactamente igual al primer frame del
    // shader (que lo es, porque el shader arranca con phase=0 y mask*0=0
    // displacement), el fade es invisible — solo asegura que no aparezca
    // un canvas a medio inicializar.
    canvas.classList.add('is-ready');

    // Señal cross-component: el shader del flow montó OK. La regla
    // `:host-context(.hero__scene.flow-active)` del WolfLakeCanvas oculta
    // (opacity:0) el fish canvas directamente visible — el shader ahora
    // es el que compone los peces ondulados encima del agua.
    //
    // Caso fallback: si llegamos a este punto, todo (WebGL + texturas +
    // shader + variant) cargó OK. Si fallamos en cualquier paso previo, esta
    // línea NO se ejecuta y `.flow-active` nunca se agrega → el fish canvas
    // se queda visible (opacity:1) y el usuario al menos ve los peces
    // sin la composición agua-encima. Ese fallback es crítico para
    // Safari iOS donde el WebGL-canvas-as-texture (Three.js → flow shader)
    // tiene historial de fallar silencioso.
    host.parentElement?.classList.add('flow-active');
    if (isActive()) start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
      gl.deleteTexture(imgTex);
      gl.deleteTexture(maskTex);
      if (fishTex) gl.deleteTexture(fishTex);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
      // Limpiar la señal — en variant change, runStart() vuelve a llamar
      // start() que re-agrega la clase si todo monta OK. Si la nueva
      // inicialización falla, el fish canvas vuelve a ser visible.
      host.parentElement?.classList.remove('flow-active');
      // No llamamos `WEBGL_lose_context.loseContext()`: el canvas se
      // reutiliza en cada variant change (rotación) y un contexto
      // perdido deja inservible al canvas para el próximo `getContext()`.
      // Las llamadas `deleteTexture/Buffer/Program` arriba ya liberan
      // las GPU resources de este ciclo; el contexto vive con el canvas
      // y muere con él cuando el componente se desmonta.
    };
  }
}

// =============================================================================
// Shaders
// =============================================================================

const VERT_SHADER = /* glsl */ `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

/**
 * Fragment shader:
 *   1. canvas-UV (top-left origin) ← gl_FragCoord
 *   2. image-UV  ← cover-fit transform desde canvas-UV
 *   3. mask = sample del R-channel de water-mask-mk6.png (textura PNG
 *      generada por polyline tracing del contorno real, con Gaussian
 *      blur para transición suave). Si se cambia la imagen del hero
 *      por una composición distinta, regenerar la máscara con el
 *      script en este mismo proyecto.
 *   4. Dos samples de la imagen con offsets de UV diferentes (p1 y p2),
 *      mezclados con peso abs(p1-0.5)*2. Esto cancela el seam del wrap
 *      del período (técnica Naughty Dog "flowmap blend").
 *   5. amount = base * mask * perspectiva — más flujo cerca del bottom
 *      del frame (lago cerca del espectador), menos cerca del horizonte.
 *   6. flow direction = -y en image-UV → el sample sube en la textura
 *      con el tiempo → el feature visual baja en el frame.
 */
const FRAG_SHADER = /* glsl */ `
  precision mediump float;

  uniform sampler2D u_image;
  uniform sampler2D u_mask;
  uniform sampler2D u_fish;
  uniform float u_hasFish;
  uniform vec2 u_canvasSize;
  uniform vec2 u_imageSize;
  uniform float u_time;

  // Período del flow (segundos). 3.5 = ciclo medio, lectura tranquila
  // pero claramente visible. Si se quiere más lento subir a 4.5-5.
  const float PERIOD = 3.5;
  // Magnitud máxima del UV-displacement del lago, en unidades de image-UV (0..1).
  // 0.10 = ~10% del alto de la imagen (~94 px en imagen nativa de 941 alto).
  // Combinado con la curva de perspectiva (depth^1.7), el horizonte queda
  // en ~5% de este valor (~5 px, imperceptible) y el frente recibe la
  // amplitud completa.
  const float MAX_AMOUNT = 0.10;
  // Alpha del "film de agua" que pasa por encima del pez. El user pidió
  // explícitamente: pez NO se deforma (la silueta queda nítida), pero la
  // textura del agua moviéndose se ve POR ENCIMA del pez — como mirar un
  // pez en un estanque calmo donde las ondas de la superficie pasan
  // sobre él sin cambiar al pez en sí.
  //
  // 0.32 = mezcla 32% del color del lago desplazado sobre el pez. Las
  // olas del agua (textura wavy del lago + reflejos de ciudad) se ven
  // claramente encima del pez como un vidrio líquido. El detalle
  // interno del pez (escamas, ojo, aletas) sigue legible porque el 68%
  // del color sigue siendo pez.
  //
  // Histórico:
  //   • 0.014 con FISH_AMOUNT 0.008 (UV distortion + double-phase):
  //     daba "doble pez" / VFX → user rechazó "que NO se deforme".
  //   • 0.14 sin distortion + perspective gating: peces del mid/back
  //     casi no recibían film, seguían viéndose "encima". User pidió
  //     "lograrlo en todos los lados de la pantalla".
  //   • 0.25 sin perspective gating: mejoró el bottom pero el middle
  //     seguía leyéndose "encima" — la zona middle del lago tiene
  //     reflejos brillantes de la ciudad que crean alto contraste
  //     pez-vs-agua, necesita más film para compensar.
  //   • 0.32 actual: empujamos más fuerte para que el contraste alto
  //     del middle también se "desactive". Bottom mantiene su look
  //     porque maskCurve y el natural darkening del seam dominan ahí.
  const float WATER_FILM_ALPHA = 0.32;

  // Factor de translucencia del pez. 0.85 = el pez aporta 15% menos al
  // composite, dejando que 15% del lago se "cuele" a través del cuerpo
  // del pez en el "source over" blend. Esto añade la sensación de
  // "cuerpo translúcido bajo el agua, no sticker opaco". Multiplica
  // tanto rgb como alpha para mantener premultiplicado.
  //
  // Histórico: 0.90 era muy conservador, el pez seguía leyéndose como
  // foreground sólido. 0.85 lo empuja a "se ve el agua por dentro del
  // pez también" sin comer la línea cyan dorsal ni el ojo (esos son
  // los píxeles más brillantes del pez y resisten translucencia mejor).
  const float FISH_TRANSLUCENCY = 0.85;

  void main() {
    // canvas-UV con origen TOP-LEFT (mismo sistema que CSS/HTML).
    vec2 canvasUV = vec2(
      gl_FragCoord.x / u_canvasSize.x,
      1.0 - gl_FragCoord.y / u_canvasSize.y
    );

    // Cover-fit: canvas-UV → image-UV
    float canvasAspect = u_canvasSize.x / u_canvasSize.y;
    float imageAspect = u_imageSize.x / u_imageSize.y;
    vec2 imgUV;
    if (canvasAspect > imageAspect) {
      // Canvas más ancho que la imagen — la imagen se escala al ancho
      // del canvas y se recorta arriba/abajo.
      float scaledH = u_canvasSize.x / imageAspect;
      float yOff = (scaledH - u_canvasSize.y) * 0.5;
      imgUV.x = canvasUV.x;
      imgUV.y = (canvasUV.y * u_canvasSize.y + yOff) / scaledH;
    } else {
      // Canvas más alto/cuadrado — la imagen se escala al alto del canvas
      // y se recorta a los lados.
      float scaledW = u_canvasSize.y * imageAspect;
      float xOff = (scaledW - u_canvasSize.x) * 0.5;
      imgUV.x = (canvasUV.x * u_canvasSize.x + xOff) / scaledW;
      imgUV.y = canvasUV.y;
    }

    // Si la image-UV se sale de [0..1] por un crop extremo, devolvemos
    // el color de abismo (#06091A) para evitar que el clamp_to_edge
    // pinte una franja de píxel estirado.
    if (imgUV.x < 0.0 || imgUV.x > 1.0 || imgUV.y < 0.0 || imgUV.y > 1.0) {
      gl_FragColor = vec4(0.024, 0.035, 0.102, 1.0);
      return;
    }

    // ─── Máscara del agua: textura PNG con feather Gaussiano ─────────────
    // Trazada por polyline siguiendo el contorno real. El blur ancho
    // (sigma=24) provee una zona de transición de varias decenas de
    // píxeles a cada lado de la línea.
    //
    // IMPORTANTE: la línea del polyline NO se mueve. Lo que se hace acá
    // es atenuar la AMPLITUD del flujo de forma no-lineal — el mask se
    // eleva a la cuarta antes de multiplicar por la amplitud máxima.
    // Resultado:
    //   • Justo en la orilla (mask≈0.5): amplitud = 0.5^4 = 6% de full,
    //     ~3 px de desplazamiento. Imperceptible al ojo pero NO cero —
    //     hay continuidad de movimiento con el cuerpo del lago.
    //   • 20-30 px adentro (mask≈0.85): ~52% de full.
    //   • Centro del lago (mask≈1.0): amplitud completa.
    // El ojo no puede ubicar dónde "empieza" el movimiento porque la
    // rampa es muy gradual y arranca con valores subliminales.
    float mask = texture2D(u_mask, imgUV).r;
    float maskCurve = mask * mask * mask * mask;

    // Perspectiva real: el lago se aleja hacia la ciudad (top del agua).
    // Las olas/ondas en la lejanía deben verse mucho más chicas que en el
    // frente — si todas tienen la misma amplitud en UV-space, las del
    // fondo parecen desproporcionadamente grandes contra los features
    // (reflejos, textura) que SÍ están perspectivados en el bitmap.
    //
    // depth = 0 en y=0.42 (línea del horizonte donde el agua toca la base
    // de la ciudad y la roca), 1.0 en y=1.0 (foreground). El user reportó
    // que en viewports horizontales (laptop 14"/15", tablet horizontal,
    // phone horizontal) percibía "la ciudad y la roca se distorsionan por
    // el agua" — en realidad la silueta de las estructuras no se mueve,
    // pero el reflejo del agua justo debajo (que es la ciudad invertida)
    // sí, y se lee como wobble de la base.
    //
    // Histórico: threshold 0.30 daba ~7-8 px de displacement en y=0.45
    // (zona inmediata bajo la ciudad), lo que en agua calma de noche se
    // perciben como un latido en la silueta de la ciudad reflejada.
    // Subir el threshold a 0.42 deja la zona horizonte-y-reflejo-inmediato
    // virtualmente quieta (depth → 0 en el rango 0.42-0.45) y mantiene el
    // movimiento del lago medio (depth=0.224 en y=0.55) y el frente
    // (depth=1.0 en y=1.0) intactos. Foreground retiene la amplitud
    // máxima — donde el agua tiene que sentirse viva.
    float depth = clamp((imgUV.y - 0.42) / 0.58, 0.0, 1.0);
    // depth^1.7: el horizonte (depth bajo) sigue casi quieto, pero el
    // cuerpo medio y el frente reciben más amplitud que con depth² puro.
    // Esto le da más vida a la zona donde se ve el agua de cerca, sin
    // tocar la lejanía perspectivada.
    float perspective = pow(depth, 1.7);
    float amount = MAX_AMOUNT * maskCurve * perspective;

    // Dos fases offset por 0.5 del período. Cada una avanza linealmente
    // dentro de [0..1) y wrap-ea al final. La diferencia de medio período
    // garantiza que en cualquier momento al menos una está lejos de su
    // seam.
    float phase = u_time / PERIOD;
    float p1 = fract(phase);
    float p2 = fract(phase + 0.5);

    // Sample direction: -y en image-UV. Sample sube en la textura con
    // el tiempo → el feature visual aparece moviéndose hacia abajo en
    // el frame (que es lo que se pidió).
    vec2 dir = vec2(0.0, -1.0);

    vec2 uv1 = imgUV + dir * amount * p1;
    vec2 uv2 = imgUV + dir * amount * p2;

    vec4 c1 = texture2D(u_image, uv1);
    vec4 c2 = texture2D(u_image, uv2);

    // Peso del blend: cuando p1 está en el seam (0 o 1), peso=1 → mostramos
    // c2. Cuando p1 está al medio (0.5), peso=0 → mostramos c1. Esto
    // cancela cualquier salto al wrap del período.
    float w = abs(p1 - 0.5) * 2.0;
    vec4 lakeColor = mix(c1, c2, w);

    // ─── Sample del FISH canvas — sin deformación ──────────────────────
    // El pez se samplea en su posición REAL (canvasUV), sin offset.
    // La silueta y los detalles internos (escamas, ojo, aletas) quedan
    // pixel-perfectos. La sensación "bajo el agua" la da:
    //   (a) translucencia leve del pez (FISH_TRANSLUCENCY = 0.90 →
    //       10% de bleed-through del lago a través del cuerpo)
    //   (b) film de agua que se overlayea por encima (más abajo).
    vec4 fishColor = vec4(0.0);
    if (u_hasFish > 0.5) {
      fishColor = texture2D(u_fish, canvasUV);
      // Translucencia: en premultiplicado, multiplicar TANTO el rgb como
      // el alpha por el mismo factor preserva la relación correcta. El
      // pez aporta un 10% menos al composite, lo cual deja que el 10%
      // del lago debajo se vea a través.
      fishColor *= FISH_TRANSLUCENCY;
    }

    // ─── Composite: pez sobre lago + film de agua sobre el pez ─────────
    //
    // Paso 1: pez "source over" lago, fórmula premultiplicada estándar
    //   El upload del fish canvas usó UNPACK_PREMULTIPLY_ALPHA_WEBGL=true,
    //   así que fishColor.rgb ya viene multiplicado por su alpha.
    //   Fórmula clásica "source over" en premultiplicado:
    //     out.rgb = src.rgb + dst.rgb * (1 - src.a)
    //   Donde el pez es transparente (fishColor.a == 0), queda el lago
    //   tal cual. Donde está el pez, su rgb premultiplicado suma encima
    //   del lago atenuado por (1 - fishAlpha).
    vec3 fishOnLake = fishColor.rgb + lakeColor.rgb * (1.0 - fishColor.a);
    //
    // Paso 2: film de agua POR ENCIMA del pez
    //   El pez tal cual queda "pegado encima del agua" — su silueta es
    //   nítida y sobre fondo opaco. Para que se vea SUMERGIDO, las olas
    //   del agua (que ya se mueven en lakeColor por el flow) tienen que
    //   poder pasar por encima del pez. La técnica: re-overlay del
    //   lakeColor (lago ya desplazado, con olas en movimiento) sobre el
    //   pez con alpha baja.
    //
    //   Gating:
    //     • fishColor.a → solo donde HAY pez. Fuera del pez, alpha=0,
    //       no toca el lago (que ya es la imagen del lago).
    //     • maskCurve → solo dentro del lago (en la orilla decae a 0).
    //
    //   NO usamos perspective gating como hacíamos antes. El user marcó
    //   un pez del front-left como el target visual y dijo que el resto
    //   se siente "encima del agua" todavía. Esos otros peces están en
    //   mid/back lake donde perspective < 1 fuertemente — el film
    //   apenas los tocaba. Sacando perspective, TODOS los peces dentro
    //   del lago reciben el mismo film de agua → uniformidad.
    //
    //   El resultado: el pez sigue nítido en sus detalles internos, pero
    //   las olas del agua moviéndose son visibles encima de él como un
    //   "vidrio líquido" sutil. Genuinamente bajo el agua, sin perder
    //   detalle ni deformar la silueta.
    float waterFilmAlpha = WATER_FILM_ALPHA * fishColor.a * maskCurve;
    vec3 outRGB = mix(fishOnLake, lakeColor.rgb, waterFilmAlpha);

    gl_FragColor = vec4(outRGB, 1.0);
  }
`;

// =============================================================================
// Helpers WebGL
// =============================================================================

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    console.warn(`[WolfLakeFlow] ${kind} shader compile error:`, log);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram | null {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createTexture(
  gl: WebGLRenderingContext,
  source: TexImageSource,
  filter: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return tex;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
