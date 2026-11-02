/* The 3D view of the table: the top as the buyer composed it (slabs, resin,
 * texture), the wooden legs they chose, and the mounting plates with their
 * holes. Drag to turn it, wheel to come closer. Plain Three.js (vendor/), no
 * build step: the builder is a static page.
 *
 * It draws what table-legs.js describes, part by part, so the picture is the
 * same base as the two drawings and the price.
 */
import * as THREE from "./vendor/three.module.min.js";

const WOOD = "#b88a56";

// A part is a loft between two rings (the vertices table-legs.js produces:
// n points at the bottom, then n at the top). Plan (x, y) -> three (x, z, y).
function loft(vertices, n) {
  const pos = [];
  const v = (i) => vertices[i];
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) pos.push(p[0], p[2], p[1]);
  };
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const b0 = v(k), b1 = v(k2), t0 = v(n + k), t1 = v(n + k2);
    tri(b0, b1, t1);
    tri(b0, t1, t0);
  }
  for (let k = 1; k < n - 1; k++) {
    tri(v(0), v(k + 1), v(k)); // bottom
    tri(v(n), v(n + k), v(n + k + 1)); // top
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function topShape(top) {
  const shape = new THREE.Shape();
  if (top.shape === "square") {
    shape.moveTo(-top.l / 2, -top.w / 2);
    shape.lineTo(top.l / 2, -top.w / 2);
    shape.lineTo(top.l / 2, top.w / 2);
    shape.lineTo(-top.l / 2, top.w / 2);
    shape.closePath();
  } else {
    shape.absellipse(0, 0, top.l / 2, top.w / 2, 0, Math.PI * 2, false, 0);
  }
  return shape;
}

function loadTexture(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function create(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null; // no WebGL: the page keeps the two drawings
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-200, 500, 300);
  scene.add(sun);
  const group = new THREE.Group();
  scene.add(group);

  let azimuth = -0.7, elevation = 0.42, distance = 300, target = new THREE.Vector3(0, 40, 0);
  let frame = 0, dead = false;
  const draw = () => {
    frame = 0;
    if (dead) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    camera.position.set(
      target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      target.y + distance * Math.sin(elevation),
      target.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(target);
    renderer.render(scene, camera);
  };
  const redraw = () => {
    if (!frame && !dead) frame = requestAnimationFrame(draw);
  };

  // Drag to turn, wheel / pinch to come closer.
  const pointers = new Map();
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  });
  canvas.addEventListener("pointermove", (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    if (pointers.size === 1) {
      azimuth -= (e.clientX - last[0]) * 0.008;
      elevation = Math.max(0.05, Math.min(1.45, elevation + (e.clientY - last[1]) * 0.006));
    } else {
      const others = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(last[0] - others[0], last[1] - others[1]);
      const after = Math.hypot(e.clientX - others[0], e.clientY - others[1]);
      distance = Math.max(80, Math.min(1500, distance * (before / Math.max(1, after))));
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    redraw();
  });
  const release = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      distance = Math.max(80, Math.min(1500, distance * (1 + Math.sign(e.deltaY) * 0.1)));
      redraw();
    },
    { passive: false },
  );
  const observer = new ResizeObserver(redraw);
  observer.observe(canvas);

  function clear() {
    while (group.children.length) {
      const child = group.children.pop();
      child.traverse?.((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) {
          m.map?.dispose();
          m.dispose();
        }
      });
    }
  }

  /**
   * model = { top: {shape,l,w,t,color,texture}, height, legs?: {parts, plates,
   *   plateT, legLength, color, svgImage} }
   */
  async function update(model) {
    const generation = (update.generation = (update.generation || 0) + 1);
    const texture = await loadTexture(model.top.texture);
    const svgTexture = model.legs?.svgImage ? await loadTexture(model.legs.svgImage) : null;
    if (generation !== update.generation || dead) return;
    clear();
    const { top, height } = model;

    // The top. Caps carry the picture of the composition, the sides a plain wood.
    const rt = Number(top.edgeTop) || 0,
      rb = Number(top.edgeBottom) || 0;
    let geometry;
    if ((rt > 0 || rb > 0) && window.TableEdges) {
      // The edges are worked (rounded or cut at 45 degrees): the mesh comes from table-edges.js. The faces and the
      // worked edges carry the picture, the plain side stays wood.
      const g = window.TableEdges.geometry(top, rt, rb, top.edgeTopStyle, top.edgeBottomStyle);
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(g.normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(g.uvs, 2));
      geometry.setIndex([...g.cap, ...g.wall]);
      geometry.addGroup(0, g.cap.length, 0);
      geometry.addGroup(g.cap.length, g.wall.length, 1);
      geometry.translate(0, height - top.t, 0);
    } else {
      geometry = new THREE.ExtrudeGeometry(topShape(top), { depth: top.t, bevelEnabled: false, curveSegments: 64 });
      const uv = geometry.attributes.uv, position = geometry.attributes.position;
      for (let i = 0; i < uv.count; i++)
        uv.setXY(i, position.getX(i) / top.l + 0.5, 1 - (position.getY(i) / top.w + 0.5));
      geometry.rotateX(Math.PI / 2); // shape y -> world z, the near cap faces up
      geometry.translate(0, height, 0);
    }
    const cap = new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : new THREE.Color(top.color || "#24474b"),
      map: texture,
      transparent: !!top.transparent,
      roughness: 0.28,
      metalness: 0.05,
    });
    const sides = new THREE.MeshStandardMaterial({ color: "#6b5238", roughness: 0.7 });
    group.add(new THREE.Mesh(geometry, [cap, sides]));

    if (model.legs) {
      const { parts, plates, plateT, legLength, color } = model.legs;
      const wood = new THREE.MeshStandardMaterial({ color: color || WOOD, roughness: 0.62, side: THREE.DoubleSide });
      for (const part of parts) {
        const n = part.type === "round" ? 24 : 4;
        if (part.svg && svgTexture) {
          // A leg cut from a drawing: stacked thin cut-outs give it a body.
          const w = part.svg === "front" ? part.bs[0] : part.bs[1];
          const depth = part.svg === "front" ? part.bs[1] : part.bs[0];
          const h = Math.abs(part.top[2] - part.bottom[2]);
          const slices = 10;
          const mat = new THREE.MeshStandardMaterial({
            map: svgTexture, alphaTest: 0.5, roughness: 0.62, color: color || WOOD, side: THREE.DoubleSide,
          });
          for (let s = 0; s < slices; s++) {
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
            if (part.svg === "side") plane.rotation.y = Math.PI / 2;
            const off = (s / (slices - 1) - 0.5) * depth;
            plane.position.set(
              part.bottom[0] + (part.svg === "side" ? off : 0),
              Math.min(part.bottom[2], part.top[2]) + h / 2,
              part.bottom[1] + (part.svg === "front" ? off : 0),
            );
            group.add(plane);
          }
          continue;
        }
        // eslint-disable-next-line no-undef
        const vertices = TableLegsVertices(part);
        group.add(new THREE.Mesh(loft(vertices, n), wood));
      }
      // Plates under the top, each with its four holes.
      const plateMat = new THREE.MeshStandardMaterial({ color: "#d6b98a", roughness: 0.7 });
      for (const plate of plates) {
        const shape = new THREE.Shape();
        shape.moveTo(-plate.w / 2, -plate.d / 2);
        shape.lineTo(plate.w / 2, -plate.d / 2);
        shape.lineTo(plate.w / 2, plate.d / 2);
        shape.lineTo(-plate.w / 2, plate.d / 2);
        shape.closePath();
        for (const hole of plate.holes) {
          const path = new THREE.Path();
          path.absarc(hole.x - plate.x, hole.y - plate.y, hole.diameterMm / 20, 0, Math.PI * 2, true);
          shape.holes.push(path);
        }
        const g = new THREE.ExtrudeGeometry(shape, { depth: plateT, bevelEnabled: false, curveSegments: 12 });
        g.rotateX(Math.PI / 2);
        g.translate(plate.x, legLength + plateT, plate.y);
        group.add(new THREE.Mesh(g, plateMat));
      }
    }
    const radius = Math.max(top.l, top.w, height) * 0.5;
    target.set(0, height * 0.45, 0);
    distance = Math.max(distance, radius * 3.2);
    if (!update.framed) {
      distance = radius * 3.4;
      update.framed = true;
    }
    redraw();
  }

  return {
    update,
    dispose() {
      dead = true;
      observer.disconnect();
      clear();
      renderer.dispose();
    },
  };
}

// Vertices of a part, from table-legs.js (a classic script on the same page).
function TableLegsVertices(part) {
  return window.TableLegs.vertices(part);
}

window.Table3D = { create };
window.dispatchEvent(new Event("table3d-ready"));
