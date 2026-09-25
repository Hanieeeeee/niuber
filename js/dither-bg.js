/**
 * Full-page dithered wave background (reactbits Dither port — vanilla WebGL2).
 * One fixed canvas behind hero + app so the surface is continuous.
 */

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// wave pattern + 8x8 Bayer dither in one pass (no postprocessing chain needed)
const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWaveSpeed;
uniform float uWaveFrequency;
uniform float uWaveAmplitude;
uniform vec3 uWaveColor;
uniform vec3 uBackgroundColor;
uniform vec2 uMousePos;
uniform float uEnableMouse;
uniform float uMouseRadius;
uniform float uColorNum;
uniform float uPixelSize;
in vec2 vUv;
out vec4 outColor;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = uWaveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= uWaveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - uTime * uWaveSpeed;
  return fbm(p + fbm(p2));
}

const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * uResolution / uPixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / max(uColorNum - 1.0, 1.0);
  color += threshold * step;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float bias = mix(0.2, 0.0, smoothstep(0.45, 0.8, luminance));
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (uColorNum - 1.0) + 0.5) / max(uColorNum - 1.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  uv -= 0.5;
  uv.x *= uResolution.x / uResolution.y;
  float f = pattern(uv);

  if (uEnableMouse > 0.5) {
    vec2 mouseNDC = (uMousePos / uResolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= uResolution.x / uResolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, uMouseRadius, dist);
    f -= 0.5 * effect;
  }

  vec3 col = mix(uBackgroundColor, uWaveColor, clamp(f, 0.0, 1.0));
  vec2 duv = gl_FragCoord.xy / uResolution.xy;
  col = dither(duv, col);
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 */
export function initDitherBackground(canvas, opts = {}) {
  const {
    waveColor = [0.52, 0.46, 0.46],
    backgroundColor = [0.035, 0.035, 0.04],
    colorNum = 4,
    pixelSize = 2,
    waveSpeed = 0.05,
    waveFrequency = 3,
    waveAmplitude = 0.3,
    enableMouseInteraction = true,
    mouseRadius = 0.35,
  } = opts;

  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    canvas.style.display = 'none';
    document.body.classList.add('no-dither');
    return () => {};
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    canvas.style.display = 'none';
    document.body.classList.add('no-dither');
    return () => {};
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    canvas.style.display = 'none';
    document.body.classList.add('no-dither');
    return () => {};
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    resolution: gl.getUniformLocation(prog, 'uResolution'),
    time: gl.getUniformLocation(prog, 'uTime'),
    waveSpeed: gl.getUniformLocation(prog, 'uWaveSpeed'),
    waveFrequency: gl.getUniformLocation(prog, 'uWaveFrequency'),
    waveAmplitude: gl.getUniformLocation(prog, 'uWaveAmplitude'),
    waveColor: gl.getUniformLocation(prog, 'uWaveColor'),
    backgroundColor: gl.getUniformLocation(prog, 'uBackgroundColor'),
    mousePos: gl.getUniformLocation(prog, 'uMousePos'),
    enableMouse: gl.getUniformLocation(prog, 'uEnableMouse'),
    mouseRadius: gl.getUniformLocation(prog, 'uMouseRadius'),
    colorNum: gl.getUniformLocation(prog, 'uColorNum'),
    pixelSize: gl.getUniformLocation(prog, 'uPixelSize'),
  };

  gl.uniform1f(U.waveSpeed, waveSpeed);
  gl.uniform1f(U.waveFrequency, waveFrequency);
  gl.uniform1f(U.waveAmplitude, waveAmplitude);
  gl.uniform3f(U.waveColor, waveColor[0], waveColor[1], waveColor[2]);
  gl.uniform3f(U.backgroundColor, backgroundColor[0], backgroundColor[1], backgroundColor[2]);
  gl.uniform1f(U.colorNum, colorNum);
  gl.uniform1f(U.pixelSize, pixelSize);
  gl.uniform1f(U.mouseRadius, mouseRadius);
  gl.uniform1f(U.enableMouse, enableMouseInteraction ? 1 : 0);

  const mouse = { x: 0, y: 0 };
  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  };
  if (enableMouseInteraction) window.addEventListener('pointermove', onMove, { passive: true });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(U.resolution, w, h);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  let raf = 0;
  let start = performance.now();
  let visible = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!visible && document.hidden) return;
    const t = reduceMotion ? 0 : (now - start) / 1000;
    gl.uniform1f(U.time, t);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    gl.uniform2f(U.mousePos, mouse.x * dpr, mouse.y * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', resize);
    io.disconnect();
  };
}
