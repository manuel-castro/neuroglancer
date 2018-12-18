import {TrackableMIPLevelValue} from 'neuroglancer/trackable_mip_level';
import {RefCounted} from 'neuroglancer/util/disposable';
import {removeFromParent} from 'neuroglancer/util/dom';
import {vec3} from 'neuroglancer/util/geom';

export class VoxelSizeSelectionWidget extends RefCounted {
  element = document.createElement('div');
  minVoxelSizeElement = document.createElement('div');
  maxVoxelSizeElement = document.createElement('div');

  constructor(
      minMIPLevelRendered: TrackableMIPLevelValue, maxMIPLevelRendered: TrackableMIPLevelValue,
      voxelSizePerMIPLevel: vec3[]) {
    super();
    const {
      element,
      minVoxelSizeElement,
      maxVoxelSizeElement,
      createVoxelSizeDropdown,
      createVoxelDropdownOptions
    } = this;
    element.className = 'minmax-voxel-size-selection';
    minVoxelSizeElement.className = 'voxel-size-selection';
    maxVoxelSizeElement.className = 'voxel-size-selection';
    const voxelDropdownOptions = createVoxelDropdownOptions(voxelSizePerMIPLevel);
    const minVoxelSizeDropdown = createVoxelSizeDropdown(voxelDropdownOptions, minMIPLevelRendered);
    const maxVoxelSizeDropdown = createVoxelSizeDropdown(voxelDropdownOptions, maxMIPLevelRendered);
    // TO DO: Add labels
    minVoxelSizeElement.appendChild(minVoxelSizeDropdown);
    maxVoxelSizeElement.appendChild(maxVoxelSizeDropdown);
    element.appendChild(minVoxelSizeElement);
    element.appendChild(maxVoxelSizeElement);
    this.registerDisposer(minMIPLevelRendered.changed.add(() => {
      VoxelSizeSelectionWidget.setDropdownIndex(
          minVoxelSizeDropdown, minMIPLevelRendered.getValue());
    }));
    this.registerDisposer(maxMIPLevelRendered.changed.add(() => {
      VoxelSizeSelectionWidget.setDropdownIndex(
          maxVoxelSizeDropdown, maxMIPLevelRendered.getValue());
    }));
  }

  private createVoxelDropdownOptions(voxelSizePerMIPLevel: vec3[]) {
    const voxelDropdownOptions: string[] = [];
    voxelSizePerMIPLevel.forEach(voxelSize => {
      let i: number;
      let voxelString = '';
      for (i = 0; i < 3; i++) {
        if (i > 0) {
          voxelString += ' x ';
        }
        voxelString += voxelSize[i];
      }
      voxelDropdownOptions.push(voxelString);
    });
    return voxelDropdownOptions;
  }

  private createVoxelSizeDropdown(
      voxelDropdownOptions: string[],
      mipLevelTrackableValue: TrackableMIPLevelValue): HTMLSelectElement {
    const voxelSizeDropdown = document.createElement('select');
    const selectedIndex = mipLevelTrackableValue.getValue();
    voxelDropdownOptions.forEach((voxelSizeString, index) => {
      if (index === selectedIndex) {
        voxelSizeDropdown.add(new Option(voxelSizeString, index.toString(), false, true));
      } else {
        voxelSizeDropdown.add(new Option(voxelSizeString, index.toString(), false, false));
      }
    });
    voxelSizeDropdown.addEventListener('change', () => {
      if (mipLevelTrackableValue.value !== voxelSizeDropdown.selectedIndex) {
        mipLevelTrackableValue.value = voxelSizeDropdown.selectedIndex;
      }
    });
    return voxelSizeDropdown;
  }

  private static setDropdownIndex(dropdown: HTMLSelectElement, newIndex: number) {
    if (dropdown.selectedIndex !== newIndex) {
      dropdown.selectedIndex = newIndex;
    }
  }

  disposed() {
    removeFromParent(this.element);
    super.disposed();
  }
}
