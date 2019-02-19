/**
 * @license
 * Copyright 2018 The Neuroglancer Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {WithParameters} from 'neuroglancer/chunk_manager/backend';
import {ChunkedGraphSourceParameters, MeshSourceParameters, SkeletonSourceParameters, VolumeChunkEncoding, VolumeChunkSourceParameters} from 'neuroglancer/datasource/graphene/base';
import {decodeJsonManifestChunk, /*decodeTriangleVertexPositionsAndIndices,*/ decodeTriangleVertexPositionsAndIndicesDraco, FragmentChunk, ManifestChunk, MeshSource} from 'neuroglancer/mesh/backend';
import {decodeSkeletonVertexPositionsAndIndices, SkeletonChunk, SkeletonSource} from 'neuroglancer/skeleton/backend';
import {VertexAttributeInfo} from 'neuroglancer/skeleton/base';
import {ChunkDecoder} from 'neuroglancer/sliceview/backend_chunk_decoders';
import {decodeCompressedSegmentationChunk} from 'neuroglancer/sliceview/backend_chunk_decoders/compressed_segmentation';
import {decodeJpegChunk} from 'neuroglancer/sliceview/backend_chunk_decoders/jpeg';
import {decodeRawChunk} from 'neuroglancer/sliceview/backend_chunk_decoders/raw';
import {ChunkedGraphChunk, ChunkedGraphChunkSource, decodeSupervoxelArray} from 'neuroglancer/sliceview/chunked_graph/backend';
import {VolumeChunk, VolumeChunkSource} from 'neuroglancer/sliceview/volume/backend';
import {CancellationToken} from 'neuroglancer/util/cancellation';
import {DATA_TYPE_BYTES} from 'neuroglancer/util/data_type';
import {convertEndian16, convertEndian32, Endianness} from 'neuroglancer/util/endian';
import {openShardedHttpRequest, sendHttpRequest} from 'neuroglancer/util/http_request';
import {registerSharedObject} from 'neuroglancer/worker_rpc';
import * as DracoLoader from 'dracoloader';
// const DracoLoader = require('dracoloader');


const chunkDecoders = new Map<VolumeChunkEncoding, ChunkDecoder>();
chunkDecoders.set(VolumeChunkEncoding.RAW, decodeRawChunk);
chunkDecoders.set(VolumeChunkEncoding.JPEG, decodeJpegChunk);
chunkDecoders.set(VolumeChunkEncoding.COMPRESSED_SEGMENTATION, decodeCompressedSegmentationChunk);

@registerSharedObject() export class GrapheneVolumeChunkSource extends
(WithParameters(VolumeChunkSource, VolumeChunkSourceParameters)) {
  chunkDecoder = chunkDecoders.get(this.parameters.encoding)!;

  download(chunk: VolumeChunk, cancellationToken: CancellationToken) {
    let {parameters} = this;
    let path: string;
    {
      // chunkPosition must not be captured, since it will be invalidated by the next call to
      // computeChunkBounds.
      let chunkPosition = this.computeChunkBounds(chunk);
      let chunkDataSize = chunk.chunkDataSize!;
      path = `${parameters.path}/${chunkPosition[0]}-${chunkPosition[0] + chunkDataSize[0]}_` +
          `${chunkPosition[1]}-${chunkPosition[1] + chunkDataSize[1]}_` +
          `${chunkPosition[2]}-${chunkPosition[2] + chunkDataSize[2]}`;
    }
    return sendHttpRequest(
               openShardedHttpRequest(parameters.baseUrls, path), 'arraybuffer', cancellationToken)
        .then(response => this.chunkDecoder(chunk, response));
  }
}

export function decodeChunkedGraphChunk(
    chunk: ChunkedGraphChunk, rootObjectKey: string, response: ArrayBuffer) {
  return decodeSupervoxelArray(chunk, rootObjectKey, response);
}

