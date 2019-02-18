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

import {AnnotationSource, makeDataBoundsBoundingBox} from 'neuroglancer/annotation';
import {ChunkManager, WithParameters} from 'neuroglancer/chunk_manager/frontend';
import {DataSource} from 'neuroglancer/datasource';
import {ChunkedGraphSourceParameters, MeshSourceParameters, SkeletonSourceParameters, VolumeChunkEncoding, VolumeChunkSourceParameters} from 'neuroglancer/datasource/graphene/base';
import {MeshSource} from 'neuroglancer/mesh/frontend';
import {VertexAttributeInfo} from 'neuroglancer/skeleton/base';
import {SkeletonSource} from 'neuroglancer/skeleton/frontend';
import {ChunkedGraphChunkSpecification, ChunkedGraphSourceOptions} from 'neuroglancer/sliceview/chunked_graph/base';
import {ChunkedGraphChunkSource} from 'neuroglancer/sliceview/chunked_graph/frontend';
import {DataType, VolumeChunkSpecification, VolumeSourceOptions, VolumeType} from 'neuroglancer/sliceview/volume/base';
import {MultiscaleVolumeChunkSource as GenericMultiscaleVolumeChunkSource, VolumeChunkSource} from 'neuroglancer/sliceview/volume/frontend';
import {Uint64Set} from 'neuroglancer/uint64_set';
import {mat4, vec3} from 'neuroglancer/util/geom';
import {openHttpRequest, parseSpecialUrl, sendHttpRequest} from 'neuroglancer/util/http_request';
import {parseArray, parseFixedLengthArray, parseIntVec, verifyEnumString, verifyFinitePositiveFloat, verifyObject, verifyObjectAsMap, verifyObjectProperty, verifyOptionalString, verifyPositiveInt, verifyString} from 'neuroglancer/util/json';

class GrapheneVolumeChunkSource extends
(WithParameters(VolumeChunkSource, VolumeChunkSourceParameters)) {}

class GrapheneChunkedGraphChunkSource extends
(WithParameters(ChunkedGraphChunkSource, ChunkedGraphSourceParameters)) {}

class GrapheneMeshSource extends
(WithParameters(MeshSource, MeshSourceParameters)) {}

class GrapheneSkeletonSource extends
(WithParameters(SkeletonSource, SkeletonSourceParameters)) {
  get skeletonVertexCoordinatesInVoxels() {
    return false;
  }
  get vertexAttributes() {
    return this.parameters.vertexAttributes;
  }
}

class ScaleInfo {
  key: string;
  encoding: VolumeChunkEncoding;
  resolution: vec3;
  voxelOffset: vec3;
  size: vec3;
  chunkSizes: vec3[];
  compressedSegmentationBlockSize: vec3|undefined;
  constructor(obj: any) {
    verifyObject(obj);
    this.resolution = verifyObjectProperty(
        obj, 'resolution', x => parseFixedLengthArray(vec3.create(), x, verifyFinitePositiveFloat));
    this.voxelOffset =
        verifyObjectProperty(obj, 'voxel_offset', x => parseIntVec(vec3.create(), x)),
    this.size = verifyObjectProperty(
        obj, 'size', x => parseFixedLengthArray(vec3.create(), x, verifyPositiveInt));
    this.chunkSizes = verifyObjectProperty(
        obj, 'chunk_sizes',
        x => parseArray(x, y => parseFixedLengthArray(vec3.create(), y, verifyPositiveInt)));
    if (this.chunkSizes.length === 0) {
      throw new Error('No chunk sizes specified.');
    }
    let encoding = this.encoding =
        verifyObjectProperty(obj, 'encoding', x => verifyEnumString(x, VolumeChunkEncoding));
    if (encoding === VolumeChunkEncoding.COMPRESSED_SEGMENTATION) {
      this.compressedSegmentationBlockSize = verifyObjectProperty(
          obj, 'compressed_segmentation_block_size',
          x => parseFixedLengthArray(vec3.create(), x, verifyPositiveInt));
    }
    this.key = verifyObjectProperty(obj, 'key', verifyString);
  }
}

class GraphInfo {
  chunkSize: vec3;
  constructor(obj: any) {
    verifyObject(obj);
    this.chunkSize = verifyObjectProperty(
        obj, 'chunk_size', x => parseFixedLengthArray(vec3.create(), x, verifyPositiveInt));
  }
}

export class MultiscaleVolumeChunkSource implements GenericMultiscaleVolumeChunkSource {
  baseUrls: string[];
  path: string;
  dataType: DataType;
  numChannels: number;
  volumeType: VolumeType;
  mesh: string|undefined;
  skeleton: string|undefined;
  graph: GraphInfo;
  scales: ScaleInfo[];

  getChunkedGraphUrl() {
    return this.graphUrl;
  }

  getChunkedGraphSources(options: ChunkedGraphSourceOptions, rootSegments: Uint64Set) {
    const spec = ChunkedGraphChunkSpecification.getDefaults({
      voxelSize: this.scales[0].resolution,
      transform: mat4.fromTranslation(
          mat4.create(),
          vec3.multiply(vec3.create(), this.scales[0].resolution, this.scales[0].voxelOffset)),
      upperVoxelBound: this.scales[0].size,
      chunkDataSizes: [this.graph.chunkSize],
      baseVoxelOffset: this.scales[0].voxelOffset,
      chunkedGraphSourceOptions: options,
    });

    return [[this.chunkManager.getChunkSource(GrapheneChunkedGraphChunkSource, {
      spec,
      rootSegments,
      parameters: {
        'baseUrls': this.graphUrl,
        'path': '/segment',
      }
    })]];
  }

