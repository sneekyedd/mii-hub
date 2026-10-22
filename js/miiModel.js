/*
 * miiModel.js
 * Loads a full-body Mii .glb (as exported by Mii Creator), makes copies of it,
 * recolors it, and moves its bones so it can walk, wave, dance and so on.
 *
 * The .glb has a skeleton (bones) but no built-in animations, so all the
 * movement is done here in code by rotating bones a little every frame.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------
  // Reading the Mii's info (name, favorite color...) from the .glb file.
  // This part doesn't need Three.js, so it also runs in Node for tests.
  // ---------------------------------------------------------------------
  const FAVORITE_COLORS = [
    { name: "red", hex: "#d21e14" },
    { name: "orange", hex: "#ff6e19" },
    { name: "yellow", hex: "#ffd820" },
    { name: "light green", hex: "#78d220" },
    { name: "green", hex: "#007830" },
    { name: "blue", hex: "#0a48b4" },
    { name: "light blue", hex: "#3caade" },
    { name: "pink", hex: "#f55a7d" },
    { name: "purple", hex: "#7328ad" },
    { name: "brown", hex: "#483818" },
    { name: "white", hex: "#e0e0e0" },
    { name: "black", hex: "#181814" },
  ];

  // A .glb file is: a 12-byte header, then a JSON chunk, then a binary chunk.
  function readGlbJson(bytes) {
    if (bytes.length < 20) throw new Error("file is too small");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== "glTF") throw new Error("not a .glb file");
    const jsonLength = view.getUint32(12, true);
    const jsonType = view.getUint32(16, true);
    if (jsonType !== 0x4e4f534a) throw new Error("the .glb is missing its JSON part");
    const jsonBytes = bytes.subarray(20, 20 + jsonLength);
    return JSON.parse(new TextDecoder().decode(jsonBytes));
  }

  function readInfo(bytes, fileName) {
    const json = readGlbJson(bytes);
    const extras = (json.asset && json.asset.extras) || {};
    const add = extras.additionalInfo || {};
    const hasSkeleton = Array.isArray(json.skins) && json.skins.length > 0;
    let name = typeof add.name === "string" && add.name.trim() ? add.name.trim() : null;
    if (!name && fileName) name = fileName.replace(/\.glb$/i, "").replace(/[_-].*$/, "") || "Mii";
    const fav = Number.isInteger(add.favoriteColor) && add.favoriteColor >= 0 && add.favoriteColor < 12 ? add.favoriteColor : 0;
    return {
      name: name || "Mii",
      creator: add.creator || "",
      gender: add.gender === 1 ? 1 : 0,
      favoriteColor: fav,
      favoriteColorName: FAVORITE_COLORS[fav].name,
      height: typeof add.height === "number" ? add.height : 64,
      build: typeof add.build === "number" ? add.build : 64,
      hasSkeleton,
      generator: (json.asset && json.asset.generator) || "",
      fromMiiCreator: !!extras.miiData,
    };
  }

  // Names for colors, so Miis can say "I love your navy top!" and be right.
  const TOP_NAMES = FAVORITE_COLORS.concat([
    { name: "navy", hex: "#191f40" }, { name: "gray", hex: "#40464e" }, { name: "gray", hex: "#8a8f98" },
    { name: "black", hex: "#2a2a2a" }, { name: "white", hex: "#f4f4f4" }, { name: "cream", hex: "#f3e2b8" },
    { name: "maroon", hex: "#6b1a24" }, { name: "teal", hex: "#1f8a8a" },
  ]);
  const HAIR_NAMES = [
    { name: "black", hex: "#1e1a18" }, { name: "dark brown", hex: "#402010" }, { name: "brown", hex: "#6b4423" },
    { name: "red", hex: "#8a2a14" }, { name: "ginger", hex: "#b5652a" }, { name: "gray", hex: "#787878" },
    { name: "blonde", hex: "#d0a04a" }, { name: "white", hex: "#e8e8e8" }, { name: "pink", hex: "#f08ab0" },
    { name: "blue", hex: "#3a6ad0" }, { name: "green", hex: "#3a9a4a" }, { name: "purple", hex: "#8a4ac0" },
  ];

  // color: "#rrggbb" or [r, g, b]; kind: "top" or "hair"
  function colorName(color, kind) {
    if (!color) return null;
    const rgb = typeof color === "string" ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : color;
    let best = null, bestD = Infinity;
    for (const c of kind === "hair" ? HAIR_NAMES : TOP_NAMES) {
      const h = [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16));
      // compare in a way that's closer to how people see color (green matters most)
      const d = 2 * (h[0] - rgb[0]) ** 2 + 4 * (h[1] - rgb[1]) ** 2 + 3 * (h[2] - rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = c.name; }
    }
    return best;
  }

  const api = { readGlbJson, readInfo, FAVORITE_COLORS, colorName };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  // ---------------------------------------------------------------------
  // Everything below needs Three.js (browser only).
  // ---------------------------------------------------------------------
  const THREE = root.THREE;
  // Treat colors like "#ff0000" as normal screen colors (so they don't look washed out).
  THREE.ColorManagement.legacyMode = false;

  // Colors used in Mii Creator's textures, so we can swap them for others.
  const SOURCE = {
    skin: [0xff, 0xd3, 0xad],
    hair: [0x40, 0x20, 0x10],
    shirt: [0x19, 0x1f, 0x40],
    pants: [0x40, 0x46, 0x4e],
    eyes: [0x0a, 0x4a, 0x35],
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }

  function srgbColor(hex) {
    return new THREE.Color(hex); // converted to the renderer's color space automatically
  }

  // Loads a .glb from its bytes. Returns a "template" we can make copies of.
  function loadTemplate(arrayBuffer, fileName) {
    const bytes = new Uint8Array(arrayBuffer);
    const info = readInfo(bytes, fileName);
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().parse(arrayBuffer, "", (gltf) => {
        const scene = gltf.scene;
        // Measure the model so every Mii stands on the ground at the same size.
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const height = box.max.y - box.min.y;
        if (!isFinite(height) || height <= 0) { reject(new Error("the model is empty")); return; }
        resolve({ scene, info, height, groundY: box.min.y, source: detectSourceColors(scene), animations: gltf.animations || [] });
      }, (err) => reject(new Error("couldn't read the 3D model (" + (err && err.message || err) + ")")));
    });
  }

  // Every Mii has different colors, so find this model's own skin, hair and
  // clothes colors first. Those are the colors we replace when recoloring.
  function dominantColor(tex) {
    if (!tex || !tex.image) return null;
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const ctx = c.getContext("2d");
    ctx.drawImage(tex.image, 0, 0, 48, 48);
    const px = ctx.getImageData(0, 0, 48, 48).data;
    const counts = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const key = (px[i] >> 3) + "," + (px[i + 1] >> 3) + "," + (px[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let best = null, bestN = 0, total = 0;
    for (const [k, n] of counts) { total += n; if (n > bestN) { best = k; bestN = n; } }
    if (!best) return null;
    // look up the exact color of one pixel in the winning bucket
    for (let i = 0; i < px.length; i += 4) {
      if ((px[i] >> 3) + "," + (px[i + 1] >> 3) + "," + (px[i + 2] >> 3) === best) {
        const rgb = [px[i], px[i + 1], px[i + 2]];
        rgb.share = bestN / total; // how much of the picture is this color
        return rgb;
      }
    }
    return null;
  }

  function colorToRgb255(color) {
    const c = color.clone().convertLinearToSRGB();
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
  }

  function near(a, b, tol) {
    return a && b && (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < tol;
  }

  // Kinds of clothes, from the names Mii Creator gives the clothes parts
  // (like "clothes_m_Hoodie"), so Miis can say "nice hoodie!" and be right.
  const GARMENTS = [
    [/dress/i, "dress"], [/hoodie|parka/i, "hoodie"], [/sweater|jumper|knit/i, "sweater"], [/jacket|blazer/i, "jacket"],
    [/coat/i, "coat"], [/overall/i, "overalls"], [/kimono/i, "kimono"], [/suit/i, "suit"], [/vest|tank/i, "vest"],
    [/polo/i, "polo shirt"], [/tee|tshirt|t_shirt/i, "T-shirt"], [/shirt|top/i, "shirt"],
  ];

  function detectSourceColors(scene) {
    const src = Object.assign({}, SOURCE);
    const shirtVotes = [];
    const clothes = [];
    scene.traverse((o) => {
      if (/^clothes/i.test(o.name)) clothes.push(o.name);
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      const mname = (m.name || "").toLowerCase();
      if (mname === "nose") src.skin = colorToRgb255(m.color);
      if (mname === "hair") { src.hair = colorToRgb255(m.color); src.hasHair = true; }
      if (/^clothes/i.test(o.name) && m.map) {
        const dom = dominantColor(m.map);
        if (/pants|bottom|skirt|shorts|trouser/i.test(o.name)) src.pants = dom || src.pants;
        else if (dom) shirtVotes.push(dom);
      }
    });
    const tops = shirtVotes.filter((c) => !near(c, src.skin, 2400));
    if (tops.length) {
      src.shirt = tops[0];
      // only talk about the top's color if it's clearly one main color
      src.topReliable = tops[0].share >= 0.3;
    }
    // what kind of top it is (ignoring trousers and sleeve parts)
    const topNames = clothes.filter((n) => !/pants|bottom|skirt|shorts|trouser|shoe|sock|arms/i.test(n)).join(" ");
    for (const [re, word] of GARMENTS) if (re.test(topNames)) { src.garment = word; break; }
    return src;
  }

  // ---- recoloring textures ----
  function recolorTexture(tex, swaps) {
    if (!tex || !tex.image || !swaps.length) return tex;
    const img = tex.image;
    const w = img.width, h = img.height;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    let changed = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      for (const s of swaps) {
        if (s.skip) continue;
        const dr = px[i] - s.from[0], dg = px[i + 1] - s.from[1], db = px[i + 2] - s.from[2];
        if (dr * dr + dg * dg + db * db < s.tol) {
          // keep any shading by scaling the new color the same way
          const k = (px[i] + px[i + 1] + px[i + 2] + 1) / (s.from[0] + s.from[1] + s.from[2] + 1);
          px[i] = Math.min(255, s.to[0] * k);
          px[i + 1] = Math.min(255, s.to[1] * k);
          px[i + 2] = Math.min(255, s.to[2] * k);
          changed = true;
          break;
        }
      }
    }
    if (!changed) return tex;
    ctx.putImageData(data, 0, 0);
    // Note: texture.clone() shares the picture with the original, so give the
    // copy its own picture (otherwise every Mii would change color together).
    const out = tex.clone();
    out.source = new THREE.Source(canvas);
    out.needsUpdate = true;
    return out;
  }

  // Applies a look ({ skin, hair, shirt, pants, eyes, beard }) to a Mii copy.
  // Materials are always copied, so each Mii can be changed without affecting the others.
  function applyLook(object, look, source) {
    look = look || {};
    const src = source || SOURCE;
    const tol = 2400;
    // Each swap: replace color `from` with `to`. `faceOnly` swaps only touch the
    // face texture (so removing a beard doesn't also remove the eyebrows).
    const swaps = [];
    if (look.skin) swaps.push({ from: src.skin, to: hexToRgb(look.skin), tol });
    if (look.beard === false) swaps.push({ from: src.hair, to: hexToRgb(look.skin || rgbToHex(src.skin)), tol, faceOnly: true });
    if (look.hair) swaps.push({ from: src.hair, to: hexToRgb(look.hair), tol });
    if (look.shirt) {
      const dark = src.shirt.map((v) => v * 0.5);
      swaps.push({ from: src.shirt, to: hexToRgb(look.shirt), tol });
      swaps.push({ from: dark, to: hexToRgb(look.shirt).map((v) => v * 0.55), tol: 600 });
    }
    if (look.pants) swaps.push({ from: src.pants, to: hexToRgb(look.pants), tol });
    if (look.eyes) swaps.push({ from: src.eyes, to: hexToRgb(look.eyes), tol: 3000 });

    const cache = new Map();
    object.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const newMats = mats.map((m) => {
        if (cache.has(m)) return cache.get(m);
        const c = m.clone();
        const name = (m.name || "").toLowerCase();
        const isFace = name === "faceline";
        // a beard-removal swap must come first on the face, and be skipped elsewhere
        const list = swaps.map((s) => Object.assign({}, s, { skip: s.faceOnly && !isFace }))
          .sort((a, b) => (b.faceOnly ? 1 : 0) - (a.faceOnly ? 1 : 0));
        if (c.map) c.map = recolorTexture(c.map, list);
        if (name === "hair" && look.hair) c.color = srgbColor(look.hair);
        if (name === "nose" && look.skin) c.color = srgbColor(look.skin);
        cache.set(m, c);
        return c;
      });
      o.material = Array.isArray(o.material) ? newMats : newMats[0];
    });
  }

  // ---- making a copy that can move on its own ----
  // ---- finding the bones ----
  // Mii Creator names its bones "Arm_1_L", "Leg_2_R" and so on, but other tools
  // use other names (Mixamo: "mixamorig:LeftArm", Blender: "upper_arm.L", VRM:
  // "leftUpperArm"...). We look for each bone under any of those names.
  const L = "(?:[_.\\-]?l(?:eft)?|left)", R = "(?:[_.\\-]?r(?:ight)?|right)";
  const BONE_PATTERNS = {
    Spine_1: [/^spine_?1$/, /^spine$/, /^hips?$/, /^pelvis$/],
    Spine_2: [/^spine_?2$/, /^chest$/, /^spine_?0?1$/, /^upper_?chest$/],
    Head: [/^head$/],
    Arm_1_L: [/^arm_?1_?l$/, new RegExp("^(?:upper_?arm" + L + "|leftarm|left_?upper_?arm|arm" + L + ")$")],
    Arm_2_L: [/^arm_?2_?l$/, new RegExp("^(?:fore_?arm" + L + "|lower_?arm" + L + "|leftforearm|left_?lower_?arm|elbow" + L + ")$")],
    Arm_1_R: [/^arm_?1_?r$/, new RegExp("^(?:upper_?arm" + R + "|rightarm|right_?upper_?arm|arm" + R + ")$")],
    Arm_2_R: [/^arm_?2_?r$/, new RegExp("^(?:fore_?arm" + R + "|lower_?arm" + R + "|rightforearm|right_?lower_?arm|elbow" + R + ")$")],
    Leg_1_L: [/^leg_?1_?l$/, new RegExp("^(?:thigh" + L + "|upper_?leg" + L + "|leftupleg|left_?upper_?leg|leg" + L + ")$")],
    Leg_2_L: [/^leg_?2_?l$/, new RegExp("^(?:shin" + L + "|calf" + L + "|lower_?leg" + L + "|leftleg|left_?lower_?leg|knee" + L + ")$")],
    Leg_1_R: [/^leg_?1_?r$/, new RegExp("^(?:thigh" + R + "|upper_?leg" + R + "|rightupleg|right_?upper_?leg|leg" + R + ")$")],
    Leg_2_R: [/^leg_?2_?r$/, new RegExp("^(?:shin" + R + "|calf" + R + "|lower_?leg" + R + "|rightleg|right_?lower_?leg|knee" + R + ")$")],
  };

  function cleanBoneName(name) {
    return (name || "").toLowerCase()
      .replace(/^mixamorig[:_]?|^armature[_|:]|^bip0?1[_ ]?|^j_bip_[clr]_/, "");
  }

  function findBones(object) {
    const all = [];
    object.traverse((o) => { if (o.isBone || o.type === "Bone") all.push(o); });
    // models without a skin may still have plain nodes named like bones
    if (!all.length) object.traverse((o) => { if (!o.isMesh && o !== object) all.push(o); });
    const found = {};
    // The loader adds "_1", "_2"... to repeated names, so if the exact name isn't
    // there, try again without that ending.
    const names = all.map((b) => cleanBoneName(b.name));
    const trimmed = names.map((n) => n.replace(/_\d+$/, ""));
    for (const [key, patterns] of Object.entries(BONE_PATTERNS)) {
      for (const list of [names, trimmed]) {
        const re = patterns.find((p) => list.some((n) => p.test(n)));
        if (re) { found[key] = all[list.findIndex((n) => re.test(n))]; break; }
      }
    }
    return found;
  }

  function createInstance(template, look) {
    const object = THREE.SkeletonUtils.clone(template.scene);
    applyLook(object, look, template.source);
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // skinned meshes can be culled wrongly when animated
      }
    });

    // Put the feet on the ground and make the Mii about 1.8 units tall.
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    const s = 1.8 / template.height;
    inner.scale.setScalar(s);
    inner.position.y = -template.groundY * s;
    inner.add(object);
    holder.add(inner);

    // Remember each bone's resting rotation, plus which way its parent faces,
    // so we can rotate bones using simple directions (forward, sideways, up).
    holder.updateMatrixWorld(true); // update everything, including the size/position wrapper
    const rootQInv = new THREE.Quaternion();
    object.getWorldQuaternion(rootQInv).invert();
    const rootInv = object.matrixWorld.clone().invert();
    const found = findBones(object);
    const bones = {};
    for (const [key, o] of Object.entries(found)) {
      const parentQ = new THREE.Quaternion();
      if (o.parent) o.parent.getWorldQuaternion(parentQ);
      parentQ.premultiply(rootQInv);
      bones[key] = { bone: o, rest: o.quaternion.clone(), parentQ, parentQInv: parentQ.clone().invert(), base: new THREE.Quaternion() };
    }

    // If the model stands in a "T-pose" (arms straight out), turn the arms (and
    // legs, if needed) so they hang down first. Mii Creator models are already fine.
    const posOf = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(rootInv);
    for (const [upper, lower, isArm] of [["Arm_1_L", "Arm_2_L", 1], ["Arm_1_R", "Arm_2_R", 1], ["Leg_1_L", "Leg_2_L", 0], ["Leg_1_R", "Leg_2_R", 0]]) {
      const b = bones[upper];
      if (!b) continue;
      const child = found[lower] || b.bone.children.find((c) => c.isBone);
      if (!child) continue;
      const a = posOf(b.bone), c = posOf(child);
      const dir = c.sub(a).normalize();
      if (dir.lengthSq() < 0.5 || dir.y < (isArm ? -0.75 : -0.85)) continue; // already hanging down
      const side = Math.sign(a.x) || 1;
      const target = new THREE.Vector3(isArm ? side * 0.15 : 0, -1, 0).normalize();
      b.base.setFromUnitVectors(dir, target);
    }

    // Animations that came with the file (e.g. from Mixamo) are used if there are any.
    let mixer = null, actions = null;
    if (template.animations.length) {
      mixer = new THREE.AnimationMixer(object);
      const clip = (re) => template.animations.find((c) => re.test(c.name));
      const idle = clip(/idle|stand|breath/i) || template.animations[0];
      const walk = clip(/walk|run|move/i);
      actions = { idle: mixer.clipAction(idle), walk: walk && walk !== idle ? mixer.clipAction(walk) : null };
      actions.idle.play();
      if (actions.walk) { actions.walk.play(); actions.walk.setEffectiveWeight(0); }
    }

    const rig = new Rig(bones, mixer, actions);
    // How long the legs are (hip to ankle), so steps match the walking speed
    // and the feet stay on the ground instead of sliding.
    const hipBone = found.Leg_1_L || found.Leg_1_R;
    const kneeBone = found.Leg_2_L || found.Leg_2_R;
    if (hipBone && kneeBone) {
      const ankle = kneeBone.children.find((c) => c.isBone || /ankle|foot/i.test(c.name));
      const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const hipY = wp(hipBone).y;
      const footY = ankle ? wp(ankle).y : Math.max(0, hipY - 2 * (hipY - wp(kneeBone).y));
      if (hipY - footY > 0.1) rig.legLen = hipY - footY + 0.05;
    }
    // outfit extras (hats, glasses...: see lifeModels.js)
    if (look && look.extras && root.MiiLifeModels) root.MiiLifeModels.dress({ holder, bones: found }, look.extras);
    return { holder, inner, object, rig };
  }

  // ---- posing ----
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();

  // How a Mii moves depends on its personality (see animStyle in hub3d.js).
  // These are the "average Mii" values.
  const DEFAULT_STYLE = {
    stride: 0.55,     // how far the legs swing
    armSwing: 0.9,    // how much the arms swing when walking
    armsOut: 0.06,    // arms held away from the body
    bounce: 0.03,     // springy steps
    lean: 0.03,       // leaning forward when walking
    headDown: 0,      // shy Miis look down a bit
    wobble: 0,        // goofy side-to-side waddle
    stomp: 0.3,       // heavy, stompy steps
    gesture: 0.5,     // hand movements while talking
    waveSize: 1,      // big or small waves
    tempo: 1,         // how fast they dance and fidget
    dance: "sway",    // "sway" (calm), "jumpy" (energetic) or "silly"
    idle: "relaxed",  // what they do when standing around (see below)
    fidget: 0.4,      // swinging legs when sitting, etc.
  };

  class Rig {
    constructor(bones, mixer, actions) {
      this.bones = bones;
      this.mixer = mixer;
      this.actions = actions;
      // can we move legs? (if not, the hub makes the whole Mii bounce instead)
      this.hasLegs = !!(bones.Leg_1_L && bones.Leg_1_R);
      this.canAnimate = this.hasLegs || !!mixer;
      this.missing = Object.keys(BONE_PATTERNS).filter((k) => !bones[k]);
      this.legLen = 0.75; // measured in createInstance when possible
      this.drop = 0;      // how far the body should move down (legs apart = hips lower)
    }

    // Rotates a bone by (x, y, z) radians measured in the Mii's own space:
    // x = tip forward/back, y = turn left/right, z = tilt sideways.
    set(name, x, y, z) {
      const b = this.bones[name];
      if (!b) return;
      tmpE.set(x || 0, y || 0, z || 0, "XYZ");
      tmpQ.setFromEuler(tmpE);
      // local = parent⁻¹ · R · base · parent · rest   (base straightens T-poses)
      b.bone.quaternion.copy(b.parentQInv).multiply(tmpQ).multiply(b.base).multiply(b.parentQ).multiply(b.rest);
    }

    // How far one step carries the Mii (used to time the walk cycle to the speed).
    stepLength(style) {
      const st = style || DEFAULT_STYLE;
      return Math.max(0.2, 2 * this.legLen * Math.sin(st.stride) * 0.95);
    }

    /*
     * p = {
     *   t, dt, walk (0..1 how much walking), phase (walk cycle), run (on a treadmill),
     *   arms: "down" | "wave" | "up" | "cheer" | "out" | "type" | "held" | "phone" |
     *         "shout" | "eat" | "drum" | "punch",
     *   style (see DEFAULT_STYLE), talking, lookYaw, lookUp, nod, laugh, dance, sit, lie
     * }
     * Afterwards, this.drop says how much lower the body should be (so feet stay planted).
     */
    pose(p) {
      const t = p.t || 0;
      const st = p.style || DEFAULT_STYLE;
      this.drop = 0;
      if (this.mixer) {
        // the file's own animations: blend between standing and walking
        const w = p.walk || 0;
        this.actions.idle.setEffectiveWeight(this.actions.walk ? 1 - w : 1);
        if (this.actions.walk) this.actions.walk.setEffectiveWeight(w);
        this.mixer.update(p.dt || 0);
        // still do special arm poses (waving etc.) on top
        if (!p.arms || p.arms === "down") return;
      }
      const w = p.walk || 0;
      const still = 1 - w;
      const ph = p.phase || 0;
      const s = Math.sin(ph), c = Math.cos(ph);
      const run = p.run ? 1 : 0;
      const amp = st.stride * (1 + run * 0.35);
      const tempo = st.tempo || 1;

      // ---- legs: forward swing is a negative X rotation ----
      let legL = -s * amp * w, legR = s * amp * w;
      // the knee bends while that leg swings forward (lifting the foot);
      // stompy walkers lift their feet higher
      const lift = (0.6 + st.stomp * 0.6 + run * 0.6) * w;
      let kneeL = Math.max(0, Math.cos(ph + 0.35)) * lift;
      let kneeR = Math.max(0, -Math.cos(ph + 0.35)) * lift;
      // legs apart = hips a little lower, so the feet stay on the ground
      this.drop = this.legLen * (1 - Math.cos(amp * Math.abs(s) * w)) * 0.75;
      // springy walkers bounce up between steps
      this.drop -= st.bounce * w * c * c;

      if (p.held) {
        legL = Math.sin(t * 9) * 0.35; legR = -legL;
        kneeL = kneeR = 0.2;
        this.drop = 0;
      }
      if (p.sit) {
        legL = legR = -1.45;
        kneeL = kneeR = 1.45;
        // on a deep sofa, short Mii legs stick straight out instead of hanging down
        if (p.legsOut) { legL = legR = -1.5; kneeL = kneeR = 0.15; }
        // fidgety Miis swing their legs while sitting
        const f = st.fidget * 0.35;
        kneeL += (p.legsOut ? 0.3 : 1) * Math.sin(t * 3.2 * tempo) * f;
        kneeR += (p.legsOut ? 0.3 : 1) * Math.sin(t * 3.2 * tempo + 2.2) * f;
        this.drop = 0;
      }
      if (p.lie) { legL = legR = 0; kneeL = kneeR = 0.05; this.drop = 0; }
      // crouching (Paintball): thighs forward, knees bent, hips lower
      const crouch = p.crouch || 0;
      if (crouch > 0) {
        legL -= 1.1 * crouch; legR -= 1.1 * crouch;
        kneeL += 2.0 * crouch; kneeR += 2.0 * crouch;
        this.drop += this.legLen * 0.46 * crouch;
      }

      // ---- arms: left arm raises outward with +Z, right arm with -Z ----
      const out = st.armsOut + w * 0.04;
      const swingA = s * amp * w * st.armSwing;
      let aL = { x: swingA, z: out }, aR = { x: -swingA, z: -out };
      let elbowL = -0.15 * w - run * 1.1, elbowR = -0.15 * w - run * 1.1; // elbow bend forward/back
      let elbowLz = 0, elbowRz = 0;                                     // elbow bend up/down (sideways)
      let headX = st.headDown * (1 - w * 0.5), headY = 0, headZ = 0;
      let spineZ = 0, spineY = 0;
      let arms = p.arms || "down";

      // standing around: each personality has its own way of standing
      if (arms === "down" && !p.sit && !p.lie && !p.held && !p.dance && still > 0.5) {
        const k = still;
        if (p.talking && st.gesture > 0.3) {
          // talking with their hands
          const g = st.gesture;
          aR = { x: -0.45 * g + Math.sin(t * 4.1) * 0.2 * g, z: -0.12 - g * 0.15 };
          elbowR = -0.9 * g + Math.sin(t * 5.3) * 0.35 * g;
          if (g > 0.65) { aL = { x: -0.3 * g + Math.sin(t * 3.7 + 1) * 0.15, z: 0.15 }; elbowL = -0.6 * g; }
        } else if (st.idle === "bouncy") {
          // can't keep still: bouncing on the spot
          this.drop -= Math.abs(Math.sin(t * 5 * tempo)) * 0.05 * k;
          aL.z += Math.sin(t * 5 * tempo) * 0.08; aR.z -= Math.sin(t * 5 * tempo) * 0.08;
        } else if (st.idle === "shy") {
          // hands together in front, looking down, swaying a little
          aL = { x: -0.35, z: 0.3 }; aR = { x: -0.35, z: -0.3 };
          elbowL = elbowR = -1.2; elbowLz = -1.4; elbowRz = 1.4;
          headX += 0.08; spineZ = Math.sin(t * 1.3) * 0.04;
        } else if (st.idle === "grumpy") {
          // arms folded, tapping a foot
          aL = { x: -0.45, z: 0.15 }; aR = { x: -0.45, z: -0.15 };
          elbowL = elbowR = -1.5; elbowLz = -1.2; elbowRz = 1.2;
          kneeR = Math.max(0, Math.sin(t * 6)) * 0.25 * k;
          legR = -kneeR * 0.4;
          headY = 0.15;
        } else if (st.idle === "silly") {
          // bopping along to music only they can hear
          headZ = Math.sin(t * 4 * tempo) * 0.12;
          spineZ = Math.sin(t * 4 * tempo) * 0.05;
          aL.x = Math.sin(t * 4 * tempo) * 0.25; aR.x = -aL.x;
        } else if (st.idle === "proud") {
          // hands on hips
          aL = { x: 0.2, z: 0.5 }; aR = { x: 0.2, z: -0.5 };
          elbowLz = -1.4; elbowRz = 1.4;
          headX -= 0.06;
        } else {
          // relaxed: just breathing
          aL.z += Math.sin(t * 1.6) * 0.02; aR.z -= Math.sin(t * 1.6) * 0.02;
        }
      }

      if (p.dance && (arms === "down" || arms === "out")) arms = "dance-" + (st.dance || "sway");
      const ws = st.waveSize || 1;
      switch (arms) {
        // Mii heads are big, so raised arms bend at the elbow and keep the
        // hands beside the head instead of sweeping through it.
        case "wave": // right arm out to the side, forearm angled up and out, hand waving
          aR = { x: -0.2, z: -(1.05 + 0.45 * Math.min(1.3, ws)) };
          elbowRz = -0.85 + Math.sin(t * (8 + 4 * tempo)) * 0.35 * ws;
          if (ws < 0.85) headX += 0.08; // shy little wave
          break;
        case "up": // one hand up and forward, for a high five
          aR = { x: -0.95, z: -1.25 };
          elbowR = -0.35; elbowRz = -0.7;
          break;
        case "cheer": { // both arms out and up, bouncing
          const big = 0.1 + 0.12 * tempo;
          aL = { x: -0.15, z: 1.6 + Math.sin(t * 10) * big };
          aR = { x: -0.15, z: -1.6 - Math.sin(t * 10 + 1) * big };
          elbowLz = 0.75; elbowRz = -0.75;
          break;
        }
        case "out":
          aL = { x: Math.sin(t * 8) * 0.4, z: 1.2 + Math.sin(t * 8) * 0.4 };
          aR = { x: -Math.sin(t * 8) * 0.4, z: -1.2 - Math.sin(t * 8 + 2) * 0.4 };
          break;
        case "dance-jumpy": { // energetic: punching the air
          const b = Math.sin(t * 8 * tempo);
          aL = { x: -0.3, z: 1.3 + b * 0.5 }; aR = { x: -0.3, z: -1.3 + b * 0.5 };
          elbowLz = 0.6; elbowRz = -0.6;
          legL = -Math.max(0, b) * 0.5; kneeL = Math.max(0, b) * 0.7;
          spineZ = b * 0.08;
          break;
        }
        case "dance-silly": { // silly: flailing arms and a bobbing head
          aL = { x: Math.sin(t * 7) * 1.0, z: 0.9 + Math.sin(t * 5) * 0.6 };
          aR = { x: -Math.sin(t * 6.3) * 1.0, z: -0.9 - Math.sin(t * 5.5 + 1) * 0.6 };
          elbowL = Math.sin(t * 9) * 0.8; elbowR = -Math.sin(t * 8) * 0.8;
          headZ = Math.sin(t * 6) * 0.2;
          spineZ = Math.sin(t * 3) * 0.15;
          kneeL = Math.max(0, Math.sin(t * 6)) * 0.5; kneeR = Math.max(0, -Math.sin(t * 6)) * 0.5;
          break;
        }
        case "dance-sway": { // calm: a gentle side-to-side sway
          const b = Math.sin(t * 3.2 * tempo);
          aL = { x: -0.2, z: 0.5 + b * 0.25 }; aR = { x: -0.2, z: -0.5 + b * 0.25 };
          elbowL = elbowR = -0.5;
          spineZ = b * 0.12; headZ = -b * 0.1;
          kneeL = Math.max(0, b) * 0.25; kneeR = Math.max(0, -b) * 0.25;
          break;
        }
        case "type":
          aL = { x: -0.9, z: 0.15 }; aR = { x: -0.9, z: -0.15 };
          elbowL = elbowR = -0.6 + Math.sin(t * 18) * 0.12;
          break;
        case "held":
          aL = { x: Math.sin(t * 8) * 0.3, z: 1.0 + Math.sin(t * 8) * 0.3 };
          aR = { x: -Math.sin(t * 8) * 0.3, z: -1.0 - Math.sin(t * 8 + 1) * 0.3 };
          break;
        case "flex": // showing off muscles
          aL = { x: -0.1, z: 1.45 }; aR = { x: -0.1, z: -1.45 };
          elbowLz = 1.5 + Math.sin(t * 6) * 0.15; elbowRz = -1.5 - Math.sin(t * 6) * 0.15;
          break;
        case "phone": // holding a phone to the side of the head
          aR = { x: -0.2, z: -1.45 };
          elbowR = -0.3; elbowRz = -1.4;
          headZ = 0.12;
          break;
        case "shout": // hands cupped around the mouth
          aL = { x: -1.2, z: 0.35 }; aR = { x: -1.2, z: -0.35 };
          elbowL = elbowR = -1.5; elbowLz = -0.4; elbowRz = 0.4;
          headX -= 0.18;
          break;
        case "eat": { // bringing food to the mouth
          const b = Math.max(0, Math.sin(t * 3.5));
          aR = { x: -0.65 - b * 0.35, z: -0.3 };
          elbowR = -0.9 - b * 0.9; elbowRz = 0.3;
          headX += 0.05 - b * 0.05;
          break;
        }
        case "drum": { // drumsticks going up and down
          aL = { x: -0.7, z: 0.3 }; aR = { x: -0.7, z: -0.3 };
          elbowL = -0.5 - Math.max(0, Math.sin(t * 14)) * 0.7;
          elbowR = -0.5 - Math.max(0, -Math.sin(t * 14)) * 0.7;
          headX += Math.sin(t * 14) * 0.05;
          break;
        }
        case "aim": { // holding a paintball gun up to the shoulder (Paintball)
          const ap = p.aimPitch || 0;
          // both arms reach forward and meet in front of the chest, hands together on the gun
          aR = { x: -1.4 - ap, z: 0.45 }; elbowR = -0.3; elbowRz = 0.3;
          aL = { x: -1.4 - ap, z: -0.65 }; elbowL = -0.3; elbowLz = -0.3;
          headX -= ap * 0.5;
          break;
        }
        case "knife": { // butterfly knife held ready, slashing when p.swing goes 0..1
          const sw = p.swing || 0;
          aR = { x: -0.95 - Math.sin(sw * Math.PI) * 0.6, z: -0.3 + Math.sin(sw * Math.PI) * 0.6 }; elbowR = -0.7 + sw * 0.5;
          aL = { x: -0.5, z: 0.25 }; elbowL = -0.9;
          break;
        }
        case "strum": { // playing a guitar: one hand on the neck, the other strumming
          aL = { x: -0.75, z: 0.55 }; elbowL = -0.9; elbowLz = -0.2;
          aR = { x: -0.45, z: -0.15 }; elbowR = -0.9 + Math.sin(t * 16) * 0.3; elbowRz = 0.5;
          headX += Math.sin(t * 8) * 0.06; // head bobbing to the beat
          break;
        }
        case "sing": { // microphone in one hand, the other arm out
          aR = { x: -0.5, z: -0.35 }; elbowR = -1.45; elbowRz = 0.6;
          aL = { x: -0.2 + Math.sin(t * 3) * 0.2, z: 0.9 + Math.sin(t * 3) * 0.3 };
          break;
        }
        case "clap": { // clapping
          const b = Math.abs(Math.sin(t * 9));
          aL = { x: -0.95, z: 0.1 + b * 0.35 }; aR = { x: -0.95, z: -0.1 - b * 0.35 };
          elbowL = elbowR = -0.7; elbowLz = -0.5; elbowRz = 0.5;
          break;
        }
        case "punch": { // left, right, left, right...
          const b = Math.sin(t * 6);
          aL = { x: -0.6 - Math.max(0, b) * 0.9, z: 0.2 }; aR = { x: -0.6 - Math.max(0, -b) * 0.9, z: -0.2 };
          elbowL = -1.4 + Math.max(0, b) * 1.3; elbowR = -1.4 + Math.max(0, -b) * 1.3;
          spineY = b * 0.15;
          break;
        }
      }
      if (p.sit && arms === "down") { aL = { x: -0.4, z: 0.12 }; aR = { x: -0.4, z: -0.12 }; elbowL = elbowR = -0.45; }
      if (p.lie && arms === "down") { aL = { x: 0, z: 0.12 }; aR = { x: 0, z: -0.12 }; elbowL = elbowR = 0; }

      this.set("Leg_1_L", legL, 0, 0);
      this.set("Leg_1_R", legR, 0, 0);
      this.set("Leg_2_L", kneeL, 0, 0);
      this.set("Leg_2_R", kneeR, 0, 0);
      this.set("Arm_1_L", aL.x, 0, aL.z);
      this.set("Arm_1_R", aR.x, 0, aR.z);
      this.set("Arm_2_L", elbowL, 0, elbowLz);
      this.set("Arm_2_R", elbowR, 0, elbowRz);

      // body: hips turn with the legs and the shoulders turn the other way when walking;
      // goofy Miis waddle from side to side
      const lean = st.lean * w + run * 0.12 + (p.bow ? 0.75 : 0) + crouch * 0.25;
      this.set("Spine_1", lean, s * 0.07 * w + spineY, s * (0.03 + st.wobble) * w + spineZ);
      this.set("Spine_2", 0, -s * 0.09 * w, 0);
      // head: look around, nod, laugh (and stay steady while walking)
      const laugh = p.laugh ? Math.sin(t * 18) * 0.08 : 0;
      this.set("Head", headX + (p.nod || 0) + laugh - (p.lookUp || 0) - lean * 0.6,
        (p.lookYaw || 0) + headY - s * 0.02 * w,
        headZ + (p.dance ? 0 : Math.sin(t * 0.7) * 0.03) - s * (0.03 + st.wobble) * w * 0.5);
    }
  }

  // When a Mii lies on its back, how far below its spine does its body reach?
  // (its big head sticks out further than its back). Measured once per model, in
  // the model's own size; multiply by the Mii's scale.
  function lieDepth(inst) {
    if (inst.lieDepth !== undefined) return inst.lieDepth;
    const h = inst.holder;
    const keep = { p: h.position.clone(), r: h.rotation.clone(), s: h.scale.clone(), parent: h.parent };
    if (keep.parent) keep.parent.remove(h);
    h.position.set(0, 0, 0); h.scale.setScalar(1);
    h.rotation.order = "YXZ"; h.rotation.set(-Math.PI / 2, 0, 0);
    h.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // measure the body (its clothes); the big head can sink into the pillow
    const add = (o) => { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); };
    inst.inner.traverse((o) => { if (o.isMesh && /clothes/i.test(o.name + " " + (o.parent ? o.parent.name : ""))) add(o); });
    if (!isFinite(box.min.y)) inst.inner.traverse((o) => { if (o.isMesh) add(o); });
    inst.lieDepth = isFinite(box.min.y) ? -box.min.y : 0.25;
    h.position.copy(keep.p); h.rotation.copy(keep.r); h.scale.copy(keep.s);
    if (keep.parent) keep.parent.add(h);
    return inst.lieDepth;
  }

  // ---- closed eyes (sleeping) ----
  // The face is one picture (the "Mask" texture). To close the eyes we find each eye by its
  // white part, rub the eye out, and draw a sleepy curve in its place. Made once per face.
  function closedEyesMap(map) {
    const img = map && map.image;
    if (!img || !img.width) return null;
    const W = img.width, Hh = img.height;
    const c = document.createElement("canvas");
    c.width = W; c.height = Hh;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    let data;
    try { data = g.getImageData(0, 0, W, Hh).data; } catch (e) { return null; }
    // white pixels (the whites of the eyes), split into the left and right eye
    const box = [null, null];
    for (let y = Math.floor(Hh * 0.25); y < Hh * 0.75; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (data[i + 3] > 200 && data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) {
          const k = x < W / 2 ? 0 : 1;
          const b = box[k] || (box[k] = { x0: x, x1: x, y0: y, y1: y });
          if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
        }
      }
    }
    if (!box[0] || !box[1]) return null;
    for (const b of box) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      if (w < 4 || h < 3) return null;
      // rub out the eye (whites, iris and its dark outline), then a closed-eye curve
      const px = w * 0.22, top = h * 0.6, bottom = h * 0.62;
      g.clearRect(b.x0 - px, b.y0 - top, w + px * 2, h + top + bottom);
      const cx = (b.x0 + b.x1) / 2, cy = b.y0 + h * 0.55;
      g.strokeStyle = "#1a1210"; g.lineCap = "round"; g.lineWidth = Math.max(3, w * 0.09);
      g.beginPath();
      g.moveTo(cx - w * 0.5, cy);
      g.quadraticCurveTo(cx, cy + h * 0.55, cx + w * 0.5, cy);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
    if (map.encoding !== undefined) t.encoding = map.encoding;
    t.needsUpdate = true;
    return t;
  }
  const closedCache = new WeakMap(); // open-eyes texture -> closed-eyes texture (or null if we can't)
  function setEyesClosed(inst, closed) {
    if (inst.eyesClosed === !!closed) return;
    inst.eyesClosed = !!closed;
    if (inst.maskMesh === undefined) {
      inst.maskMesh = null;
      inst.inner.traverse((o) => { if (!inst.maskMesh && o.isMesh && o.name === "Mask" && o.material && o.material.map) inst.maskMesh = o; });
      if (inst.maskMesh) { inst.maskMesh.material = inst.maskMesh.material.clone(); inst.openEyes = inst.maskMesh.material.map; }
    }
    const m = inst.maskMesh;
    if (!m) return;
    if (closed) {
      if (!closedCache.has(inst.openEyes)) closedCache.set(inst.openEyes, closedEyesMap(inst.openEyes));
      const t = closedCache.get(inst.openEyes);
      if (!t) return;
      m.material.map = t;
    } else m.material.map = inst.openEyes;
    m.material.needsUpdate = true;
  }

  // ---- small portrait pictures for the side panel ----
  let portraitRenderer = null;
  function portrait(template, look, size) {
    size = size || 96;
    try {
      if (!portraitRenderer) {
        portraitRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        portraitRenderer.outputEncoding = THREE.sRGBEncoding;
      }
      portraitRenderer.setSize(size, size, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 0.7);
      sun.position.set(1, 2, 3);
      scene.add(sun);
      const inst = createInstance(template, look);
      scene.add(inst.holder);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      cam.position.set(0, 1.35, 2.3);
      cam.lookAt(0, 1.28, 0);
      portraitRenderer.render(scene, cam);
      const url = portraitRenderer.domElement.toDataURL("image/png");
      disposeObject(inst.holder);
      return url;
    } catch (e) {
      console.warn("portrait failed", e);
      return "";
    }
  }

  function disposeObject(obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map && m.map.image instanceof HTMLCanvasElement) m.map.dispose();
        m.dispose();
      }
    });
  }

  root.MiiModel = Object.assign(api, { loadTemplate, createInstance, applyLook, portrait, disposeObject, srgbColor, rgbToHex, DEFAULT_STYLE, lieDepth, setEyesClosed });
})(typeof self !== "undefined" ? self : this);
