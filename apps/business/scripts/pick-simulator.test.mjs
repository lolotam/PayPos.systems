import assert from 'node:assert/strict';
import { it } from 'node:test';

import { pickSimulator } from './pick-simulator.mjs';

function iphone(name, udid, isAvailable = true) {
  return { udid, name, isAvailable, state: 'Shutdown' };
}

it('picks an available iPhone from the newest usable iOS runtime', () => {
  const cases = [
    {
      name: 'the newest runtime wins',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [iphone('iPhone 16', 'older')],
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [iphone('iPhone 16', 'newest')],
      },
      expected: 'newest',
    },
    {
      name: '18-10 beats 18-9 numerically',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-9': [iphone('iPhone 16', 'nine')],
        'com.apple.CoreSimulator.SimRuntime.iOS-18-10': [iphone('iPhone 16', 'ten')],
      },
      expected: 'ten',
    },
    {
      name: 'an iPad-only runtime is skipped for an older runtime with an iPhone',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          { udid: 'ipad', name: 'iPad Pro', isAvailable: true, state: 'Shutdown' },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [iphone('iPhone 15', 'older-iphone')],
      },
      expected: 'older-iphone',
    },
    {
      name: 'an unavailable iPhone is skipped',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          iphone('iPhone 16', 'unavailable', false),
          iphone('iPhone 15', 'available'),
        ],
      },
      expected: 'available',
    },
    {
      name: 'a watchOS runtime is ignored',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-5': [
          { udid: 'watch', name: 'Apple Watch', isAvailable: true, state: 'Shutdown' },
        ],
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [iphone('iPhone 16', 'ios')],
      },
      expected: 'ios',
    },
    {
      name: 'no iPhone at all throws NO_IPHONE_SIMULATOR',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          { udid: 'ipad', name: 'iPad Pro', isAvailable: true, state: 'Shutdown' },
          iphone('iPhone 16', 'unavailable', false),
        ],
      },
      error: 'NO_IPHONE_SIMULATOR',
    },
    {
      name: 'two iPhones on one runtime are sorted by name',
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          iphone('iPhone 16', 'sixteen'),
          iphone('iPhone 15', 'fifteen'),
        ],
      },
      expected: 'fifteen',
    },
  ];

  for (const testCase of cases) {
    if (testCase.error !== undefined) {
      assert.throws(() => pickSimulator({ devices: testCase.devices }), {
        message: testCase.error,
      }, testCase.name);
    } else {
      assert.equal(pickSimulator({ devices: testCase.devices }), testCase.expected, testCase.name);
    }
  }
});
