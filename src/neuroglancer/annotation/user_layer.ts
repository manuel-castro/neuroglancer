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

import {AnnotationType, LocalAnnotationSource, Annotation} from 'neuroglancer/annotation';
import {AnnotationLayerState} from 'neuroglancer/annotation/frontend';
import {CoordinateTransform, makeDerivedCoordinateTransform} from 'neuroglancer/coordinate_transform';
import {LayerReference, ManagedUserLayer, UserLayer} from 'neuroglancer/layer';
import {LayerListSpecification, registerLayerType} from 'neuroglancer/layer_specification';
import {VoxelSize} from 'neuroglancer/navigation_state';
import {SegmentationDisplayState} from 'neuroglancer/segmentation_display_state/frontend';
import {SegmentationUserLayer} from 'neuroglancer/segmentation_user_layer';
import {StatusMessage} from 'neuroglancer/status';
import {ElementVisibilityFromTrackableBoolean, TrackableBoolean, TrackableBooleanCheckbox} from 'neuroglancer/trackable_boolean';
import {makeDerivedWatchableValue, WatchableValue} from 'neuroglancer/trackable_value';
import {AnnotationLayerView, getAnnotationRenderOptions, UserLayerWithAnnotationsMixin} from 'neuroglancer/ui/annotations';
import {UserLayerWithCoordinateTransformMixin} from 'neuroglancer/user_layer_with_coordinate_transform';
import {mat4, vec3} from 'neuroglancer/util/geom';
import {parseArray, verify3dVec} from 'neuroglancer/util/json';
import {LayerReferenceWidget} from 'neuroglancer/widget/layer_reference';
import {Tab} from 'neuroglancer/widget/tab_view';
import {Borrowed, RefCounted, registerEventListener} from 'neuroglancer/util/disposable';
import {EventActionMap, registerActionListener} from 'neuroglancer/util/event_action_map';
import {KeyboardEventBinder} from 'neuroglancer/util/keyboard_bindings';
import {Uint64} from 'neuroglancer/util/uint64';
import {SegmentSelectionState, Uint64MapEntry} from 'neuroglancer/segmentation_display_state/frontend';

require('./user_layer.css');

const POINTS_JSON_KEY = 'points';
const ANNOTATIONS_JSON_KEY = 'annotations';
const ANNOTATION_TAGS_JSON_KEY = 'annotationTags';

type AnnotationShortcutAction = {
  actionName: string;
  actionFunction: Function;
};

function addPointAnnotations(annotations: LocalAnnotationSource, obj: any) {
  if (obj === undefined) {
    return;
  }
  parseArray(obj, (x, i) => {
    annotations.add({
      type: AnnotationType.POINT,
      id: '' + i,
      point: verify3dVec(x),
    });
  });
}

function isValidLinkedSegmentationLayer(layer: ManagedUserLayer) {
  const userLayer = layer.layer;
  if (userLayer === null) {
    return true;
  }
  if (userLayer instanceof SegmentationUserLayer) {
    return true;
  }
  return false;
}

function getSegmentationDisplayState(layer: ManagedUserLayer|undefined): SegmentationDisplayState|
    undefined {
  if (layer === undefined) {
    return undefined;
  }
  const userLayer = layer.layer;
  if (userLayer === null) {
    return undefined;
  }
  if (!(userLayer instanceof SegmentationUserLayer)) {
    return undefined;
  }
  return userLayer.displayState;
}

function getPointFromAnnotation(annotation: Annotation) {
  switch (annotation.type) {
    case AnnotationType.AXIS_ALIGNED_BOUNDING_BOX:
    case AnnotationType.LINE:
      return annotation.pointA;
    case AnnotationType.POINT:
      return annotation.point;
    case AnnotationType.ELLIPSOID:
      return annotation.center;
  }
}

