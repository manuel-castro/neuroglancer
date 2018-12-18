import {TrackableValue} from 'neuroglancer/trackable_value';
import {RefCounted} from 'neuroglancer/util/disposable';
import {removeFromParent} from 'neuroglancer/util/dom';

export class VoxelSizeSelectionWidget extends RefCounted {
  element = document.createElement('div');
  minVoxelSize = document.createElement('div');
  maxVoxelSize = document.createElement('div');

  constructor(public value: TrackableValue<number>) {
    super();
    let {element, minVoxelSize, maxVoxelSize, createVoxelSizeDropdown} = this;
    element.className = 'minmax-voxel-size-selection';
    minVoxelSize.className = 'voxel-size-selection';
    maxVoxelSize.className = 'voxel-size-selection';
    // const minVoxelSizeDropdown = createVoxelSizeDropdown();
    // const maxVoxelSizeDropdown = createVoxelSizeDropdown();
    // element.appendChild(promptElement);
    // element.appendChild(inputElement);
    // const inputValueChanged = () => {
    //   this.value.value = this.inputElement.valueAsNumber;
    // };
    // this.registerEventListener(inputElement, 'change', inputValueChanged);
    // this.registerEventListener(inputElement, 'input', inputValueChanged);
    // this.registerEventListener(inputElement, 'wheel', (event: WheelEvent) => {
    //   let {deltaY} = event;
    //   if (deltaY > 0) {
    //     this.inputElement.stepUp();
    //     inputValueChanged();
    //   } else if (deltaY < 0) {
    //     this.inputElement.stepDown();
    //     inputValueChanged();
    //   }
    // });
    // value.changed.add(() => {
    //   this.inputElement.valueAsNumber = this.value.value;
    // });
  }

  createVoxelSizeDropdown(): HTMLButtonElement {
    return document.createElement('button');
  }

  disposed() {
    removeFromParent(this.element);
    super.disposed();
  }
}
