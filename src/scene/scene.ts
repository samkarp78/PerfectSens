import * as THREE from 'three';
import type { Aim, FovType } from '../core/types';
import { vfovDeg } from '../core/geometry';
import { aimToEuler, targetPosition, sphereRadiusFor } from './camera';

// Scene constants.
export const ROOM_HALF_SIZE = 30;
export const TARGET_DISTANCE = 20;
export const ROOM_COLOR = 0x07080b; // near-black room
export const GRID_BG = '#0b0d12';
export const GRID_LINE = '#1c212b'; // subtle grid lines
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

export interface SceneApi {
  setAim(a: Aim): void;
  setFlickTarget(a: Aim | null): void;
  setTrackingTarget(a: Aim | null, onTarget: boolean): void;
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
    render() { renderer.render(scene, camera); },
    dispose() {
      roomGeo.dispose(); roomMat.dispose(); gridTex.dispose();
      targetGeo.dispose(); trackGeo.dispose(); flickMat.dispose(); trackMat.dispose();
      renderer.dispose();
    },
  };
}
