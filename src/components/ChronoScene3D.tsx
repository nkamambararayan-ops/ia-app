import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import { getTimeRemaining } from '../lib/time';

type FinishId = 'brass' | 'titanium' | 'obsidian';
type CameraPreset = 'orbit' | 'front' | 'zenith';

interface ChronoScene3DProps {
  title: string;
  targetIso: string;
  createdIso?: string;
  accentColor?: string;
}

const FINISH_PALETTES: Record<
  FinishId,
  { label: string; primary: number; secondary: number; swatch: string }
> = {
  brass: { label: 'Or brossé', primary: 0xd4a34f, secondary: 0x262d3d, swatch: '#d4a34f' },
  titanium: { label: 'Titane', primary: 0xcbd5e1, secondary: 0x334155, swatch: '#cbd5e1' },
  obsidian: { label: 'Obsidienne', primary: 0x3f4756, secondary: 0xd97706, swatch: '#3f4756' },
};

const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number] }> = {
  orbit: { label: 'Perspective', pos: [4.2, 2.8, 5.2] },
  front: { label: 'Face', pos: [0, 1.45, 6.4] },
  zenith: { label: 'Zénith', pos: [0.2, 6.4, 1.8] },
};

const _targetVec = new THREE.Vector3(0, 1.25, 0);
const _camGoal = new THREE.Vector3();
const _dummy = new THREE.Object3D();

function createBrushedRoughnessTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) {
      const shade = 110 + Math.floor(Math.random() * 50);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function createDialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);

    const grad = ctx.createRadialGradient(256, 256, 40, 256, 256, 240);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(256, 256, 245, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#d4a34f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(256, 256, 230, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const major = i % 5 === 0;
      const r1 = major ? 196 : 208;
      const r2 = 222;
      ctx.strokeStyle = major ? '#f8fafc' : '#94a3b8';
      ctx.lineWidth = major ? 3 : 1.2;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(angle) * r1, 256 + Math.sin(angle) * r1);
      ctx.lineTo(256 + Math.cos(angle) * r2, 256 + Math.sin(angle) * r2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const ChronoScene3D: React.FC<ChronoScene3DProps> = ({
  title,
  targetIso,
  createdIso,
  accentColor = '#d97706',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const targetIsoRef = useRef(targetIso);
  const createdIsoRef = useRef(createdIso);
  const accentRef = useRef(accentColor);

  const [finish, setFinish] = useState<FinishId>('brass');
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [exploded, setExploded] = useState(0);
  const [dockOpen, setDockOpen] = useState(true);
  const [fullBleed, setFullBleed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const finishRef = useRef<FinishId>(finish);
  const explodedRef = useRef(0);
  const presetTriggerRef = useRef<{ active: boolean; pos: [number, number, number] }>({
    active: false,
    pos: CAMERA_PRESETS.orbit.pos,
  });
  const applyFinishFnRef = useRef<((f: FinishId) => void) | null>(null);

  useEffect(() => {
    targetIsoRef.current = targetIso;
    createdIsoRef.current = createdIso;
    accentRef.current = accentColor;
  }, [targetIso, createdIso, accentColor]);

  useEffect(() => {
    finishRef.current = finish;
    applyFinishFnRef.current?.(finish);
  }, [finish]);

  useEffect(() => {
    explodedRef.current = exploded;
  }, [exploded]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'h') {
        setDockOpen((prev) => !prev);
      } else if (e.key === 'Escape' && fullBleed) {
        setFullBleed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullBleed]);

  const selectPreset = (p: CameraPreset) => {
    setPreset(p);
    presetTriggerRef.current = { active: true, pos: CAMERA_PRESETS[p].pos };
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 440;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);
    scene.fog = new THREE.FogExp2(0x0b1120, 0.042);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);
    camera.position.set(...CAMERA_PRESETS.orbit.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const brushedRoughnessTex = createBrushedRoughnessTexture();
    brushedRoughnessTex.anisotropy = maxAniso;

    const dialTex = createDialTexture();
    dialTex.anisotropy = maxAniso;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    // 3-Point Studio Lighting with warm/cool temperature contrast
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.25);
    keyLight.position.set(5, 7, 4);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.15);
    rimLight.position.set(-5, 4, -4);
    scene.add(rimLight);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softbox = new THREE.RectAreaLight(0xffffff, 2.6, 4.2, 2);
      softbox.position.set(0, 4.8, 2.5);
      softbox.lookAt(0, 1.25, 0);
      scene.add(softbox);
    }

    // Ground floor & soft radial contact shadow
    const floorGeo = new THREE.CircleGeometry(18, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.78,
      metalness: 0.14,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d');
    if (sctx) {
      const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0,0,0,0.68)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const contactPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    contactPlane.rotation.x = -Math.PI / 2;
    contactPlane.position.y = 0.015;
    scene.add(contactPlane);

    // Composite 10-part Chrono-Astrolabe Group
    const astrolabe = new THREE.Group();
    scene.add(astrolabe);

    const primaryMetalMat = new THREE.MeshPhysicalMaterial({
      color: FINISH_PALETTES.brass.primary,
      metalness: 0.94,
      roughness: 0.2,
      roughnessMap: brushedRoughnessTex,
      clearcoat: 0.45,
      anisotropy: 0.8,
    });

    const secondaryHousingMat = new THREE.MeshStandardMaterial({
      color: FINISH_PALETTES.brass.secondary,
      metalness: 0.42,
      roughness: 0.56,
    });

    const dialPlateMat = new THREE.MeshStandardMaterial({
      map: dialTex,
      roughness: 0.45,
      metalness: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentRef.current),
      emissive: new THREE.Color(accentRef.current),
      emissiveIntensity: 0.7,
      roughness: 0.22,
      metalness: 0.45,
    });

    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.05,
      roughness: 0.08,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: isSoftwareGl ? 0.35 : 1,
      ior: 1.56,
      thickness: 1.0,
      clearcoat: 1.0,
    });

    // Part 1: Lathe sculpted architectural pedestal (bottom-center flush at y = 0)
    const lathePoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(1.44, 0.0),
      new THREE.Vector2(1.38, 0.12),
      new THREE.Vector2(1.06, 0.2),
      new THREE.Vector2(0.95, 0.28),
      new THREE.Vector2(0.46, 0.36),
      new THREE.Vector2(0.0, 0.36),
    ];
    const pedestalGeo = new THREE.LatheGeometry(lathePoints, 48);
    pedestalGeo.computeTangents();
    const pedestal = new THREE.Mesh(pedestalGeo, secondaryHousingMat);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    astrolabe.add(pedestal);

    // Part 2: Pedestal bezel collar
    const collarGeo = new THREE.TorusGeometry(1.06, 0.036, 16, 64);
    const collar = new THREE.Mesh(collarGeo, primaryMetalMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.2;
    astrolabe.add(collar);

    // Part 3: Procedural engraved chapter dial plate
    const dialPlate = new THREE.Mesh(new THREE.CircleGeometry(0.92, 64), dialPlateMat);
    dialPlate.rotation.x = -Math.PI / 2;
    dialPlate.position.y = 0.37;
    astrolabe.add(dialPlate);

    // Part 4: Vertical cradle arc
    const cradleGeo = new THREE.TorusGeometry(1.56, 0.055, 18, 72, Math.PI * 1.18);
    const cradle = new THREE.Mesh(cradleGeo, secondaryHousingMat);
    cradle.position.y = 1.45;
    cradle.rotation.z = -Math.PI * 1.09;
    cradle.castShadow = true;
    astrolabe.add(cradle);

    // Part 5: Outer Days Orbital Ring
    const daysRingGeo = new THREE.TorusGeometry(1.32, 0.046, 20, 84);
    daysRingGeo.computeTangents();
    const daysRing = new THREE.Mesh(daysRingGeo, primaryMetalMat);
    daysRing.position.y = 1.45;
    daysRing.castShadow = true;
    astrolabe.add(daysRing);

    // Part 6: Middle Hours Gimbal Ring
    const hoursRingGeo = new THREE.TorusGeometry(1.02, 0.038, 18, 72);
    hoursRingGeo.computeTangents();
    const hoursRing = new THREE.Mesh(hoursRingGeo, primaryMetalMat);
    hoursRing.position.y = 1.45;
    hoursRing.castShadow = true;
    astrolabe.add(hoursRing);

    // Part 7: Inner Minutes & Seconds Ring + orbiting seconds sphere
    const minutesRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.03, 16, 64),
      secondaryHousingMat
    );
    minutesRing.position.y = 1.45;
    astrolabe.add(minutesRing);

    const secondsOrb = new THREE.Mesh(new THREE.SphereGeometry(0.068, 20, 20), accentMat);
    secondsOrb.position.set(0.74, 0, 0);
    minutesRing.add(secondsOrb);

    // Part 8: Crystal Core & Luminous Nucleus
    const coreShell = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 1), crystalMat);
    coreShell.position.y = 1.45;
    coreShell.renderOrder = 2;
    astrolabe.add(coreShell);

    const innerNucleus = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), accentMat);
    innerNucleus.position.y = 1.45;
    astrolabe.add(innerNucleus);

    // Part 9: Beveled crown finial atop cradle
    const crownShape = new THREE.Shape();
    crownShape.moveTo(-0.14, 0);
    crownShape.lineTo(0.14, 0);
    crownShape.lineTo(0.08, 0.16);
    crownShape.lineTo(-0.08, 0.16);
    crownShape.closePath();
    const crownGeo = new THREE.ExtrudeGeometry(crownShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    });
    crownGeo.center();
    const crownMesh = new THREE.Mesh(crownGeo, primaryMetalMat);
    crownMesh.position.y = 3.06;
    astrolabe.add(crownMesh);

    // Part 10: 60 Instanced Precision Tick Notches
    const tickCount = 60;
    const tickGeo = new THREE.BoxGeometry(0.018, 0.06, 0.025);
    const ticksMesh = new THREE.InstancedMesh(tickGeo, primaryMetalMat, tickCount);
    for (let i = 0; i < tickCount; i++) {
      const angle = (i / tickCount) * Math.PI * 2;
      const isMajor = i % 5 === 0;
      _dummy.position.set(Math.cos(angle) * 1.24, Math.sin(angle) * 1.24, 0);
      _dummy.rotation.set(0, 0, angle + Math.PI / 2);
      _dummy.scale.set(isMajor ? 1.5 : 0.9, isMajor ? 1.4 : 0.85, 1);
      _dummy.updateMatrix();
      ticksMesh.setMatrixAt(i, _dummy.matrix);
    }
    ticksMesh.instanceMatrix.needsUpdate = true;
    ticksMesh.computeBoundingSphere();
    daysRing.add(ticksMesh);

    applyFinishFnRef.current = (f: FinishId) => {
      const pal = FINISH_PALETTES[f];
      primaryMetalMat.color.setHex(pal.primary);
      secondaryHousingMat.color.setHex(pal.secondary);
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(_targetVec);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.6;
    controls.maxDistance = 11.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.update();

    const cancelPreset = () => {
      presetTriggerRef.current.active = false;
    };
    controls.addEventListener('start', cancelPreset);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let currentExploded = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      const remaining = getTimeRemaining(targetIsoRef.current, createdIsoRef.current, Date.now());
      accentMat.color.set(accentRef.current);
      accentMat.emissive.set(accentRef.current);

      // Damped exploded-view separation
      currentExploded = THREE.MathUtils.damp(currentExploded, explodedRef.current, 6, delta);
      daysRing.position.z = currentExploded * 0.65;
      hoursRing.position.z = -currentExploded * 0.45;
      minutesRing.position.z = currentExploded * 0.3;
      coreShell.position.y = 1.45 + currentExploded * 0.55;
      innerNucleus.position.y = 1.45 + currentExploded * 0.55;
      crownMesh.position.y = 3.06 + currentExploded * 0.4;

      const secAngle = ((remaining.seconds + (Date.now() % 1000) / 1000) / 60) * Math.PI * 2;
      const minAngle = (remaining.minutes / 60) * Math.PI * 2;
      const hrAngle = (remaining.hours / 24) * Math.PI * 2;

      daysRing.rotation.y = THREE.MathUtils.damp(daysRing.rotation.y, elapsed * 0.18, 3.5, delta);
      hoursRing.rotation.x = THREE.MathUtils.damp(
        hoursRing.rotation.x,
        hrAngle + Math.sin(elapsed * 0.45) * 0.25,
        4,
        delta
      );
      hoursRing.rotation.y = -elapsed * 0.28;
      minutesRing.rotation.z = remaining.isExpired ? elapsed * 1.4 : -secAngle;
      minutesRing.rotation.x = minAngle * 0.5;

      coreShell.rotation.y = elapsed * 0.4;
      coreShell.rotation.x = Math.sin(elapsed * 0.6) * 0.2;
      innerNucleus.rotation.y = -elapsed * 0.9;
      const pulseScale = remaining.isExpired
        ? 1.2 + Math.sin(elapsed * 5) * 0.18
        : 1 + Math.sin(elapsed * 2.2) * 0.05;
      innerNucleus.scale.setScalar(pulseScale);

      if (presetTriggerRef.current.active) {
        _camGoal.set(...presetTriggerRef.current.pos);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camGoal.x, 5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camGoal.y, 5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camGoal.z, 5, delta);
        if (camera.position.distanceTo(_camGoal) < 0.04) {
          presetTriggerRef.current.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 720;
      const h = container.clientHeight || 440;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', cancelPreset);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
      brushedRoughnessTex.dispose();
      dialTex.dispose();
      shadowTex.dispose();
      envTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      className={
        fullBleed
          ? 'fixed inset-0 z-50 w-screen h-screen bg-slate-950 overflow-hidden'
          : 'relative w-full h-[460px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950'
      }
    >
      <div ref={mountRef} className="w-full h-full" />

      {/* Minimal Top-Left Title Badge (Solid rgba surface, zero backdrop-filter) */}
      <div className="pointer-events-none absolute top-4 left-4 rounded-lg bg-slate-900/92 border border-slate-700/80 px-3.5 py-2">
        <div className="text-[11px] font-medium text-slate-400">Chronographe 3D</div>
        <div className="text-sm font-semibold text-slate-100 truncate max-w-[260px]">
          {title}
        </div>
      </div>

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 text-slate-200 text-sm">
          Contexte WebGL suspendu — restauration en cours...
        </div>
      )}

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion, solid rgba surface) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94%]">
        <button
          type="button"
          onClick={() => setDockOpen((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-slate-900/95 border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          {dockOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          {dockOpen ? 'Masquer les contrôles (H)' : 'Afficher les contrôles (H)'}
        </button>

        {dockOpen && (
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-slate-900/95 border border-slate-700 px-4 py-2.5 shadow-lg">
            {/* Material Finishes */}
            <div className="flex items-center gap-1.5">
              {(Object.keys(FINISH_PALETTES) as FinishId[]).map((key) => {
                const item = FINISH_PALETTES[key];
                const active = finish === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFinish(key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/20"
                      style={{ backgroundColor: item.swatch }}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="h-4 w-px bg-slate-700 hidden sm:block" />

            {/* Exploded View Slider */}
            <label className="flex items-center gap-2 text-xs text-slate-300 whitespace-nowrap">
              <span>Éclaté</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={exploded}
                onChange={(e) => setExploded(Number(e.target.value))}
                className="w-20 accent-amber-500 cursor-pointer"
              />
            </label>

            <div className="h-4 w-px bg-slate-700 hidden sm:block" />

            {/* Camera Presets & Fullscreen */}
            <div className="flex items-center gap-1">
              {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectPreset(key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    preset === key
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {CAMERA_PRESETS[key].label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => selectPreset('orbit')}
                title="Réinitialiser la caméra"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFullBleed((v) => !v)}
                title={fullBleed ? 'Quitter le plein écran' : 'Vue plein écran 3D'}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
              >
                {fullBleed ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
                {fullBleed ? 'Réduire' : 'Plein écran'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
