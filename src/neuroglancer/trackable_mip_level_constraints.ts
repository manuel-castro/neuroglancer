import {TrackableValue} from 'neuroglancer/trackable_value';
import {RefCounted} from 'neuroglancer/util/disposable';
import {verifyInt, verifyNonnegativeInt, verifyOptionalNonnegativeInt} from 'neuroglancer/util/json';
import {NullarySignal} from 'neuroglancer/util/signal';

export type TrackableMIPLevel = TrackableValue<number|undefined>;

export class TrackableMIPLevelConstraints extends RefCounted {
  minMIPLevel: TrackableMIPLevel;
  maxMIPLevel: TrackableMIPLevel;
  changed = new NullarySignal();
  private numberLevels: number|undefined;

  constructor(
      initialMinMIPLevel: number|undefined = undefined,
      initialMaxMIPLevel: number|undefined = undefined,
      numberLevels: number|undefined = undefined) {
    super();
    this.setNumberLevels(numberLevels);
    this.verifyValidConstraints(initialMinMIPLevel, initialMaxMIPLevel);
    this.minMIPLevel = new TrackableValue(initialMinMIPLevel, verifyOptionalNonnegativeInt);
    this.maxMIPLevel = new TrackableValue(initialMaxMIPLevel, verifyOptionalNonnegativeInt);
    this.registerDisposer(this.minMIPLevel.changed.add(() => {
      this.handleMIPLevelChanged(true);
    }));
    this.registerDisposer(this.maxMIPLevel.changed.add(() => {
      this.handleMIPLevelChanged(false);
    }));
  }

  public restoreState(newMinMIPLevel: number|undefined, newMaxMIPLevel: number|undefined) {
    this.verifyValidConstraints(newMinMIPLevel, newMaxMIPLevel);
    this.minMIPLevel.restoreState(newMinMIPLevel);
    this.maxMIPLevel.restoreState(newMaxMIPLevel);
  }

  private handleMIPLevelChanged(minLevelWasChanged: boolean) {
    verifyInt(this.numberLevels);
    if (this.maybeAdjustConstraints(minLevelWasChanged)) {
      this.verifyValidConstraints(this.minMIPLevel.value, this.maxMIPLevel.value);
      this.changed.dispatch();
    }
  }

  // De facto min MIP level is 0 if not specified
  public getDeFactoMinMIPLevel = () => {
    const {minMIPLevel: {value}, numberLevels} = this;
    verifyNonnegativeInt(numberLevels);
    return (value !== undefined) ? value : 0;
  }

  // De facto max MIP level is numberLevels - 1 if not specified
  public getDeFactoMaxMIPLevel = () => {
    const {maxMIPLevel: {value}, numberLevels} = this;
    verifyNonnegativeInt(numberLevels);
    return (value !== undefined) ? value : numberLevels! - 1;
  }

  // Only set the number of levels once either in constructor or after the renderLayer has been
  // initialized and sources have been retrieved.
  public setNumberLevels(numberLevels: number|undefined) {
    if (this.numberLevels) {
      throw new Error('Cannot set number of MIP Levels more than once.');
    }
    verifyOptionalNonnegativeInt(numberLevels);
    this.numberLevels = numberLevels;
  }

  private verifyValidConstraints(
      minMIPLevelValue: number|undefined, maxMIPLevelValue: number|undefined) {
    if (minMIPLevelValue && maxMIPLevelValue) {
      // Should never happen
      if (minMIPLevelValue > maxMIPLevelValue) {
        throw new Error('Specified minMIPLevel cannot be greater than specified maxMIPLevel');
      }
      if (this.numberLevels && maxMIPLevelValue > this.numberLevels) {
        throw new Error('Specified maxMIPLevel cannot be greater than the number of levels');
      }
    }
  }

  // Ensure that minMIPLevelRendered <= maxMIPLevelRendered when one is adjusted by widget. Return
  // true/false to only kick off changed dispatch once when levels are adjusted.
  private maybeAdjustConstraints(minLevelWasChanged: boolean): boolean {
    if (this.minMIPLevel.value && this.maxMIPLevel.value &&
        this.minMIPLevel.value > this.maxMIPLevel.value) {
      // Invalid levels so adjust
      if (minLevelWasChanged) {
        this.maxMIPLevel.value = this.minMIPLevel.value;
      } else {
        this.minMIPLevel.value = this.maxMIPLevel.value;
      }
      return false;
    }
    return true;
  }
}