@registerSharedObject() export class GrapheneChunkedGraphChunkSource extends
(WithParameters(ChunkedGraphChunkSource, ChunkedGraphSourceParameters)) {
  download(chunk: ChunkedGraphChunk, cancellationToken: CancellationToken) {
    let {parameters} = this;
    let chunkPosition = this.computeChunkBounds(chunk);
    let chunkDataSize = chunk.chunkDataSize!;
    let bounds = `${chunkPosition[0]}-${chunkPosition[0] + chunkDataSize[0]}_` +
        `${chunkPosition[1]}-${chunkPosition[1] + chunkDataSize[1]}_` +
        `${chunkPosition[2]}-${chunkPosition[2] + chunkDataSize[2]}`;

    let promises = Array<Promise<void>>();
    for (const [key, val] of chunk.mappings!.entries()) {
      if (val === null) {
        let requestPath = `${parameters.path}/${key}/leaves?bounds=${bounds}`;
        promises.push(sendHttpRequest(
                          openShardedHttpRequest(parameters.baseUrls, requestPath), 'arraybuffer',
                          cancellationToken)
                          .then(response => decodeChunkedGraphChunk(chunk, key, response)));
      }
    }
    return Promise.all(promises).then(() => {
      return;
    });
  }
}

export function decodeManifestChunk(chunk: ManifestChunk, response: any) {
  return decodeJsonManifestChunk(chunk, response, 'fragments');
}

// function decodeDracoData(rawBuffer, decoder) {
//   const buffer = new decoderModule.DecoderBuffer();
//   buffer.Init(new Int8Array(rawBuffer), rawBuffer.byteLength);
//   const geometryType = decoder.GetEncodedGeometryType(buffer);

//   let dracoGeometry;
//   let status;
//   // if (geometryType === decoderModule.TRIANGULAR_MESH) {
//   dracoGeometry = new decoderModule.Mesh();
//   status = decoder.DecodeBufferToMesh(buffer, dracoGeometry);
//   // } else if (geometryType === decoderModule.POINT_CLOUD) {
//   //   dracoGeometry = new decoderModule.PointCloud();
//   //   status = decoder.DecodeBufferToPointCloud(buffer, dracoGeometry);
//   // } else {
//   //   const errorMsg = 'Error: Unknown geometry type.';
//   //   console.error(errorMsg);
//   // }
//   decoderModule.destroy(buffer);

//   return dracoGeometry;
// }

// export function decodeFragmentChunk(chunk: FragmentChunk, response: ArrayBuffer) {
//   let dv = new DataView(response);
//   let numVertices = dv.getUint32(0, true);
//   decodeTriangleVertexPositionsAndIndices(
//     chunk, response, Endianness.LITTLE, /*vertexByteOffset=*/4, numVertices);
// }

