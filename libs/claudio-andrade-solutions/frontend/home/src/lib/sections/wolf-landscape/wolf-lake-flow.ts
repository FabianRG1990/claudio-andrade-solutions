import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';

/**
 * WolfLakeFlow — capa WebGL que anima EXCLUSIVAMENTE el agua del Hero MK6
 * aplicando un *flow map* sobre la imagen estática.
 *
 * Por qué flow map y no video:
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
 *   • Un único quad fullscreen, dos texturas:
 *       u_image = hero-mk6 (la imagen visible)
 *       u_mask  = water-mask-mk6 (R-channel: 1 = agua, 0 = no agua;
 *                 trazada por polyline siguiendo el contorno real, con
 *                 Gaussian blur sigma=8 px para feather natural)
 *   • El fragment shader:
 *       1. Mapea gl_FragCoord a image-UV con `object-fit: cover` math.
 *       2. Lee la máscara — si es 0, el pixel sale idéntico a la imagen
 *          original (sin displacement, sin blend).
 *       3. Si es > 0, calcula dos samples de la imagen a offsets de UV
 *          (uno con fase p1, otro con fase p1+0.5), y los mezcla con
 *          peso `abs(p1-0.5)*2`. Esa es la técnica Naughty Dog: en el
 *          momento que un sample llega al seam (wrap del período), el
 *          otro está en el centro de su ciclo, así no se nota el corte.
 *   • Sobre el dispalcement: dirección -y en image-UV (sample sube → el
 *     feature visualmente baja en pantalla). Magnitud escalada por
 *     `imgUV.y` para perspectiva (más flujo cerca del espectador, menos
 *     en el horizonte).
 *
 * Loop infinito REAL: la simulación corre, no termina. No hay "frame
 * final" que tenga que coincidir con uno inicial — el blend de dos
 * fases garantiza continuidad en cualquier punto del tiempo.
 *
 * Fallbacks:
 *   • prefers-reduced-motion → no monta canvas. La imagen `<img>` debajo
 *     queda visible estática.
 *   • Sin WebGL → idem.
 *   • Imagen o máscara falla al cargar → idem.
 *
 * Performance:
 *   • Single quad, 2 texture samples por pixel — trivial para cualquier
 *     GPU integrada de los últimos 10 años.
 *   • RAF gateado por IntersectionObserver (fuera de viewport → pausa)
 *     y `document.visibilitychange` (tab oculta → pausa).
 *   • DPR clamped a 1.5 — no merece subir más, el efecto es de textura
 *     suave y no muestra alising a >1.5.
 */
@Component({
  selector: 'app-wolf-lake-flow',
  template: '<canvas #canvas class="wolf-lake-flow" aria-hidden="true"></canvas>',
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        z-index: 0;
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
    let cleanup: (() => void) | undefined;
    let isDestroyed = false;
    this.destroyRef.onDestroy(() => {
      isDestroyed = true;
      cleanup?.();
    });
    afterNextRender(async () => {
      const c = await this.start();
      if (isDestroyed) {
        c?.();
      } else {
        cleanup = c ?? undefined;
      }
    });
  }

  private async start(): Promise<(() => void) | void> {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      console.info('[WolfLakeFlow] skipped: prefers-reduced-motion');
      return;
    }

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

    // ─── Cargar imagen del hero + máscara del agua ──────────────────────────
    // water-mask-mk6.png se generó por polyline tracing del contorno real
    // del agua (siguiendo el filo de las rocas y los árboles), con un
    // Gaussian blur sigma=8 px para feather suave en el borde. R-channel:
    // 1 = agua (animar), 0 = no-agua (estático).
    //
    // Se usa esta máscara en vez de lake-mask-mk3.png — esta es para el
    // flow del agua; la otra está calibrada para los peces (zona más
    // interior). La máscara para el flow puede llegar al filo de las
    // rocas y a la orilla.
    let heroImg: HTMLImageElement;
    let maskImg: HTMLImageElement;
    try {
      [heroImg, maskImg] = await Promise.all([
        loadImage('/hero-wolf/hero-mk6.webp'),
        loadImage('/hero-wolf/water-mask-mk6.png'),
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
    console.info('[WolfLakeFlow] mounted ok — flow map running');

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

    // Texturas: unit 0 = imagen, unit 1 = máscara.
    const imgTex = createTexture(gl, heroImg, gl.LINEAR);
    const maskTex = createTexture(gl, maskImg, gl.LINEAR);
    if (!imgTex || !maskTex) return;

    const uImage = gl.getUniformLocation(program, 'u_image');
    const uMask = gl.getUniformLocation(program, 'u_mask');
    const uCanvasSize = gl.getUniformLocation(program, 'u_canvasSize');
    const uImageSize = gl.getUniformLocation(program, 'u_imageSize');
    const uTime = gl.getUniformLocation(program, 'u_time');

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.uniform1i(uImage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(uMask, 1);
    gl.uniform2f(uImageSize, IMG_W, IMG_H);

    // ─── Resize ────────────────────────────────────────────────────────────
    let cw = 0;
    let ch = 0;
    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
    const tick = (now: number): void => {
      const t = (now - startTime) / 1000;
      gl.uniform1f(uTime, t);
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
    if (isActive()) start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
      gl.deleteTexture(imgTex);
      gl.deleteTexture(maskTex);
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
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
  uniform vec2 u_canvasSize;
  uniform vec2 u_imageSize;
  uniform float u_time;

  // Período del flow (segundos). 3.5 = ciclo medio, lectura tranquila
  // pero claramente visible. Si se quiere más lento subir a 4.5-5.
  const float PERIOD = 3.5;
  // Magnitud máxima del UV-displacement, en unidades de image-UV (0..1).
  // 0.07 = ~7% del alto de la imagen (~66 px en imagen nativa de 941 alto).
  const float MAX_AMOUNT = 0.07;

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
    // depth = 0 en y=0.30 (justo arriba del waterline más alto), 1.0 en
    // y=1.0 (foreground). Cuadrado para que el fondo casi no se mueva
    // y el frente reciba la amplitud máxima.
    float depth = clamp((imgUV.y - 0.30) / 0.70, 0.0, 1.0);
    float perspective = depth * depth;
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
    gl_FragColor = mix(c1, c2, w);
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