const VOXEL_SIZE_JSON_KEY = 'voxelSize';
const SOURCE_JSON_KEY = 'source';
const LINKED_SEGMENTATION_LAYER_JSON_KEY = 'linkedSegmentationLayer';
const FILTER_BY_SEGMENTATION_JSON_KEY = 'filterBySegmentation';
const Base = UserLayerWithAnnotationsMixin(UserLayerWithCoordinateTransformMixin(UserLayer));
export class AnnotationUserLayer extends Base {
  localAnnotations = this.registerDisposer(new LocalAnnotationSource());
  voxelSize = new VoxelSize();
  sourceUrl: string|undefined;
  linkedSegmentationLayer = this.registerDisposer(
      new LayerReference(this.manager.rootLayers.addRef(), isValidLinkedSegmentationLayer));
  filterBySegmentation = new TrackableBoolean(false);
  shortcutHandler = this.registerDisposer(new AnnotationShortcutHandler());

  getAnnotationRenderOptions() {
    const segmentationState =
        new WatchableValue<SegmentationDisplayState|undefined|null>(undefined);
    const setSegmentationState = () => {
      const {linkedSegmentationLayer} = this;
      if (linkedSegmentationLayer.layerName === undefined) {
        segmentationState.value = null;
      } else {
        const {layer} = linkedSegmentationLayer;
        segmentationState.value = getSegmentationDisplayState(layer);
      }
    };
    this.registerDisposer(this.linkedSegmentationLayer.changed.add(setSegmentationState));
    setSegmentationState();
    return {
      segmentationState,
      filterBySegmentation: this.filterBySegmentation,
      ...getAnnotationRenderOptions(this)
    };
  }

  constructor(manager: LayerListSpecification, specification: any) {
    super(manager, specification);
    const sourceUrl = this.sourceUrl = specification[SOURCE_JSON_KEY];
    this.linkedSegmentationLayer.restoreState(specification[LINKED_SEGMENTATION_LAYER_JSON_KEY]);
    this.filterBySegmentation.restoreState(specification[FILTER_BY_SEGMENTATION_JSON_KEY]);
    if (sourceUrl === undefined) {
      this.isReady = true;
      this.voxelSize.restoreState(specification[VOXEL_SIZE_JSON_KEY]);
      this.localAnnotations.restoreState(specification[ANNOTATIONS_JSON_KEY], specification[ANNOTATION_TAGS_JSON_KEY]);
      // Handle legacy "points" property.
      addPointAnnotations(this.localAnnotations, specification[POINTS_JSON_KEY]);
      let voxelSizeValid = false;
      const handleVoxelSizeChanged = () => {
        if (!this.voxelSize.valid && manager.voxelSize.valid) {
          vec3.copy(this.voxelSize.size, manager.voxelSize.size);
          this.voxelSize.setValid();
        }
        if (this.voxelSize.valid && voxelSizeValid === false) {
          const derivedTransform = new CoordinateTransform();
          this.registerDisposer(
              makeDerivedCoordinateTransform(derivedTransform, this.transform, (output, input) => {
                const voxelScalingMatrix = mat4.fromScaling(mat4.create(), this.voxelSize.size);
                mat4.multiply(output, input, voxelScalingMatrix);
              }));
          this.annotationLayerState.value = new AnnotationLayerState({
            transform: derivedTransform,
            source: this.localAnnotations.addRef(),
            ...this.getAnnotationRenderOptions()
          });
          voxelSizeValid = true;
        }
      };
      this.registerDisposer(this.localAnnotations.changed.add(this.specificationChanged.dispatch));
      this.registerDisposer(this.voxelSize.changed.add(this.specificationChanged.dispatch));
      this.registerDisposer(
          this.filterBySegmentation.changed.add(this.specificationChanged.dispatch));
      this.registerDisposer(this.voxelSize.changed.add(handleVoxelSizeChanged));
      this.registerDisposer(this.manager.voxelSize.changed.add(handleVoxelSizeChanged));
      handleVoxelSizeChanged();
      if (!this.localAnnotations.readonly) {
        this.tabs.add('annotation-shortcuts', {
          label: 'Shortcuts',
          order: 1000,
          getter: () => new AnnotationShortcutsTab(this)
        });
      }
    } else {
      StatusMessage
          .forPromise(
              this.manager.dataSourceProvider.getAnnotationSource(
                  this.manager.chunkManager, sourceUrl),
              {
                initialMessage: `Retrieving metadata for volume ${sourceUrl}.`,
                delay: true,
                errorPrefix: `Error retrieving metadata for volume ${sourceUrl}: `,
              })
          .then(source => {
            if (this.wasDisposed) {
              return;
            }
            this.annotationLayerState.value = new AnnotationLayerState(
                {transform: this.transform, source, ...this.getAnnotationRenderOptions()});
            this.isReady = true;
          });
    }
    this.tabs.default = 'annotations';
  }

