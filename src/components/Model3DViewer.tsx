import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import DxfParser from 'dxf-parser';
import { RotateCw, Download, AlertTriangle, Loader2 } from 'lucide-react';
import { Model3DFormat } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface Model3DViewerProps {
  fileUrl: string; // data: URL
  format: Model3DFormat;
  fileName?: string;
  heightClassName?: string;
}

/**
 * Перегляд 3D-моделей курсу прямо в браузері (three.js).
 *
 * STL/OBJ — рендеряться як повноцінна 3D-геометрія (STLLoader/OBJLoader).
 * DXF — це плоский 2D-формат САПР: розпізнаємо базовий набір сутностей
 * (LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC) через dxf-parser і малюємо їх
 * лініями в тій самій three.js-сцені (без заливки, без 3D-екструзії —
 * розширені сутності DXF, штрихування, блоки з вкладеними інстансами тощо
 * свідомо не підтримуються, це охоплює найтиповіші креслення).
 * F3D — пропрієтарний бінарний формат проєктів Autodesk Fusion 360 без
 * публічної специфікації: жодна JS-бібліотека не вміє його розпарсити,
 * тому для нього показуємо чітке пояснення й кнопку завантаження файлу.
 */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function dataUrlToText(dataUrl: string): string {
  return new TextDecoder('utf-8').decode(dataUrlToArrayBuffer(dataUrl));
}

export const Model3DViewer: React.FC<Model3DViewerProps> = ({
  fileUrl,
  format,
  fileName,
  heightClassName = 'h-80',
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (format === 'f3d') {
      setLoading(false);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    setLoading(true);
    setError(null);

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 320;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(1, 1, 1);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLight2.position.set(-1, -0.5, -1);
    scene.add(dirLight2);

    let disposed = false;
    let animationId = 0;

    const fitCameraToObject = (object: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fitDist = (maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360))) * 1.7;
      camera.position.set(center.x + fitDist * 0.7, center.y + fitDist * 0.5, center.z + fitDist * 0.7);
      camera.near = Math.max(maxDim / 1000, 0.001);
      camera.far = maxDim * 1000;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    };

    const buildDxfGroup = (text: string): THREE.Group => {
      const parser = new DxfParser();
      const dxf = parser.parseSync(text);
      const group = new THREE.Group();
      const material = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
      (dxf?.entities || []).forEach((entity: any) => {
        try {
          if ((entity.type === 'LINE' || entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices?.length >= 2) {
            const pts = entity.vertices.map((v: any) => new THREE.Vector3(v.x, v.y, v.z || 0));
            if (entity.shape) pts.push(pts[0].clone());
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
          } else if (entity.type === 'CIRCLE' && entity.center) {
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, 0, Math.PI * 2, false, 0);
            const pts = curve.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, entity.center.z || 0));
            group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material));
          } else if (entity.type === 'ARC' && entity.center) {
            const startRad = (entity.startAngle || 0) * (Math.PI / 180);
            const endRad = (entity.endAngle || 0) * (Math.PI / 180);
            const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, startRad, endRad, false, 0);
            const pts = curve.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, entity.center.z || 0));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material));
          }
        } catch {
          /* нерозпізнана сутність DXF — пропускаємо, решта креслення рендериться */
        }
      });
      if (group.children.length === 0) {
        throw new Error('empty-dxf');
      }
      return group;
    };

    (async () => {
      try {
        let object: THREE.Object3D;
        if (format === 'stl') {
          const buf = dataUrlToArrayBuffer(fileUrl);
          const geometry = new STLLoader().parse(buf);
          geometry.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.15, roughness: 0.55 });
          object = new THREE.Mesh(geometry, mat);
        } else if (format === 'obj') {
          const text = dataUrlToText(fileUrl);
          const obj = new OBJLoader().parse(text);
          obj.traverse((child) => {
            if (child instanceof THREE.Mesh && !child.material) {
              child.material = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
            }
          });
          object = obj;
        } else if (format === 'dxf') {
          const text = dataUrlToText(fileUrl);
          object = buildDxfGroup(text);
        } else {
          throw new Error('unsupported-format');
        }

        if (disposed) return;
        scene.add(object);
        fitCameraToObject(object);
        setLoading(false);
      } catch (err) {
        console.error('[Model3DViewer] Не вдалося розпарсити модель:', err);
        if (!disposed) {
          setError(t('model3DViewer.parseError'));
          setLoading(false);
        }
      }
    })();

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh | THREE.Line | THREE.LineLoop;
        if ((mesh as any).geometry) (mesh as any).geometry.dispose();
        const mat = (mesh as any).material;
        if (Array.isArray(mat)) mat.forEach((m: THREE.Material) => m.dispose());
        else if (mat) mat.dispose();
      });
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [fileUrl, format, t]);

  if (format === 'f3d') {
    return (
      <div className={`${heightClassName} rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center gap-2.5 text-center p-5`}>
        <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
        <p className="text-xs text-slate-300 max-w-xs leading-relaxed">{t('model3DViewer.f3dUnsupported')}</p>
        <a
          href={fileUrl}
          download={fileName || 'model.f3d'}
          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{t('model3DViewer.downloadBtn')}</span>
        </a>
      </div>
    );
  }

  return (
    <div className={`relative ${heightClassName} rounded-xl overflow-hidden bg-slate-950 border border-slate-800`}>
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-950/90 p-4 text-center">
          <AlertTriangle className="w-6 h-6 text-rose-400" />
          <p className="text-xs text-rose-200 max-w-xs">{error}</p>
          <a
            href={fileUrl}
            download={fileName || 'model'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('model3DViewer.downloadBtn')}</span>
          </a>
        </div>
      )}
      {!loading && !error && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/50 text-[10px] text-slate-300 pointer-events-none">
          <RotateCw className="w-3 h-3" />
          <span>{t('model3DViewer.dragHint')}</span>
        </div>
      )}
    </div>
  );
};
