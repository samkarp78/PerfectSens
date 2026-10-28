import * as THREE from 'three';
import type { Aim, FovType } from '../core/types';
import { vfovDeg } from '../core/geometry';
import { aimToEuler, targetPosition, sphereRadiusFor } from './camera';

// Scene constants.
export const ROOM_HALF_SIZE = 30;
export const TARGET_DISTANCE = 20;
export const ROOM_COLOR = 0x161a22; // dark slate room (brighter than the first draft)
export const GRID_BG = '#1f2430';
export const GRID_LINE = '#353c4b'; // visible but quiet grid lines
export const GRID_CELLS = 6; // grid cells per texture tile
export const GRID_TEXTURE_SIZE = 512;
export const WALL_TILES = 5; // texture repeats across each wall
export const TARGET_COLOR = 0xff5a36; // the single accent colour
export const TARGET_ON_COLOR = 0xffb199; // brighter tint while the tracking target is on target
export const AMBIENT_INTENSITY = 1.4;
export const DIRECTIONAL_INTENSITY = 2.2;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;
export const MAX_PIXEL_RATIO = 2;
export const MAX_SWITCH_TARGETS = 3;
export const POP_MS = 220; // hit effect duration
export const POP_GROWTH = 2.4; // the ring grows to this multiple of the target size

export interface SceneApi {
  setAim(a: Aim): void;
  setFlickTarget(a: Aim | null): void;
  setTrackingTarget(a: Aim | null, onTarget: boolean): void;
  setSwitchTargets(aims: readonly Aim[]): void;
  /** A short expanding ring where a target was hit. */
  popAt(a: Aim): void;
  resize(w: number, h: number): void;
  render(): void;
  dispose(): void;
}

function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = GRID_TEXTURE_SIZE;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = GRID_BG;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 2;
    const step = c.width / GRID_CELLS;
    for (let i = 0; i <= GRID_CELLS; i++) {
      const p = Math.min(i * step, c.width - 1);
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, c.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(c.width, p); ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WALL_TILES, WALL_TILES);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createScene(
  canvas: HTMLCanvasElement,
  opts: { fov: number; fovType: FovType; targetRadiusDeg: number; trackingRadiusDeg?: number },
): SceneApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ROOM_COLOR);

  const aspect0 = canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 16 / 9;
  const camera = new THREE.PerspectiveCamera(vfovDeg(opts.fov, opts.fovType, aspect0), aspect0, CAMERA_NEAR, CAMERA_FAR);

  const gridTex = makeGridTexture();
  const roomGeo = new THREE.BoxGeometry(ROOM_HALF_SIZE * 2, ROOM_HALF_SIZE * 2, ROOM_HALF_SIZE * 2);
  const roomMat = new THREE.MeshStandardMaterial({ map: gridTex, side: THREE.BackSide, roughness: 1, metalness: 0 });
  scene.add(new THREE.Mesh(roomGeo, roomMat));

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const sun = new THREE.DirectionalLight(0xffffff, DIRECTIONAL_INTENSITY);
  sun.position.set(5, 20, 10);
  scene.add(sun);

  const targetGeo = new THREE.SphereGeometry(sphereRadiusFor(opts.targetRadiusDeg, TARGET_DISTANCE), 32, 24);
  const trackGeo = new THREE.SphereGeometry(sphereRadiusFor(opts.trackingRadiusDeg ?? opts.targetRadiusDeg, TARGET_DISTANCE), 32, 24);
  const flickMat = new THREE.MeshStandardMaterial({ color: TARGET_COLOR, roughness: 0.4 });
  const trackMat = new THREE.MeshStandardMaterial({ color: TARGET_COLOR, roughness: 0.4 });
  const flickMesh = new THREE.Mesh(targetGeo, flickMat);
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  flickMesh.visible = false;
  trackMesh.visible = false;
  scene.add(flickMesh, trackMesh);
  const switchMeshes = Array.from({ length: MAX_SWITCH_TARGETS }, () => {
    const m = new THREE.Mesh(targetGeo, flickMat);
    m.visible = false;
    scene.add(m);
    return m;
  });
  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  const pops: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; born: number }[] = [];
  const baseRadius = sphereRadiusFor(opts.targetRadiusDeg, TARGET_DISTANCE);

  const place = (mesh: THREE.Mesh, a: Aim | null) => {
    if (!a) { mesh.visible = false; return; }
    const p = targetPosition(a, TARGET_DISTANCE);
    mesh.position.set(p[0], p[1], p[2]);
    mesh.visible = true;
  };

  return {
    setAim(a) {
      const e = aimToEuler(a);
      camera.rotation.set(e.x, e.y, 0, e.order);
    },
    setFlickTarget(a) { place(flickMesh, a); },
    setSwitchTargets(aims) { switchMeshes.forEach((m, i) => place(m, aims[i] ?? null)); },
    popAt(a) {
      const mat = new THREE.MeshBasicMaterial({ color: TARGET_ON_COLOR, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      const p = targetPosition(a, TARGET_DISTANCE);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.lookAt(0, 0, 0);
      scene.add(mesh);
      pops.push({ mesh, mat, born: performance.now() });
    },
    setTrackingTarget(a, onTarget) {
      place(trackMesh, a);
      trackMat.color.setHex(onTarget ? TARGET_ON_COLOR : TARGET_COLOR);
    },
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = vfovDeg(opts.fov, opts.fovType, w / h);
      camera.updateProjectionMatrix();
    },
    render() {
      const now = performance.now();
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]!;
        const k = (now - p.born) / POP_MS;
        if (k >= 1) { scene.remove(p.mesh); p.mat.dispose(); pops.splice(i, 1); continue; }
        p.mesh.scale.setScalar(baseRadius * (1 + (POP_GROWTH - 1) * k));
        p.mat.opacity = 1 - k;
      }
      renderer.render(scene, camera);
    },
    dispose() {
      roomGeo.dispose(); roomMat.dispose(); gridTex.dispose();
      for (const p of pops) p.mat.dispose();
      ringGeo.dispose();
      targetGeo.dispose(); trackGeo.dispose(); flickMat.dispose(); trackMat.dispose();
      renderer.dispose();
    },
  };
}