  initializeAnnotationLayerViewTab(tab: AnnotationLayerView) {
    const widget = tab.registerDisposer(new LayerReferenceWidget(this.linkedSegmentationLayer));
    widget.element.insertBefore(
        document.createTextNode('Linked segmentation: '), widget.element.firstChild);
    tab.element.appendChild(widget.element);

    {
      const checkboxWidget = this.registerDisposer(
          new TrackableBooleanCheckbox(tab.annotationLayer.filterBySegmentation));
      const label = document.createElement('label');
      label.textContent = 'Filter by segmentation: ';
      label.appendChild(checkboxWidget.element);
      tab.element.appendChild(label);
      tab.registerDisposer(new ElementVisibilityFromTrackableBoolean(
          this.registerDisposer(makeDerivedWatchableValue(
              v => v !== undefined, tab.annotationLayer.segmentationState)),
          label));
    }

    this.setupAnnotationShortcuts(tab.element);
  }

  toJSON() {
    const x = super.toJSON();
    x['type'] = 'annotation';
    x[SOURCE_JSON_KEY] = this.sourceUrl;
    if (this.sourceUrl === undefined) {
      const localAnnotationsJSONObj = this.localAnnotations.toJSON();
      x[ANNOTATIONS_JSON_KEY] = localAnnotationsJSONObj.annotations;
      x[ANNOTATION_TAGS_JSON_KEY] = localAnnotationsJSONObj.tags;
      x[VOXEL_SIZE_JSON_KEY] = this.voxelSize.toJSON();
    }
    x[LINKED_SEGMENTATION_LAYER_JSON_KEY] = this.linkedSegmentationLayer.toJSON();
    x[FILTER_BY_SEGMENTATION_JSON_KEY] = this.filterBySegmentation.toJSON();
    return x;
  }

  getPrevAnnotation() {
    if (this.selectedAnnotation.value) {
      return this.localAnnotations.getPrevAnnotation(this.selectedAnnotation.value.id)!;
    }
    return;
  }

  getNextAnnotation() {
    if (this.selectedAnnotation.value) {
      return this.localAnnotations.getNextAnnotation(this.selectedAnnotation.value.id)!;
    }
    return;
  }

  setupAnnotationShortcuts(element: HTMLElement) {
    element.tabIndex = -1;
    this.shortcutHandler.setup(element, EventActionMap.fromObject({
      'bracketright': 'go-to-next-annotation',
      'bracketleft': 'go-to-prev-annotation'
    }), this.getDefaultShortcutActions());
    // layer.registerDisposer(new AutomaticallyFocusedElement(element));
  }

