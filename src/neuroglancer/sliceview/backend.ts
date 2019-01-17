/**
 * @license
 * Copyright 2016 Google Inc.
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

import {Chunk, ChunkConstructor, ChunkSource, withChunkManager} from 'neuroglancer/chunk_manager/backend';
import {CoordinateTransform} from 'neuroglancer/coordinate_transform';
import {RenderLayer as RenderLayerInterface, SLICEVIEW_ADD_VISIBLE_LAYER_RPC_ID, SLICEVIEW_REMOVE_VISIBLE_LAYER_RPC_ID, SLICEVIEW_RENDERLAYER_RPC_ID, SLICEVIEW_RENDERLAYER_UPDATE_TRANSFORM_RPC_ID, SLICEVIEW_RPC_ID, SLICEVIEW_UPDATE_VIEW_RPC_ID, SLICEVIEW_UPDATE_PREFETCHING_RPC_ID, SLICEVIEW_RENDERLAYER_UPDATE_MIP_LEVEL_CONSTRAINTS_RPC_ID, SliceViewBase, SliceViewChunkSource as SliceViewChunkSourceInterface, SliceViewChunkSpecification, GlobalCoordinateRectangle} from 'neuroglancer/sliceview/base';
import {ChunkLayout} from 'neuroglancer/sliceview/chunk_layout';
import {mat4, vec3, vec3Key} from 'neuroglancer/util/geom';
import {NullarySignal} from 'neuroglancer/util/signal';
import {getBasePriority, getPriorityTier, withSharedVisibility} from 'neuroglancer/visibility_priority/backend';
import {registerRPC, registerSharedObject, RPC, SharedObjectCounterpart} from 'neuroglancer/worker_rpc';
import {TrackableMIPLevelConstraints} from 'neuroglancer/trackable_mip_level_constraints';
import {ChunkPriorityTier} from 'neuroglancer/chunk_manager/base';

const BASE_PRIORITY = -1e12;
const SCALE_PRIORITY_MULTIPLIER = 1e9;

// Temporary values used by SliceView.updateVisibleChunk
const tempChunkPosition = vec3.create();
const tempCenter = vec3.create();

// Prefetch parameters
const PREFETCH_WIDTH_MULTIPLIER = 1.9;
const PREFETCH_HEIGHT_MULTIPLIER = 1.9;
const PREFETCH_ADDITIONAL_DEPTH_VOXELS = 1;

// Temporary values used to get prefetch rectangles in SliceView.computeVisibleAndPrefetchChunks
let innerRectangle: GlobalCoordinateRectangle = [vec3.create(), vec3.create(), vec3.create(), vec3.create()];
let outerRectangle: GlobalCoordinateRectangle = [vec3.create(), vec3.create(), vec3.create(), vec3.create()];
const prefetchCenter = vec3.create();
const prefetchDepthMovement = vec3.create();

class SliceViewCounterpartBase extends SliceViewBase {
  constructor(rpc: RPC, options: any) {
    super();
    this.initializeSharedObject(rpc, options['id']);
  }
}

const SliceViewIntermediateBase = withSharedVisibility(withChunkManager(SliceViewCounterpartBase));
@registerSharedObject(SLICEVIEW_RPC_ID)
export class SliceView extends SliceViewIntermediateBase {
  visibleLayers: Map<RenderLayer, {chunkLayout: ChunkLayout, source: SliceViewChunkSource}[]>;
  private prefetchingEnabled = true;

  constructor(rpc: RPC, options: any) {
    super(rpc, options);
    this.registerDisposer(this.chunkManager.recomputeChunkPriorities.add(() => {
      this.updateChunksToRequest();
    }));
  }

  onViewportChanged() {
    this.chunkManager.scheduleUpdateChunkPriorities();
  }

  handleLayerChanged = (() => {
    if (this.hasValidViewport) {
      this.chunkManager.scheduleUpdateChunkPriorities();
    }
  });

  updateChunksToRequest() {
    const globalCenter = this.centerDataPosition;
    let chunkManager = this.chunkManager;
    const visibility = this.visibility.value;
    if (visibility === Number.NEGATIVE_INFINITY) {
      return;
    }

    const sliceViewPriorityTier = getPriorityTier(visibility);
    const prechunkPriorityTier = getPriorityTier(Number.NEGATIVE_INFINITY);
    let basePriority = getBasePriority(visibility);
    basePriority += BASE_PRIORITY;

    const localCenter = tempCenter;

    let getLayoutObject = (chunkLayout: ChunkLayout) => {
      chunkLayout.globalToLocalSpatial(localCenter, globalCenter);
      return this.visibleChunkLayouts.get(chunkLayout);
    };

    function addChunk(priorityTier: ChunkPriorityTier) {
      return (chunkLayout: ChunkLayout, sources: Map<SliceViewChunkSource, number>,
              positionInChunks: vec3, visibleSources: SliceViewChunkSource[]) => {
        vec3.multiply(tempChunkPosition, positionInChunks, chunkLayout.size);
        let priority = -vec3.distance(localCenter, tempChunkPosition);
        for (let source of visibleSources) {
          let priorityIndex = sources.get(source)!;
          let chunk = source.getChunk(positionInChunks);
          chunkManager.requestChunk(
              chunk, priorityTier,
              basePriority + priority + SCALE_PRIORITY_MULTIPLIER * priorityIndex);
        }
      };
    }

    const addVisibleChunk = addChunk(sliceViewPriorityTier);
    this.computeVisibleChunks(getLayoutObject, addVisibleChunk, innerRectangle);
    if (this.prefetchingEnabled) {
      const addPrefetchChunk = addChunk(prechunkPriorityTier);
      this.prefetchChunks(getLayoutObject, addPrefetchChunk, innerRectangle);
    }
  }

  removeVisibleLayer(layer: RenderLayer) {
    this.visibleLayers.delete(layer);
    layer.layerChanged.remove(this.handleLayerChanged);
    layer.transform.changed.remove(this.invalidateVisibleSources);
    layer.mipLevelConstraints.changed.remove(this.invalidateVisibleSources);
    this.invalidateVisibleSources();
  }

  addVisibleLayer(layer: RenderLayer) {
    this.visibleLayers.set(layer, []);
    layer.layerChanged.add(this.handleLayerChanged);
    layer.transform.changed.add(this.invalidateVisibleSources);
    layer.mipLevelConstraints.changed.add(this.invalidateVisibleSources);
    this.invalidateVisibleSources();
  }

  // Prefetch chunks are defined by the state of the viewport and the constants
  // PREFETCH_WIDTH_MULTIPLIER, PREFETCH_HEIGHT_MULTIPLIER, and PREFETCH_ADDITIONAL_DEPTH_VOXELS.
  // These specify which non-visible chunks to request as prefetch chunks, if prefetching is turned
  // on.
  private computePrefetchChunks<T>(
      getLayoutObject: (chunkLayout: ChunkLayout) => T,
      addPrefetchChunk:
          (chunkLayout: ChunkLayout, layoutObject: T, lowerBound: vec3,
           fullyVisibleSources: SliceViewChunkSource[]) => void, visibleRectangle: GlobalCoordinateRectangle) {

    // computePrefetchChunksOutsidePlane prefetch chunks by taking current viewport and moving it
    // along normal vector to the plane, PREFETCH_ADDITIONAL_DEPTH_VOXELS voxels in each direction
    const computePrefetchChunksOutsidePlane = () => {
      const {voxelSize, viewportAxes} = this;
      const moveVertex =
          (vertexOut: vec3, vertexIn: vec3, movementVector: vec3, movementMagnitude: number) => {
            vec3.scale(vertexOut, movementVector, movementMagnitude);
            vec3.add(vertexOut, vertexIn, vertexOut);
          };

      vec3.multiply(prefetchDepthMovement, voxelSize, viewportAxes[2]);
      for (let i = 1; i <= PREFETCH_ADDITIONAL_DEPTH_VOXELS; ++i) {
        // Move corners and center along plane normal in one direction
        for (let j = 0; j < 4; ++j) {
          moveVertex(outerRectangle[j], visibleRectangle[j], prefetchDepthMovement, i);
        }
        moveVertex(prefetchCenter, this.centerDataPosition, prefetchDepthMovement, i);
        this.computeChunksWithinRectangle(
            getLayoutObject, addPrefetchChunk, outerRectangle, prefetchCenter);

        // Move corners and center along plane normal in other direction
        for (let j = 0; j < 4; ++j) {
          moveVertex(outerRectangle[j], visibleRectangle[j], prefetchDepthMovement, i * -1);
        }
        moveVertex(prefetchCenter, this.centerDataPosition, prefetchDepthMovement, i * -1);
        this.computeChunksWithinRectangle(
            getLayoutObject, addPrefetchChunk, outerRectangle, prefetchCenter);
      }
    };

    // computePrefetchChunksWithinPlane selects prefetch chunks by taking current viewport rectangle
    // and pretending its width is PREFETCH_WIDTH_MULTIPLIER times its actual width and its height
    // is PREFETCH_HEIGHT_MULTIPLIER times its actual height. From this larger rectangle, it divides
    // the part that is not visible into 4 smaller rectanges (below, above, left of, and right of
    // the visible viewport), and calls computeChunksWithinRectangle on each one.
    const computePrefetchChunksWithinPlane = () => {
      const setCenterDataPosition = (rectangle: GlobalCoordinateRectangle) => {
        vec3.copy(prefetchCenter, rectangle[0]);
        for (let i = 1; i < 4; ++i) {
          vec3.add(prefetchCenter, prefetchCenter, rectangle[i]);
        }
        vec3.scale(prefetchCenter, prefetchCenter, 0.25);
      };

      enum CornerType { INNER, OUTER }
      type CornerIndex = number;
      type CornerInstruction = [CornerType, CornerIndex];
      type RectangleInstruction =
          [CornerInstruction, CornerInstruction, CornerInstruction, CornerInstruction];
      const computePrefetchRectangleChunks = (rectangleInstruction: RectangleInstruction) => {
        const rectangleCorners: vec3[] = [];
        rectangleInstruction.forEach(cornerInstruction => {
          const rectangleWithVertex =
              (cornerInstruction[0] === CornerType.INNER) ? innerRectangle : outerRectangle;
          rectangleCorners.push(rectangleWithVertex[cornerInstruction[1]]);
        });
        const prefetchRectangle = <GlobalCoordinateRectangle>rectangleCorners;
        setCenterDataPosition(prefetchRectangle);
        this.computeChunksWithinRectangle(
            getLayoutObject, addPrefetchChunk, prefetchRectangle, prefetchCenter);
      };

      this.computeGlobalRectangle(outerRectangle, 1, PREFETCH_HEIGHT_MULTIPLIER);
      const rectangleBelow: RectangleInstruction = [[1, 0], [0, 0], [1, 2], [0, 2]];
      computePrefetchRectangleChunks(rectangleBelow);
      const rectangleAbove: RectangleInstruction = [[0, 1], [1, 1], [0, 3], [1, 3]];
      computePrefetchRectangleChunks(rectangleAbove);
      this.computeGlobalRectangle(
          innerRectangle, PREFETCH_WIDTH_MULTIPLIER, PREFETCH_HEIGHT_MULTIPLIER);
      // Swap names because after above call innerRectangle is now larger rectangle
      const temp = innerRectangle;
      innerRectangle = outerRectangle;
      outerRectangle = temp;
      const rectangleOnLeft: RectangleInstruction = [[1, 0], [1, 1], [0, 0], [0, 1]];
      computePrefetchRectangleChunks(rectangleOnLeft);
      const rectangleOnRight: RectangleInstruction = [[0, 2], [0, 3], [1, 2], [1, 3]];
      computePrefetchRectangleChunks(rectangleOnRight);
    };

    computePrefetchChunksOutsidePlane();
    computePrefetchChunksWithinPlane();
  }

  updatePrefetching(prefetchingEnabled: boolean) {
    if (this.prefetchingEnabled !== prefetchingEnabled) {
      this.prefetchingEnabled = prefetchingEnabled;
      if (this.hasValidViewport) {
        this.chunkManager.scheduleUpdateChunkPriorities();
      }
    }
  }

  disposed() {
    for (let layer of this.visibleLayers.keys()) {
      this.removeVisibleLayer(layer);
    }
    super.disposed();
  }

  private invalidateVisibleSources = (() => {
    this.visibleSourcesStale = true;
    if (this.hasValidViewport) {
      this.chunkManager.scheduleUpdateChunkPriorities();
    }
  });
}

registerRPC(SLICEVIEW_UPDATE_VIEW_RPC_ID, function(x) {
  let obj = this.get(x.id);
  if (x.width) {
    obj.setViewportSize(x.width, x.height);
  }
  if (x.viewportToData) {
    obj.setViewportToDataMatrix(x.viewportToData, x.voxelSize);
  }
});
registerRPC(SLICEVIEW_ADD_VISIBLE_LAYER_RPC_ID, function(x) {
  let obj = <SliceView>this.get(x['id']);
  let layer = <RenderLayer>this.get(x['layerId']);
  obj.addVisibleLayer(layer);
});
registerRPC(SLICEVIEW_REMOVE_VISIBLE_LAYER_RPC_ID, function(x) {
  let obj = <SliceView>this.get(x['id']);
  let layer = <RenderLayer>this.get(x['layerId']);
  obj.removeVisibleLayer(layer);
});
registerRPC(SLICEVIEW_UPDATE_PREFETCHING_RPC_ID, function(x) {
  let obj = <SliceView>this.get(x['id']);
  obj.updatePrefetching(x.prefetchingEnabled);
});

export class SliceViewChunk extends Chunk {
  chunkGridPosition: vec3;
  source: SliceViewChunkSource|null = null;

  constructor() {
    super();
    this.chunkGridPosition = vec3.create();
  }

  initializeVolumeChunk(key: string, chunkGridPosition: vec3) {
    super.initialize(key);
    vec3.copy(this.chunkGridPosition, chunkGridPosition);
  }

  serialize(msg: any, transfers: any[]) {
    super.serialize(msg, transfers);
    msg['chunkGridPosition'] = this.chunkGridPosition;
  }

  downloadSucceeded() {
    super.downloadSucceeded();
  }

  freeSystemMemory() {}

  toString() {
    return this.source!.toString() + ':' + vec3Key(this.chunkGridPosition);
  }
}

export interface SliceViewChunkSource {
  // TODO(jbms): Move this declaration to the class definition below and declare abstract once
  // TypeScript supports mixins with abstact classes.
  getChunk(chunkGridPosition: vec3): SliceViewChunk;

  chunkConstructor: ChunkConstructor<SliceViewChunk>;
}

export class SliceViewChunkSource extends ChunkSource implements SliceViewChunkSourceInterface {
  spec: SliceViewChunkSpecification;
  chunks: Map<string, SliceViewChunk>;
  constructor(rpc: RPC, options: any) {
    super(rpc, options);
  }

  getChunk(chunkGridPosition: vec3) {
    let key = vec3Key(chunkGridPosition);
    let chunk = this.chunks.get(key);
    if (chunk === undefined) {
      chunk = this.getNewChunk_(this.chunkConstructor);
      chunk.initializeVolumeChunk(key, chunkGridPosition);
      this.addChunk(chunk);
    }
    return chunk;
  }
}

@registerSharedObject(SLICEVIEW_RENDERLAYER_RPC_ID)
export class RenderLayer extends SharedObjectCounterpart implements RenderLayerInterface {
  rpcId: number;
  sources: SliceViewChunkSource[][];
  layerChanged = new NullarySignal();
  transform = new CoordinateTransform();
  transformedSources: {source: SliceViewChunkSource, chunkLayout: ChunkLayout}[][];
  transformedSourcesGeneration = -1;
  mipLevelConstraints: TrackableMIPLevelConstraints;

  constructor(rpc: RPC, options: any) {
    super(rpc, options);
    let sources = this.sources = new Array<SliceViewChunkSource[]>();
    for (let alternativeIds of options['sources']) {
      let alternatives = new Array<SliceViewChunkSource>();
      sources.push(alternatives);
      for (let sourceId of alternativeIds) {
        let source: SliceViewChunkSource = rpc.get(sourceId);
        this.registerDisposer(source.addRef());
        alternatives.push(source);
      }
    }
    mat4.copy(this.transform.transform, options['transform']);
    this.transform.changed.add(this.layerChanged.dispatch);
    this.mipLevelConstraints = new TrackableMIPLevelConstraints(options['minMIPLevel'], options['maxMIPLevel'], options['numberOfMIPLevels']);
  }
}
registerRPC(SLICEVIEW_RENDERLAYER_UPDATE_TRANSFORM_RPC_ID, function(x) {
  const layer = <RenderLayer>this.get(x['id']);
  const newValue: mat4 = x['value'];
  const oldValue = layer.transform.transform;
  if (!mat4.equals(newValue, oldValue)) {
    mat4.copy(oldValue, newValue);
    layer.transform.changed.dispatch();
  }
});
registerRPC(SLICEVIEW_RENDERLAYER_UPDATE_MIP_LEVEL_CONSTRAINTS_RPC_ID, function(x) {
  const layer = <RenderLayer>this.get(x.id);
  const newMinMIPLevelValue: number|undefined = x.minMIPLevel;
  const newMaxMIPLevelValue: number|undefined = x.maxMIPLevel;
  layer.mipLevelConstraints.restoreState(newMinMIPLevelValue, newMaxMIPLevelValue);
});
