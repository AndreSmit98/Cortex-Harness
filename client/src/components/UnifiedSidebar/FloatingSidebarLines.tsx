import { useEffect, useRef } from 'react';
import {
  Clock,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from 'three';

const vertexShader = `
precision highp float;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 iMouse;
uniform float bendInfluence;
uniform vec2 parallaxOffset;

mat2 rotate2d(float angle) {
  return mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
}

vec3 lineGradient(float t) {
  vec3 gold = vec3(0.84, 0.68, 0.30);
  vec3 red = vec3(0.95, 0.13, 0.16);
  vec3 plum = vec3(0.50, 0.27, 0.69);

  if (t < 0.5) {
    return mix(gold, red, smoothstep(0.0, 0.5, t)) * 0.58;
  }

  return mix(red, plum, smoothstep(0.5, 1.0, t)) * 0.58;
}

float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv) {
  float time = iTime * 0.72;
  float amplitude = sin(offset + time * 0.2) * 0.3;
  float y = sin(uv.x + offset + time * 0.1) * amplitude;
  vec2 delta = screenUv - mouseUv;
  float influence = exp(-dot(delta, delta) * 5.2);
  y += (mouseUv.y - screenUv.y) * influence * -0.52 * bendInfluence;
  float distanceToLine = uv.y - y;
  return 0.0175 / max(abs(distanceToLine) + 0.01, 0.001) + 0.01;
}

void main() {
  vec2 baseUv = (2.0 * gl_FragCoord.xy - iResolution.xy) / iResolution.y;
  baseUv.y *= -1.0;
  baseUv.x *= 2.75;
  baseUv += parallaxOffset;

  vec2 mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
  mouseUv.y *= -1.0;
  mouseUv.x *= 2.75;
  vec3 color = vec3(0.0);

  for (int index = 0; index < 7; index++) {
    float lineIndex = float(index);
    float t = lineIndex / 6.0;
    float angle = 0.24 * log(length(baseUv) + 1.0);
    vec2 uv = baseUv * rotate2d(angle);
    color += lineGradient(t) * wave(
      uv + vec2(0.05 * lineIndex + 5.0, 0.02),
      2.0 + 0.15 * lineIndex,
      baseUv,
      mouseUv
    ) * 0.74;
  }

  float energy = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
  vec3 chroma = clamp(color / max(energy, 0.0001), 0.0, 1.0);
  float edgeFade = smoothstep(0.0, 0.16, gl_FragCoord.x / iResolution.x)
    * smoothstep(0.0, 0.16, 1.0 - (gl_FragCoord.x / iResolution.x));

  float lineAlpha = pow(energy, 1.65) * 0.52;
  gl_FragColor = vec4(chroma, lineAlpha * edgeFade);
}
`;

function FloatingSidebarLines() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPowerDevice = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2;

    if (!container || prefersReducedMotion || lowPowerDevice || !window.WebGLRenderingContext) {
      return;
    }

    let active = true;
    let frameId = 0;
    const targetMouse = new Vector2(-1000, -1000);
    const currentMouse = new Vector2(-1000, -1000);
    const targetParallax = new Vector2(0, 0);
    const currentParallax = new Vector2(0, 0);
    let targetInfluence = 0;
    let currentInfluence = 0;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new Vector2(1, 1) },
      iMouse: { value: new Vector2(-1000, -1000) },
      bendInfluence: { value: 0 },
      parallaxOffset: { value: new Vector2(0, 0) },
    };
    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, material);
    const clock = new Clock();
    scene.add(mesh);

    const setSize = () => {
      if (!active) {
        return;
      }
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.iResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const isInside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!isInside) {
        targetInfluence = 0;
        targetParallax.set(0, 0);
        return;
      }

      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const pixelRatio = renderer.getPixelRatio();
      targetMouse.set(x * pixelRatio, (bounds.height - y) * pixelRatio);
      targetInfluence = 1;
      targetParallax.set((x / bounds.width - 0.5) * 0.18, -(y / bounds.height - 0.5) * 0.18);
    };

    const resizeObserver = new ResizeObserver(setSize);
    resizeObserver.observe(container);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    setSize();

    const render = () => {
      if (!active) {
        return;
      }
      uniforms.iTime.value = clock.getElapsedTime();
      currentMouse.lerp(targetMouse, 0.055);
      uniforms.iMouse.value.copy(currentMouse);
      currentInfluence += (targetInfluence - currentInfluence) * 0.055;
      uniforms.bendInfluence.value = currentInfluence;
      currentParallax.lerp(targetParallax, 0.045);
      uniforms.parallaxOffset.value.copy(currentParallax);
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('pointermove', handlePointerMove);
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={containerRef} className="cortex-floating-lines" aria-hidden="true" />;
}

export default FloatingSidebarLines;
