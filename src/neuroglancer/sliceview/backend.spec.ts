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

import {SliceView} from 'neuroglancer/sliceview/backend';
import {vec3} from 'neuroglancer/util/geom';
import {mat4} from 'neuroglancer/util/geom';

fdescribe('sliceview/backend', () => {
    let sliceViewMock: any;
    beforeAll(() => {
        sliceViewMock = jasmine.createSpyObj('sliceViewMock', {
            'voxelSize': vec3.fromValues(4, 4, 40),
            'viewportAxes': [vec3.fromValues(1, 0, 0), vec3.fromValues(0, 1, 0), vec3.fromValues(0, 0, 1)],
            'computeVisibleAndPrefetchChunks': SliceView.prototype.computeVisibleAndPrefetchChunks,
            'computeVisibleChunks': SliceView.prototype.computeVisibleChunks,
            'updateVisibleSources': () => {},
            'viewportToData': mat4.create(),
            'centerDataPosition': vec3.create(),
            'width': 400,
            'height': 200,
            // 'computeChunksFromGlobalCorners': jasmine.createSpy()
        });
    });
    it('correct prefetch chunks requested', () => {
        expect(sliceViewMock.width).toBe(400);
    // expect(
    //     getNearIsotropicBlockSize({voxelSize: vec3.fromValues(1, 1, 1), maxVoxelsPerChunkLog2: 18}))
    //     .toEqual(vec3.fromValues(64, 64, 64));

    // expect(
    //     getNearIsotropicBlockSize({voxelSize: vec3.fromValues(2, 1, 1), maxVoxelsPerChunkLog2: 17}))
    //     .toEqual(vec3.fromValues(32, 64, 64));

    // expect(
    //     getNearIsotropicBlockSize({voxelSize: vec3.fromValues(3, 3, 30), maxVoxelsPerChunkLog2: 9}))
    //     .toEqual(vec3.fromValues(16, 16, 2));

    // expect(getNearIsotropicBlockSize({
    //     voxelSize: vec3.fromValues(3, 3, 30),
    //     upperVoxelBound: vec3.fromValues(1, 128, 128),
    //     maxVoxelsPerChunkLog2: 8
    // })).toEqual(vec3.fromValues(1, 64, 4));
    });
});