  private getDefaultShortcutActions() {
    const temp = new Uint64();
    function toUint64(value: any): Uint64 {
      if (typeof value === 'number') {
        temp.low = value;
        temp.high = 0;
        value = temp;
      } else if (value instanceof Uint64MapEntry) {
        value = value.value;
      }
      return value;
    }
    const jumpToAnnotation = (annotation: Annotation|undefined) => {
      if (annotation && this.annotationLayerState.value) {
        this.selectedAnnotation.value = {id: annotation.id, partIndex: 0};
        const point = getPointFromAnnotation(annotation);
        const spatialPoint = vec3.create();
        vec3.transformMat4(spatialPoint, point, this.annotationLayerState.value.objectToGlobal);
        this.manager.setSpatialCoordinates(spatialPoint);
        this.manager.layerSelectedValues.manualUpdate(spatialPoint);
        for (let layer of this.manager.layerManager.managedLayers) {
          let userLayer = layer.layer;
          if (layer.visible && userLayer && userLayer instanceof SegmentationUserLayer) {
            userLayer.displayState.segmentSelectionState.set(toUint64(this.manager.layerSelectedValues.get(userLayer)));
            userLayer.displayState.segmentSelectionState.setRaw(toUint64(this.manager.layerSelectedValues.get(userLayer)));
            userLayer.selectSegment();
          }
        }
      }
    };
    return [
      {
        actionName: 'go-to-next-annotation',
        actionFunction: () => {
          jumpToAnnotation(this.getNextAnnotation());
        }
      },
      {
        actionName: 'go-to-prev-annotation',
        actionFunction: () => {
          jumpToAnnotation(this.getPrevAnnotation());
        }
      }
    ];
  }

  getAnnotationText(annotation: Annotation) {
    let text = super.getAnnotationText(annotation);
    if (annotation.tagIds) {
      annotation.tagIds.forEach(tagId => {
        const tag = this.localAnnotations.getTag(tagId);
        if (tag) {
          text += ' #' + tag.label;
        }
      });
    }
    return text;
  }
}

class AnnotationShortcutsTab extends Tab {
  private keyShortcuts = ['keyq', 'keyw', 'keye', 'keyr'];
  constructor(public layer: Borrowed<AnnotationUserLayer>) {
    super();
    const {element} = this;
    element.classList.add('neuroglancer-annotation-shortcuts-tab');
    const addShortcutButton = document.createElement('button');
    addShortcutButton.textContent = '+';
    const numShortcuts = this.keyShortcuts.length;
    addShortcutButton.addEventListener('click', () => {
      if (this.keyShortcuts.length === 0) {
        alert(`Reached max number of shortcuts. Currently, only ${numShortcuts} are supported.`);
      } else {
        this.addNewShortcut();
      }
    });
    element.appendChild(addShortcutButton);
    for (const tagId of layer.localAnnotations.getTagIds()) {
      if (this.keyShortcuts.length === 0) {
        throw new Error(`Too many tags in JSON state. Currently, only ${numShortcuts} are supported.`);
      } else {
        this.addNewShortcut(tagId);
      }
    }
  }

  private addNewShortcut(tagId?: number) {
    const {localAnnotations, selectedAnnotation, shortcutHandler} = this.layer;
    const newShortcutElement = document.createElement('div');
    newShortcutElement.classList.add('neuroglancer-annotation-shortcut');
    const shortcutTextbox = document.createElement('span');
    const shortcutCode = shortcutTextbox.textContent = this.keyShortcuts.pop()!;
    shortcutTextbox.className = 'display-annotation-shortcut-textbox';
    const annotationTagName = document.createElement('input');
    annotationTagName.value = '';
    if (tagId !== undefined) {
      const tag = localAnnotations.getTag(tagId);
      if (tag) {
        annotationTagName.value = tag.label;
      }
    }
    // const addAnnotationTagToAnnotation = () => {
    //   console.log(annotationTagName.value);
    //   const reference = selectedAnnotation.reference;
    //   if (reference && reference.value) {
    //     localAnnotations.update(reference, {...reference.value, description: annotationTagName.value});
    //     localAnnotations.commit(reference);
    //   }
    // };
    const annotationTagId = (tagId === undefined) ? localAnnotations.addTag(annotationTagName.value) : tagId;

    const tagChangeListener = registerEventListener(annotationTagName, 'input', () => {
      console.log(annotationTagName.value);
      localAnnotations.updateTagLabel(annotationTagId, annotationTagName.value);
    });
    this.registerDisposer(tagChangeListener);
    const addAnnotationTagToAnnotation = () => {
      const reference = selectedAnnotation.reference;
      if (reference && reference.value) {
        localAnnotations.toggleAnnotationTag(reference, annotationTagId);
        // localAnnotations.commit(reference);
      }
    };
    shortcutHandler.addShortcut(shortcutCode, addAnnotationTagToAnnotation);
    const removeShortcut = document.createElement('button');
    removeShortcut.textContent = 'x';
    removeShortcut.addEventListener('click', () => {
      newShortcutElement.remove();
      this.keyShortcuts.push(shortcutCode);
      shortcutHandler.removeShortcut(shortcutCode);
      tagChangeListener();
      this.unregisterDisposer(tagChangeListener);
      localAnnotations.deleteTag(annotationTagId);
    });
    newShortcutElement.appendChild(shortcutTextbox);
    newShortcutElement.appendChild(annotationTagName);
    newShortcutElement.appendChild(removeShortcut);
    this.element.appendChild(newShortcutElement);
  }
}

