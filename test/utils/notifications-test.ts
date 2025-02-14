/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { MatrixEvent } from "matrix-js-sdk/src/models/event";
import { mocked } from "jest-mock";

import {
    localNotificationsAreSilenced,
    getLocalNotificationAccountDataEventType,
} from "../../src/utils/notifications";
import SettingsStore from "../../src/settings/SettingsStore";
import { getMockClientWithEventEmitter } from "../test-utils/client";

jest.mock("../../src/settings/SettingsStore");

describe('notifications', () => {
    let accountDataStore = {};
    const mockClient = getMockClientWithEventEmitter({
        isGuest: jest.fn().mockReturnValue(false),
        getAccountData: jest.fn().mockImplementation(eventType => accountDataStore[eventType]),
        setAccountData: jest.fn().mockImplementation((eventType, content) => {
            accountDataStore[eventType] = new MatrixEvent({
                type: eventType,
                content,
            });
        }),
    });

    const accountDataEventKey = getLocalNotificationAccountDataEventType(mockClient.deviceId);

    beforeEach(() => {
        accountDataStore = {};
        mocked(SettingsStore).getValue.mockReturnValue(false);
    });

    describe('localNotificationsAreSilenced', () => {
        it('defaults to true when no setting exists', () => {
            expect(localNotificationsAreSilenced(mockClient)).toBeTruthy();
        });
        it('checks the persisted value', () => {
            mockClient.setAccountData(accountDataEventKey, { is_silenced: true });
            expect(localNotificationsAreSilenced(mockClient)).toBeTruthy();

            mockClient.setAccountData(accountDataEventKey, { is_silenced: false });
            expect(localNotificationsAreSilenced(mockClient)).toBeFalsy();
        });
    });
});
