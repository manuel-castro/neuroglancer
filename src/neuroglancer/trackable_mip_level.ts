import {TrackableValue} from 'neuroglancer/trackable_value';
import {verifyOptionalNonnegativeInt} from 'neuroglancer/util/json';

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
export function validateMIPLevelConstraints(minMIPLevelRendered: TrackableMIPLevelValue, maxMIPLevelRendered: TrackableMIPLevelValue, minLevelWasChanged: boolean): boolean {
  if (minMIPLevelRendered.value && maxMIPLevelRendered.value &&
      minMIPLevelRendered.value > maxMIPLevelRendered.value) {
    // Invalid levels so adjust
    if (minLevelWasChanged) {
      maxMIPLevelRendered.value = minMIPLevelRendered.value;
    }
    else {
      minMIPLevelRendered.value = maxMIPLevelRendered.value;
    }
    return false;
  }
  return true;
}