class AnnotationShortcutHandler extends RefCounted {
  private shortcutEventBinder: KeyboardEventBinder<EventActionMap>|undefined = undefined;
  // shortcutEventActions is a map from a keycode to the action that it triggers.
  // it's used to hold actions until the 'Annotations' tab is created.
  private shortcutEventActions = new Map<string, () => void>();
  private shortcutEventDisposers = new Map<string, () => void>();

  private static getShortcutEventName(shortcutKeyCode: string) {
    return 'annotationShortcutEvent:' + shortcutKeyCode;
  }

  private isSetup() {
    return !!this.shortcutEventBinder;
  }

  addShortcut(shortcutKeyCode: string, shortcutAction: () => void) {
    if (this.isSetup()) {
      const shortcutEventName = AnnotationShortcutHandler.getShortcutEventName(shortcutKeyCode);
      const actionRemover = registerActionListener(this.shortcutEventBinder!.target, shortcutEventName, shortcutAction);
      this.shortcutEventBinder!.eventMap.set(shortcutKeyCode, shortcutEventName);
      this.registerDisposer(actionRemover);
      this.shortcutEventDisposers.set(shortcutKeyCode, actionRemover);
      return true;
    }
    // Event will be added later when 'Annotations' tab is created
    this.shortcutEventActions.set(shortcutKeyCode, shortcutAction);
    return false;
  }

  removeShortcut(shortcutCode: string) {
    if (this.isSetup()) {
      const actionRemover = this.shortcutEventDisposers.get(shortcutCode);
      if (actionRemover) {
        actionRemover();
        this.shortcutEventBinder!.eventMap.delete(shortcutCode);
        this.shortcutEventDisposers.delete(shortcutCode);
        this.unregisterDisposer(actionRemover);
      }
    } else {
      this.shortcutEventActions.delete(shortcutCode);
    }
  }

  setup(shortcutEventTarget: HTMLElement, defaultEventActionMap: EventActionMap, defaultEventActions: Array<{actionName: string, actionFunction: () => void}>) {
    if (!this.isSetup()) {
      for (const {actionName, actionFunction} of defaultEventActions) {
        this.registerDisposer(registerActionListener(shortcutEventTarget, actionName, actionFunction));
      }
      this.shortcutEventBinder = this.registerDisposer(new KeyboardEventBinder<EventActionMap>(shortcutEventTarget, defaultEventActionMap));
      for (const [keyCode, shortcutAction] of this.shortcutEventActions) {
        this.addShortcut(keyCode, shortcutAction);
      }
      this.shortcutEventActions.clear();
      return true;
    }
    return false;
  }
}

registerLayerType('annotation', AnnotationUserLayer);
registerLayerType('pointAnnotation', AnnotationUserLayer);
