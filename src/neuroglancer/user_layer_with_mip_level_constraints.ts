import {UserLayer} from 'neuroglancer/layer';
// import {trackableMinMIPLevelValue, trackableMaxMIPLevelValue, TrackableMIPLevelValue} from 'neuroglancer/trackable_mip_level_constraints';
import {TrackableMIPLevelConstraints} from 'neuroglancer/trackable_mip_level_constraints';
import {UserLayerWithVolumeSource, UserLayerWithVolumeSourceMixin} from 'neuroglancer/user_layer_with_volume_source';
import {RenderLayer as GenericSliceViewRenderLayer} from 'neuroglancer/sliceview/renderlayer.ts';
import {vec3} from 'neuroglancer/util/geom';

const MIN_MIP_LEVEL_JSON_KEY = 'minMIPLevel';
const MAX_MIP_LEVEL_JSON_KEY = 'maxMIPLevel';

function helper<TBase extends {new (...args: any[]): UserLayerWithVolumeSource}>(Base: TBase) {
  class C extends Base implements UserLayerWithMIPLevelConstraints {
    mipLevelConstraints = new TrackableMIPLevelConstraints();
    voxelSizePerMIPLevel: vec3[];

    restoreState(specification: any) {
      super.restoreState(specification);
      this.mipLevelConstraints.restoreState(specification[MIN_MIP_LEVEL_JSON_KEY], specification[MAX_MIP_LEVEL_JSON_KEY]);
    }

    toJSON(): any {
      const result = super.toJSON();
      result[MIN_MIP_LEVEL_JSON_KEY] = this.mipLevelConstraints.minMIPLevel.value;
      result[MAX_MIP_LEVEL_JSON_KEY] = this.mipLevelConstraints.maxMIPLevel.value;
      return result;
    }

    protected setVoxelSizePerMIPLevel(renderlayer: GenericSliceViewRenderLayer) {
      if (!this.voxelSizePerMIPLevel) {
        this.voxelSizePerMIPLevel = [];
      }
      renderlayer.transformedSources.forEach(transformedSource => {
        this.voxelSizePerMIPLevel.push(transformedSource[0].source.spec.voxelSize);
      });
    }
  }
  return C;
}
export interface UserLayerWithMIPLevelConstraints extends UserLayerWithVolumeSource {
  mipLevelConstraints: TrackableMIPLevelConstraints;
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
