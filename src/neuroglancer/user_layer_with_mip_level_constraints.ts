import {UserLayer} from 'neuroglancer/layer';
import {trackableMinMIPLevelValue, trackableMaxMIPLevelValue, TrackableMIPLevelValue} from 'neuroglancer/trackable_mip_level';
import {UserLayerWithVolumeSource, UserLayerWithVolumeSourceMixin} from 'neuroglancer/user_layer_with_volume_source';
import {RenderLayer as GenericSliceViewRenderLayer} from 'neuroglancer/sliceview/renderlayer.ts';
import {vec3} from 'neuroglancer/util/geom';

const MIN_MIP_LEVEL_RENDERED_JSON_KEY = 'minMIPLevelRendered';
const MAX_MIP_LEVEL_RENDERED_JSON_KEY = 'maxMIPLevelRendered';

// Only called by UserLayerWithMIPLevelRestrictionsMixin in this file.
function helper<TBase extends {new (...args: any[]): UserLayerWithVolumeSource}>(Base: TBase) {
  class C extends Base implements UserLayerWithMIPLevelConstraints {
    minMIPLevelRendered = trackableMinMIPLevelValue();
    maxMIPLevelRendered = trackableMaxMIPLevelValue();
    voxelSizePerMIPLevel: vec3[];

    constructor(...args: any[]) {
      super(...args);
      this.registerDisposer(this.minMIPLevelRendered.changed.add(() => {
        this.validateMIPLevelConstraints(true);
      }));
      this.registerDisposer(this.maxMIPLevelRendered.changed.add(() => {
        this.validateMIPLevelConstraints(false);
      }));
    }

    restoreState(specification: any) {
      super.restoreState(specification);
      this.minMIPLevelRendered.restoreState(specification[MIN_MIP_LEVEL_RENDERED_JSON_KEY]);
      this.maxMIPLevelRendered.restoreState(specification[MAX_MIP_LEVEL_RENDERED_JSON_KEY]);
      if (this.minMIPLevelRendered && this.maxMIPLevelRendered &&
          this.minMIPLevelRendered > this.maxMIPLevelRendered) {
        // Should never happen
        throw new Error('Specified minMIPLevel cannot be greater than specified maxMIPLevel');
      }
    }

    toJSON(): any {
      const result = super.toJSON();
      result[MIN_MIP_LEVEL_RENDERED_JSON_KEY] = this.minMIPLevelRendered;
      result[MAX_MIP_LEVEL_RENDERED_JSON_KEY] = this.maxMIPLevelRendered;
      return result;
    }

    protected setVoxelSizePerMIPLevel(renderlayer: GenericSliceViewRenderLayer) {
      if (!this.voxelSizePerMIPLevel) {
        this.voxelSizePerMIPLevel = [];
      }
      renderlayer.transformedSources.forEach(transformedSource => {
        this.voxelSizePerMIPLevel.push(transformedSource[0].source.spec.voxelSize);
      });
      this.minMIPLevelRendered.setHighestMIPLevel(renderlayer.transformedSources.length);
      this.maxMIPLevelRendered.setHighestMIPLevel(renderlayer.transformedSources.length);
    }

    // Ensure that minMIPLevelRendered <= maxMIPLevelRendered
    private validateMIPLevelConstraints(minLevelWasChanged: boolean) {
      if (this.minMIPLevelRendered.value && this.maxMIPLevelRendered.value &&
          this.minMIPLevelRendered.value > this.maxMIPLevelRendered.value) {
        // Invalid levels so adjust
        if (minLevelWasChanged) {
          this.maxMIPLevelRendered.value = this.minMIPLevelRendered.value;
        }
        else {
          this.minMIPLevelRendered.value = this.maxMIPLevelRendered.value;
        }
      }
    }
  }
  return C;
}

export interface UserLayerWithMIPLevelConstraints extends UserLayerWithVolumeSource {
  minMIPLevelRendered: TrackableMIPLevelValue;
  maxMIPLevelRendered: TrackableMIPLevelValue;
}

/**
 * Mixin that adds `minMIPLevelRendered` and `maxMIPLevelRendered` properties to a user layer
 * (along with the properties added by calling UserLayerWithVolumeSourceMixin)
 */
export function
UserLayerWithMIPLevelConstraintsMixin<TBase extends {new (...args: any[]): UserLayer}>(
    Base: TBase) {
  return helper(UserLayerWithVolumeSourceMixin(Base));
}
