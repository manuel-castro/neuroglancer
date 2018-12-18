/**
 * @file Convenience interface for creating TrackableValue instances designed to represent MIP
 * level values.
 */

import {TrackableValue} from 'neuroglancer/trackable_value';
import {verifyOptionalNonnegativeInt} from 'neuroglancer/util/json';

export type TrackableMIPLevelValue = TrackableValue<number|undefined>;

export function trackableMIPLevelValue(initialValue = undefined) {
  return new TrackableValue<number|undefined>(initialValue, verifyOptionalNonnegativeInt);
}