  getMeshSource() {
    let {mesh} = this;
    if (mesh === undefined) {
      return null;
    }
    return getShardedMeshSource(this.chunkManager, {
      meshManifestBaseUrls: [this.graphUrl.replace('segmentation', 'meshing')],
      meshFragmentBaseUrls: this.baseUrls,
      meshFragmentPath: `${this.path}/${mesh}`,
      lod: 0
    });
  }

  getSkeletonSource() {
    let {skeleton} = this;
    if (skeleton === undefined) {
      return null;
    }
    return getSkeletonSource(
        this.chunkManager, `${this.baseUrls[0]}${this.path}/${this.skeleton}?{}`);
  }

  constructor(public chunkManager: ChunkManager, public graphUrl: string, obj: any) {
    verifyObject(obj);
    [this.baseUrls, this.path] = verifyObjectProperty(obj, 'data_dir', (x) => parseSpecialUrl(x));
    this.dataType = verifyObjectProperty(obj, 'data_type', x => verifyEnumString(x, DataType));
    this.numChannels = verifyObjectProperty(obj, 'num_channels', verifyPositiveInt);
    this.volumeType = verifyObjectProperty(obj, 'type', x => verifyEnumString(x, VolumeType));
    // this.mesh = verifyObjectProperty(obj, 'mesh', verifyOptionalString);
    this.mesh = 'mesh_downsample_temp';
    this.skeleton = verifyObjectProperty(obj, 'skeletons', verifyOptionalString);
    this.graph = verifyObjectProperty(obj, 'graph', x => new GraphInfo(x));
    this.scales = verifyObjectProperty(obj, 'scales', x => parseArray(x, y => new ScaleInfo(y)));
  }

  getSources(volumeSourceOptions: VolumeSourceOptions) {
    return this.scales.map(scaleInfo => {
      return VolumeChunkSpecification
          .getDefaults({
            voxelSize: scaleInfo.resolution,
            dataType: this.dataType,
            numChannels: this.numChannels,
            transform: mat4.fromTranslation(
                mat4.create(),
                vec3.multiply(vec3.create(), scaleInfo.resolution, scaleInfo.voxelOffset)),
            upperVoxelBound: scaleInfo.size,
            volumeType: this.volumeType,
            chunkDataSizes: scaleInfo.chunkSizes,
            baseVoxelOffset: scaleInfo.voxelOffset,
            compressedSegmentationBlockSize: scaleInfo.compressedSegmentationBlockSize,
            volumeSourceOptions,
          })
          .map(spec => this.chunkManager.getChunkSource(GrapheneVolumeChunkSource, {
            spec,
            parameters: {
              'baseUrls': this.baseUrls,
              'path': `${this.path}/${scaleInfo.key}`,
              'encoding': scaleInfo.encoding
            }
          }));
    });
  }

  getStaticAnnotations() {
    const baseScale = this.scales[0];
    const annotationSet =
        new AnnotationSource(mat4.fromScaling(mat4.create(), baseScale.resolution));
    annotationSet.readonly = true;
    annotationSet.add(makeDataBoundsBoundingBox(
        baseScale.voxelOffset, vec3.add(vec3.create(), baseScale.voxelOffset, baseScale.size)));
    return annotationSet;
  }
}

function parseVertexAttributeInfo(x: any): VertexAttributeInfo {
  verifyObject(x);
  return {
    dataType: verifyObjectProperty(x, 'dataType', y => verifyEnumString(y, DataType)),
    numComponents: verifyObjectProperty(x, 'numComponents', verifyPositiveInt),
  };
}

function parseSkeletonVertexAttributes(spec: string): Map<string, VertexAttributeInfo> {
  return verifyObjectAsMap(JSON.parse(spec), parseVertexAttributeInfo);
}

export function getSkeletonSource(chunkManager: ChunkManager, path: string) {
  const skeletonUrlPattern = /^((?:http|https):\/\/.*\/)([^\/?]+)\?(.*)$/;

  let match = path.match(skeletonUrlPattern);
  if (match === null) {
    throw new Error(`Invalid skeleton volume path: ${JSON.stringify(path)}`);
  }
  return chunkManager.getChunkSource(GrapheneSkeletonSource, {
    parameters: {
      baseUrls: [match[1]],
      path: match[2],
      vertexAttributes: parseSkeletonVertexAttributes(match[3]),
    }
  });
}

export function getShardedMeshSource(chunkManager: ChunkManager, parameters: MeshSourceParameters) {
  return chunkManager.getChunkSource(GrapheneMeshSource, {parameters});
}

export function getShardedVolume(chunkManager: ChunkManager, url: string) {
  return chunkManager.memoize.getUncounted(
      {'type': 'graphene:MultiscaleVolumeChunkSource', url},
      () => sendHttpRequest(openHttpRequest(url + '/info'), 'json')
                .then(response => new MultiscaleVolumeChunkSource(chunkManager, url, response)));
}

export function getMeshSource(chunkManager: ChunkManager, url: string) {
  const [baseUrls, path] = parseSpecialUrl(url);
  return getShardedMeshSource(chunkManager, {
    meshManifestBaseUrls: baseUrls,
    meshFragmentBaseUrls: baseUrls,
    meshFragmentPath: path,
    lod: 0
  });
}

export function getVolume(chunkManager: ChunkManager, url: string) {
  return getShardedVolume(chunkManager, url);
}

export class GrapheneDataSource extends DataSource {
  get description() {
    return 'Graph-backed data source';
  }
  getVolume(chunkManager: ChunkManager, url: string) {
    return getVolume(chunkManager, url);
  }
  getMeshSource(chunkManager: ChunkManager, url: string) {
    return getMeshSource(chunkManager, url);
  }
  getSkeletonSource(chunkManager: ChunkManager, url: string) {
    return getSkeletonSource(chunkManager, url);
  }
}