// import * as fs from "fs";
// const draco3d = require('draco3d');
// const decoderModule = draco3d.createDecoderModule({});
const dracoLoader = DracoLoader.default;
// const decoderModule = dracoLoader.decoderModule;
export function decodeFragmentChunk(chunk: FragmentChunk, response: ArrayBuffer) {
  if (!dracoLoader.moduleLoaded) {
    throw new Error('draco module not loaded');
  }
  const decoderModule = dracoLoader.decoderModule;
  const startTime = Date.now();
  const decoder = new decoderModule.Decoder();
  const buffer = new decoderModule.DecoderBuffer();
  buffer.Init(new Int8Array(response), response.byteLength);
  console.log(`Setup time: ${Date.now() - startTime}`);
  // const geometryType = decoder.GetEncodedGeometryType(buffer);
  const mesh = new decoderModule.Mesh();
  decoder.DecodeBufferToMesh(buffer, mesh);
  console.log(`Time to decode: ${Date.now() - startTime}`);
  decoderModule.destroy(buffer);
  // const decodedGeometry = decodeDracoData(response, decoder);
  const numFaces = mesh.num_faces();
  const numIndices = numFaces * 3;
  const numPoints = mesh.num_points();
  const indices = new Uint32Array(numIndices);

  // console.log("Number of faces " + numFaces);
  // console.log("Number of vertices " + numPoints);

  // Add Faces to mesh
  const ia = new decoderModule.DracoInt32Array();
  for (let i = 0; i < numFaces; ++i) {
    decoder.GetFaceFromMesh(mesh, i, ia);
    const index = i * 3;
    indices[index] = ia.GetValue(0);
    indices[index + 1] = ia.GetValue(1);
    indices[index + 2] = ia.GetValue(2);
  }
  decoderModule.destroy(ia);

  // const attrs = {POSITION: 3, NORMAL: 3, COLOR: 3, TEX_COORD: 2};

  // Object.keys(attrs).forEach((attr) => {
    // const stride = attrs.POSITION;
  const stride = 3;
  const numValues = numPoints * stride;
  const decoderAttr = decoderModule.POSITION;
  // const encoderAttr = encoderModule[attr];
  const attrId = decoder.GetAttributeId(mesh, decoderAttr);

  if (attrId < 0) {
    console.log('attrId 0');
    return;
  }

  // console.log("Adding %s attribute", attr);

  const attribute = decoder.GetAttribute(mesh, attrId);
  const attributeData = new decoderModule.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, attributeData);

  // assert(numValues === attributeData.size(), 'Wrong attribute size.');

  const attributeDataArray = new Float32Array(numValues);
  for (let i = 0; i < numValues; ++i) {
    attributeDataArray[i] = attributeData.GetValue(i);
  }

  chunk.vertexPositions = attributeDataArray;
  chunk.indices = indices;
  const endTime = Date.now();
  console.log(`Time: ${endTime - startTime}`);
  decodeTriangleVertexPositionsAndIndicesDraco(chunk);
  const nowTime = Date.now();
  console.log(`Time: ${nowTime - startTime}`);
}


// dracoLoader.getDecoderModule();
// export function decodeFragmentChunk(chunk: FragmentChunk, response: ArrayBuffer) {
//   const startTime = Date.now();
//   dracoLoader.decodeDracoFile(response, (decoderModule: any) => {
//     console.log(`Time to get decoder module: ${Date.now() - startTime}`);
//     const decoder = new decoderModule.Decoder();
//     const buffer = new decoderModule.DecoderBuffer();
//     buffer.Init(new Int8Array(response), response.byteLength);
//     console.log(`Setup time: ${Date.now() - startTime}`);
//     // const geometryType = decoder.GetEncodedGeometryType(buffer);
//     const mesh = new decoderModule.Mesh();
//     decoder.DecodeBufferToMesh(buffer, mesh);
//     console.log(`Time to decode: ${Date.now() - startTime}`);
//     decoderModule.destroy(buffer);
//     // const decodedGeometry = decodeDracoData(response, decoder);
//     const numFaces = mesh.num_faces();
//     const numIndices = numFaces * 3;
//     const numPoints = mesh.num_points();
//     const indices = new Uint32Array(numIndices);

//     // console.log("Number of faces " + numFaces);
//     // console.log("Number of vertices " + numPoints);

//     // Add Faces to mesh
//     const ia = new decoderModule.DracoInt32Array();
//     for (let i = 0; i < numFaces; ++i) {
//       decoder.GetFaceFromMesh(mesh, i, ia);
//       const index = i * 3;
//       indices[index] = ia.GetValue(0);
//       indices[index + 1] = ia.GetValue(1);
//       indices[index + 2] = ia.GetValue(2);
//     }
//     decoderModule.destroy(ia);

//     // const attrs = {POSITION: 3, NORMAL: 3, COLOR: 3, TEX_COORD: 2};

//     // Object.keys(attrs).forEach((attr) => {
//       // const stride = attrs.POSITION;
//     const stride = 3;
//     const numValues = numPoints * stride;
//     const decoderAttr = decoderModule.POSITION;
//     // const encoderAttr = encoderModule[attr];
//     const attrId = decoder.GetAttributeId(mesh, decoderAttr);

