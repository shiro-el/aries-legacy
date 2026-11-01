jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: null },
}));

import {
  developerOptionsAvailableFor,
  distributionChannelFromExtra,
} from '../src/services/distribution';

test('requires an explicit recognized channel', () => {
  expect(distributionChannelFromExtra(undefined)).toBeNull();
  expect(distributionChannelFromExtra({ distributionChannel: 'android' })).toBeNull();
  expect(distributionChannelFromExtra({ distributionChannel: 'github' })).toBe('github');
  expect(distributionChannelFromExtra({ distributionChannel: 'google-play' }))
    .toBe('google-play');
});

test.each(['app-store', 'google-play'] as const)(
  'hides developer options in %s builds', channel => {
    expect(developerOptionsAvailableFor(channel)).toBe(false);
  },
);

test.each([null, 'github'] as const)(
  'keeps developer options in %s builds', channel => {
    expect(developerOptionsAvailableFor(channel)).toBe(true);
  },
);
