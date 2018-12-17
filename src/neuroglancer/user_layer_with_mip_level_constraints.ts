import {UserLayer} from 'neuroglancer/layer';
import {UserLayerWithVolumeSource, UserLayerWithVolumeSourceMixin} from 'neuroglancer/user_layer_with_volume_source';
import {verifyObjectProperty, verifyOptionalPositiveInt} from 'neuroglancer/util/json';
//import {vec3} from 'neuroglancer/util/geom';

const MIN_MIP_LEVEL_RENDERED_JSON_KEY = 'minMIPLevelRendered';
const MAX_MIP_LEVEL_RENDERED_JSON_KEY = 'maxMIPLevelRendered';

// Only called by UserLayerWithMIPLevelRestrictionsMixin in this file.
function helper<TBase extends {new (...args: any[]): UserLayerWithVolumeSource}>(Base: TBase) {
  class C extends Base implements UserLayerWithMIPLevelConstraints {
    minMIPLevelRendered: number|undefined;
    maxMIPLevelRendered: number|undefined;
    //resolutions: vec3[];

    restoreState(specification: any) {
      super.restoreState(specification);
      const minMIPLevelRendered = verifyObjectProperty(
          specification, MIN_MIP_LEVEL_RENDERED_JSON_KEY, verifyOptionalPositiveInt);
      const maxMIPLevelRendered = verifyObjectProperty(
          specification, MAX_MIP_LEVEL_RENDERED_JSON_KEY, verifyOptionalPositiveInt);
      if (minMIPLevelRendered && maxMIPLevelRendered && minMIPLevelRendered > maxMIPLevelRendered) {
        // Should not happen. In the UI the specified levels should change automatically to ensure
        // this.
        throw new Error('Specified minMIPLevel cannot be greater than specified maxMIPLevel');
      }
      this.minMIPLevelRendered = minMIPLevelRendered;
      this.maxMIPLevelRendered = maxMIPLevelRendered;
    }

    toJSON(): any {
      const result = super.toJSON();
      result[MIN_MIP_LEVEL_RENDERED_JSON_KEY] = this.minMIPLevelRendered;
      result[MAX_MIP_LEVEL_RENDERED_JSON_KEY] = this.maxMIPLevelRendered;
      return result;
    }
  }
  return C;
}

export interface UserLayerWithMIPLevelConstraints extends UserLayerWithVolumeSource {
  minMIPLevelRendered: number|undefined;
  maxMIPLevelRendered: number|undefined;
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
