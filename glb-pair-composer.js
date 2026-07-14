(function (root) {
  'use strict';

  const JSON_CHUNK = 0x4e4f534a;
  const BIN_CHUNK = 0x004e4942;
  const GLB_MAGIC = 0x46546c67;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function align4(value) {
    return (value + 3) & ~3;
  }

  function parseGlb(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
      throw new Error('Invalid GLB header');
    }
    if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 is supported');

    let json = null;
    let binary = new Uint8Array(0);
    let cursor = 12;
    while (cursor + 8 <= bytes.byteLength) {
      const length = view.getUint32(cursor, true);
      const type = view.getUint32(cursor + 4, true);
      const start = cursor + 8;
      const end = start + length;
      if (end > bytes.byteLength) throw new Error('Invalid GLB chunk length');
      if (type === JSON_CHUNK) {
        const text = new TextDecoder().decode(bytes.subarray(start, end)).replace(/\u0000+$/g, '').trimEnd();
        json = JSON.parse(text);
      } else if (type === BIN_CHUNK) {
        binary = bytes.slice(start, end);
      }
      cursor = end;
    }
    if (!json) throw new Error('GLB JSON chunk is missing');
    return { json, binary };
  }

  function remapMaterial(material, textureOffset) {
    const output = clone(material);
    const visit = (value, key = '') => {
      if (!value || typeof value !== 'object') return;
      if (/Texture$/.test(key) && Number.isInteger(value.index)) {
        value.index += textureOffset;
        return;
      }
      for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
    };
    visit(output);
    return output;
  }

  function mergeGlbs(leftInput, rightInput, options = {}) {
    const sources = [parseGlb(leftInput), parseGlb(rightInput)];
    const ids = [options.leftId || 'left', options.rightId || 'right'];
    const output = {
      asset: { version: '2.0', generator: 'Hikari client two-choice composer' },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
      cameras: [],
      skins: [],
      animations: []
    };
    const binaryParts = [];
    const extensionSets = { used: new Set(), required: new Set() };
    let binaryLength = 0;

    sources.forEach((source, sourceIndex) => {
      const doc = source.json;
      (doc.extensionsUsed || []).forEach((name) => extensionSets.used.add(name));
      (doc.extensionsRequired || []).forEach((name) => extensionSets.required.add(name));

      const offsets = {
        bufferView: output.bufferViews.length,
        accessor: output.accessors.length,
        sampler: output.samplers.length,
        image: output.images.length,
        texture: output.textures.length,
        material: output.materials.length,
        mesh: output.meshes.length,
        camera: output.cameras.length,
        skin: output.skins.length,
        node: output.nodes.length
      };

      const binaryOffset = align4(binaryLength);
      if (binaryOffset > binaryLength) binaryParts.push(new Uint8Array(binaryOffset - binaryLength));
      binaryParts.push(source.binary);
      binaryLength = binaryOffset + source.binary.byteLength;

      for (const bufferView of doc.bufferViews || []) {
        const next = clone(bufferView);
        next.buffer = 0;
        next.byteOffset = (next.byteOffset || 0) + binaryOffset;
        output.bufferViews.push(next);
      }

      for (const accessor of doc.accessors || []) {
        const next = clone(accessor);
        if (Number.isInteger(next.bufferView)) next.bufferView += offsets.bufferView;
        if (next.sparse) {
          next.sparse.indices.bufferView += offsets.bufferView;
          next.sparse.values.bufferView += offsets.bufferView;
        }
        output.accessors.push(next);
      }

      for (const sampler of doc.samplers || []) output.samplers.push(clone(sampler));
      for (const image of doc.images || []) {
        const next = clone(image);
        if (Number.isInteger(next.bufferView)) next.bufferView += offsets.bufferView;
        output.images.push(next);
      }
      for (const texture of doc.textures || []) {
        const next = clone(texture);
        if (Number.isInteger(next.sampler)) next.sampler += offsets.sampler;
        if (Number.isInteger(next.source)) next.source += offsets.image;
        const basisSource = next.extensions?.KHR_texture_basisu?.source;
        if (Number.isInteger(basisSource)) next.extensions.KHR_texture_basisu.source += offsets.image;
        output.textures.push(next);
      }
      for (const material of doc.materials || []) {
        output.materials.push(remapMaterial(material, offsets.texture));
      }

      for (const mesh of doc.meshes || []) {
        const next = clone(mesh);
        for (const primitive of next.primitives || []) {
          for (const key of Object.keys(primitive.attributes || {})) {
            primitive.attributes[key] += offsets.accessor;
          }
          if (Number.isInteger(primitive.indices)) primitive.indices += offsets.accessor;
          if (Number.isInteger(primitive.material)) primitive.material += offsets.material;
          for (const target of primitive.targets || []) {
            for (const key of Object.keys(target)) target[key] += offsets.accessor;
          }
        }
        output.meshes.push(next);
      }

      for (const camera of doc.cameras || []) output.cameras.push(clone(camera));
      for (const skin of doc.skins || []) {
        const next = clone(skin);
        next.joints = (next.joints || []).map((index) => index + offsets.node);
        if (Number.isInteger(next.skeleton)) next.skeleton += offsets.node;
        if (Number.isInteger(next.inverseBindMatrices)) next.inverseBindMatrices += offsets.accessor;
        output.skins.push(next);
      }

      for (const node of doc.nodes || []) {
        const next = clone(node);
        if (Number.isInteger(next.mesh)) next.mesh += offsets.mesh;
        if (Number.isInteger(next.camera)) next.camera += offsets.camera;
        if (Number.isInteger(next.skin)) next.skin += offsets.skin;
        if (next.children) next.children = next.children.map((index) => index + offsets.node);
        output.nodes.push(next);
      }

      for (const animation of doc.animations || []) {
        const next = clone(animation);
        for (const sampler of next.samplers || []) {
          sampler.input += offsets.accessor;
          sampler.output += offsets.accessor;
        }
        for (const channel of next.channels || []) {
          if (Number.isInteger(channel.target?.node)) channel.target.node += offsets.node;
        }
        output.animations.push(next);
      }

      const sceneIndex = Number.isInteger(doc.scene) ? doc.scene : 0;
      const sceneNodes = (doc.scenes?.[sceneIndex]?.nodes || []).map((index) => index + offsets.node);
      const parentIndex = output.nodes.length;
      output.nodes.push({
        name: ids[sourceIndex],
        children: sceneNodes,
        translation: [sourceIndex === 0 ? -0.19 : 0.19, 0, 0],
        scale: [0.13, 0.13, 0.13]
      });
      output.scenes[0].nodes.push(parentIndex);
    });

    const finalBinaryLength = align4(binaryLength);
    if (finalBinaryLength > binaryLength) binaryParts.push(new Uint8Array(finalBinaryLength - binaryLength));
    const binary = new Uint8Array(finalBinaryLength);
    let binaryCursor = 0;
    for (const part of binaryParts) {
      binary.set(part, binaryCursor);
      binaryCursor += part.byteLength;
    }
    output.buffers[0].byteLength = binary.byteLength;
    if (!output.textures.length) delete output.textures;
    if (!output.images.length) delete output.images;
    if (!output.samplers.length) delete output.samplers;
    if (!output.cameras.length) delete output.cameras;
    if (!output.skins.length) delete output.skins;
    if (!output.animations.length) delete output.animations;
    if (extensionSets.used.size) output.extensionsUsed = [...extensionSets.used];
    if (extensionSets.required.size) output.extensionsRequired = [...extensionSets.required];

    const encodedJson = new TextEncoder().encode(JSON.stringify(output));
    const jsonLength = align4(encodedJson.byteLength);
    const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
    const glb = new Uint8Array(totalLength);
    const view = new DataView(glb.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, JSON_CHUNK, true);
    glb.fill(0x20, 20, 20 + jsonLength);
    glb.set(encodedJson, 20);
    const binHeader = 20 + jsonLength;
    view.setUint32(binHeader, binary.byteLength, true);
    view.setUint32(binHeader + 4, BIN_CHUNK, true);
    glb.set(binary, binHeader + 8);
    return glb;
  }

  root.HIKARI_GLB_COMPOSER = Object.freeze({ mergeGlbs, parseGlb });
})(globalThis);