//     if (attrId < 0) {
//       console.log('attrId 0');
//       return;
//     }

//     // console.log("Adding %s attribute", attr);

//     const attribute = decoder.GetAttribute(mesh, attrId);
//     const attributeData = new decoderModule.DracoFloat32Array();
//     decoder.GetAttributeFloatForAllPoints(mesh, attribute, attributeData);

//     // assert(numValues === attributeData.size(), 'Wrong attribute size.');

//     const attributeDataArray = new Float32Array(numValues);
//     for (let i = 0; i < numValues; ++i) {
//       attributeDataArray[i] = attributeData.GetValue(i);
//     }

//     chunk.vertexPositions = attributeDataArray;
//     chunk.indices = indices;
//     const endTime = Date.now();
//     console.log(`Time: ${endTime - startTime}`);
//     decodeTriangleVertexPositionsAndIndicesDraco(chunk);
//   }, undefined, undefined);
// }

@registerSharedObject() export class GrapheneMeshSource extends
(WithParameters(MeshSource, MeshSourceParameters)) {
  download(chunk: ManifestChunk, cancellationToken: CancellationToken) {
    let {parameters} = this;
    let requestPath = `/manifest/${chunk.objectId}:${parameters.lod}?verify=True`;
    return sendHttpRequest(
               openShardedHttpRequest(parameters.meshManifestBaseUrls, requestPath), 'json',
               cancellationToken)
        .then(response => decodeManifestChunk(chunk, response));
  }

  downloadFragment(chunk: FragmentChunk, cancellationToken: CancellationToken) {
    let {parameters} = this;
    let requestPath = `${parameters.meshFragmentPath}/${chunk.fragmentId}`;
    return sendHttpRequest(
               openShardedHttpRequest(parameters.meshFragmentBaseUrls, requestPath), 'arraybuffer',
               cancellationToken)
        .then(response => decodeFragmentChunk(chunk, response));
  }
}

function decodeSkeletonChunk(
    chunk: SkeletonChunk, response: ArrayBuffer,
    vertexAttributes: Map<string, VertexAttributeInfo>) {
  let dv = new DataView(response);
  let numVertices = dv.getUint32(0, true);
  let numEdges = dv.getUint32(4, true);
  const vertexPositionsStartOffset = 8;

  let curOffset = 8 + numVertices * 4 * 3;
  let attributes: Uint8Array[] = [];
  for (let info of vertexAttributes.values()) {
    const bytesPerVertex = DATA_TYPE_BYTES[info.dataType] * info.numComponents;
    const totalBytes = bytesPerVertex * numVertices;
    const attribute = new Uint8Array(response, curOffset, totalBytes);
    switch (bytesPerVertex) {
      case 2:
        convertEndian16(attribute, Endianness.LITTLE);
        break;
      case 4:
      case 8:
        convertEndian32(attribute, Endianness.LITTLE);
        break;
    }
    attributes.push(attribute);
    curOffset += totalBytes;
  }
  chunk.vertexAttributes = attributes;
  decodeSkeletonVertexPositionsAndIndices(
      chunk, response, Endianness.LITTLE, /*vertexByteOffset=*/vertexPositionsStartOffset,
      numVertices,
      /*indexByteOffset=*/curOffset, /*numEdges=*/numEdges);
}

@registerSharedObject() export class GrapheneSkeletonSource extends
  (WithParameters(SkeletonSource, SkeletonSourceParameters)) {
  download(chunk: SkeletonChunk, cancellationToken: CancellationToken) {
    const {parameters} = this;
    let requestPath = `${parameters.path}/${chunk.objectId}`;
    return sendHttpRequest(
               openShardedHttpRequest(parameters.baseUrls, requestPath), 'arraybuffer',
               cancellationToken)
        .then(response => decodeSkeletonChunk(chunk, response, parameters.vertexAttributes));
  }
}
