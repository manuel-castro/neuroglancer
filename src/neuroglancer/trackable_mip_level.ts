import {TrackableValue} from 'neuroglancer/trackable_value';
import {verifyOptionalNonnegativeInt} from 'neuroglancer/util/json';
import {NullarySignal} from 'neuroglancer/util/signal';
import { RefCounted } from 'neuroglancer/util/disposable';

export abstract class TrackableMIPLevelValue extends TrackableValue<number|undefined> {
  private highestMIPLevel: number|undefined;

  public setHighestMIPLevel(numberOfScales: number) {
    this.highestMIPLevel = numberOfScales;
  }

  // Get validated MIP Level
  public getValue(): number {
    if (!this.highestMIPLevel) {
      throw new Error('Cannot get MIP rendering level before render layer created');
    }
    if (this.value === undefined || this.value > this.highestMIPLevel) {
      return this.getDefaultMIPValue();
    }
    if (this.value < 0) {
      // Should never happen
      throw new Error('Invalid negative MIP level');
    }
    return this.value;
  }

  public getHighestMIPLevel(): number|undefined {
    return this.highestMIPLevel;
  }

  protected abstract getDefaultMIPValue(): number;
}

class TrackableMinMIPLevelValue extends TrackableMIPLevelValue {
  getDefaultMIPValue(): number {
    return 0;
  }
}

class TrackableMaxMIPLevelValue extends TrackableMIPLevelValue {
  getDefaultMIPValue(): number {
    return this.getHighestMIPLevel()! - 1;
  }
}

export function trackableMinMIPLevelValue(initialValue = undefined): TrackableMIPLevelValue {
  return new TrackableMinMIPLevelValue(initialValue, verifyOptionalNonnegativeInt);
}

export function trackableMaxMIPLevelValue(initialValue = undefined): TrackableMIPLevelValue {
  return new TrackableMaxMIPLevelValue(initialValue, verifyOptionalNonnegativeInt);
}

// Temporary hack
export function validateMIPLevelConstraints(
    minMIPLevelRendered: TrackableMIPLevelValue, maxMIPLevelRendered: TrackableMIPLevelValue,
    minLevelWasChanged: boolean): boolean {
  if (minMIPLevelRendered.value && maxMIPLevelRendered.value &&
      minMIPLevelRendered.value > maxMIPLevelRendered.value) {
    // Invalid levels so adjust
    if (minLevelWasChanged) {
      maxMIPLevelRendered.value = minMIPLevelRendered.value;
    } else {
      minMIPLevelRendered.value = maxMIPLevelRendered.value;
    }
    return false;
  }
  return true;
}

// type TrackableMIPLevel = TrackableValue<number|undefined>;

export class TrackableMIPLevelConstraints extends RefCounted {
  minMIPLevel: TrackableValue<number|undefined>;
  maxMIPLevel: TrackableValue<number|undefined>;
  changed = new NullarySignal();

  constructor({initialMinMIPLevel = undefined, initialMaxMIPLevel = undefined}:
                  {initialMinMIPLevel?: number|undefined, initialMaxMIPLevel?: number|undefined}) {
    super();
    TrackableMIPLevelConstraints.verifyValidConstraints(initialMinMIPLevel, initialMaxMIPLevel);
    this.minMIPLevel = new TrackableValue(initialMinMIPLevel, verifyOptionalNonnegativeInt);
    this.maxMIPLevel = new TrackableValue(initialMaxMIPLevel, verifyOptionalNonnegativeInt);
    this.registerDisposer(this.minMIPLevel.changed.add(() => {
      if (this.maybeAdjustConstraints(true)) {
        this.changed.dispatch();
      }
    }));
    this.registerDisposer(this.maxMIPLevel.changed.add(() => {
      if (this.maybeAdjustConstraints(false)) {
        this.changed.dispatch();
      }
    }));
  }

  public restoreState(newMinMIPLevel: number|undefined, newMaxMIPLevel: number|undefined) {
    TrackableMIPLevelConstraints.verifyValidConstraints(newMinMIPLevel, newMaxMIPLevel);
    this.minMIPLevel.restoreState(newMinMIPLevel);
    this.maxMIPLevel.restoreState(newMaxMIPLevel);
  }

  private static verifyValidConstraints(
      minMIPLevelValue: number|undefined, maxMIPLevelValue: number|undefined) {
    if (minMIPLevelValue && maxMIPLevelValue && minMIPLevelValue > maxMIPLevelValue) {
      // Should never happen
      throw new Error('Specified minMIPLevel cannot be greater than specified maxMIPLevel');
    }
  }

  private maybeAdjustConstraints(minLevelWasChanged: boolean): boolean {
    if (this.minMIPLevel.value && this.maxMIPLevel.value &&
        this.minMIPLevel.value > this.maxMIPLevel.value) {
      // Invalid levels so adjust
      if (minLevelWasChanged) {
        this.maxMIPLevel.value = this.minMIPLevel.value;
      }
      else {
        this.minMIPLevel.value = this.maxMIPLevel.value;
      }
      return false;
    }
    return true;
  }
}
