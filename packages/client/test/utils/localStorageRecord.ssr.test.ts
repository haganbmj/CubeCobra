/**
 * @jest-environment node
 */
// These modules are bundled into the SSR'd build, where there is no window, so importing
// and calling them there has to be a no-op rather than a throw. The module is deliberately
// not imported at the top of the file: a static import is hoisted above the hook that
// removes the globals, so it would load while they still exist and a top-level
// `const store = localStorage` would slip through. It is required inside the test instead,
// so the "importing is safe" half of this is actually exercised.
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

    const load = () => require('utils/localStorage/record') as typeof import('utils/localStorage/record');

    expect(load).not.toThrow();

    const { readRecord, removeRecord, writeRecord } = load();

    expect(() => readRecord('cc:draft:a')).not.toThrow();
    expect(readRecord('cc:draft:a')).toBeNull();
    expect(() => writeRecord('cc:draft:a', { picks: [1] })).not.toThrow();
    expect(() => removeRecord('cc:draft:a')).not.toThrow();
  });
});
