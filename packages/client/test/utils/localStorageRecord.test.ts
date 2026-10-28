import { readRecord, RECORD_VERSION, removeRecord, writeRecord } from 'utils/localStorage/record';

describe('localStorage record layer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('round-trips a value with a version and a timestamp', () => {
    writeRecord('cc:draft:a', { picks: [1] });

    const record = readRecord<{ picks: number[] }>('cc:draft:a');

    expect(record).toEqual({ v: RECORD_VERSION, t: expect.any(Number), data: { picks: [1] } });
  });

  it('returns null for a key that was never written', () => {
    expect(readRecord('cc:draft:missing')).toBeNull();
  });

  it('returns null for unparseable json', () => {
    // The parse failure is logged, which would otherwise print to the test output.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('cc:draft:a', 'not json');

    expect(readRecord('cc:draft:a')).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('returns null for a record with no version', () => {
    localStorage.setItem('cc:draft:a', '{"t":1,"data":{}}');

    expect(readRecord('cc:draft:a')).toBeNull();
  });

  it('returns null for a record from a future version', () => {
    localStorage.setItem('cc:draft:a', JSON.stringify({ v: 99, t: Date.now(), data: { picks: [1] } }));

    expect(readRecord('cc:draft:a')).toBeNull();
  });

  it('removes a record', () => {
    writeRecord('cc:draft:a', { picks: [1] });

    removeRecord('cc:draft:a');

    expect(readRecord('cc:draft:a')).toBeNull();
    expect(localStorage.getItem('cc:draft:a')).toBeNull();
  });

  it('swallows a storage write failure', () => {
    // The catch path logs, which would otherwise print to the test output.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => writeRecord('cc:draft:a', { picks: [1] })).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });
});
