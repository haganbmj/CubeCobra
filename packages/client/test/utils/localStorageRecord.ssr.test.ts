/**
 * @jest-environment node
 */
import { readRecord, removeRecord, writeRecord } from 'utils/localStorage/record';

// These modules are bundled into the SSR'd build, where there is no localStorage, so
// importing and calling them there has to be a no-op rather than a throw.
describe('localStorage record layer without a window', () => {
  // Recent Node versions define a localStorage global of their own, so the browserless
  // environment this module has to survive is recreated by removing it.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  beforeAll(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  afterAll(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('does not throw when there is no window', () => {
    expect(typeof globalThis.window).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');

    expect(() => readRecord('cc:draft:a')).not.toThrow();
    expect(readRecord('cc:draft:a')).toBeNull();
    expect(() => writeRecord('cc:draft:a', { picks: [1] })).not.toThrow();
    expect(() => removeRecord('cc:draft:a')).not.toThrow();
  });
});
