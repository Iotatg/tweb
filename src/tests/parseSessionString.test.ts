import parseSessionString from '@lib/accounts/parseSessionString';

const AUTH_KEY_LENGTH = 256;

function makeKey(fill: number) {
  const bytes = new Uint8Array(AUTH_KEY_LENGTH);
  for(let i = 0; i < AUTH_KEY_LENGTH; ++i) {
    bytes[i] = (fill + i) & 0xff;
  }

  return bytes;
}

function concat(parts: Array<number[] | Uint8Array>) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for(const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for(let i = 0; i < bytes.length; ++i) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function u32be(value: number) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u64be(high: number, low: number) {
  return [...u32be(high), ...u32be(low)];
}

function expectKey(actual: Uint8Array, expected: Uint8Array) {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

describe('parseSessionString', () => {
  it('reads the modern Pyrogram layout (271 bytes)', () => {
    const authKey = makeKey(1);
    const session = toBase64(concat([
      [2],
      u32be(123456),
      [1],
      authKey,
      u64be(0, 777000),
      [0]
    ]));

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(2);
    expect(parsed.apiId).toBe(123456);
    expect(parsed.isTest).toBe(true);
    expect(parsed.userId).toBe('777000');
    expectKey(parsed.authKey, authKey);
  });

  it('reads the Pyrogram layout without api_id (267 bytes)', () => {
    const authKey = makeKey(7);
    const session = toBase64(concat([
      [2],
      [0],
      authKey,
      u64be(0, 42),
      [1]
    ]));

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(2);
    expect(parsed.isTest).toBe(false);
    expect(parsed.userId).toBe('42');
    expectKey(parsed.authKey, authKey);
  });

  it('reads the 64-bit Pyrogram layout (263 bytes)', () => {
    const authKey = makeKey(9);
    const session = toBase64(concat([
      [3],
      [0],
      authKey,
      u32be(42),
      [0]
    ]));

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(3);
    expect(parsed.userId).toBe('42');
    expectKey(parsed.authKey, authKey);
  });

  it('reads a GramJS / Telethon string, the key at the end', () => {
    const authKey = makeKey(3);
    const session = '1' + toBase64(concat([
      [2],
      [10, 20, 30, 40],
      authKey
    ]));

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(2);
    expectKey(parsed.authKey, authKey);
  });

  it('reads a modern gogram string, a JSON payload', () => {
    const authKey = makeKey(5);
    const payload = JSON.stringify({
      key: toBase64(authKey),
      hash: 'deadbeef',
      dc_id: 5,
      ip_addr: '1.2.3.4',
      app_id: 2040
    });
    const session = '1BvE' + toBase64(new TextEncoder().encode(payload));

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(5);
    expect(parsed.apiId).toBe(2040);
    expect(parsed.isTest).toBe(false);
    expectKey(parsed.authKey, authKey);
  });

  it('reads a legacy gogram string, the fields separated by ":_:"', () => {
    const authKey = makeKey(2);
    const separator = ':_:';
    const tail = separator + 'HASHHASH' +
      separator + '1.2.3.4' +
      separator + '5' +
      separator + '2040';
    const decoded = concat([
      authKey,
      new TextEncoder().encode(tail)
    ]);
    const session = '1BvX' + toBase64(decoded);

    const parsed = parseSessionString(session);

    expect(parsed.dcId).toBe(5);
    expect(parsed.apiId).toBe(2040);
    expectKey(parsed.authKey, authKey);
  });

  it('rejects an empty or unrecognizable string', () => {
    expect(() => parseSessionString('')).toThrow();
    expect(() => parseSessionString('not a session')).toThrow();
  });

  it('rejects a key that is not 256 bytes', () => {
    const session = toBase64(concat([
      [2],
      [0],
      new Uint8Array(AUTH_KEY_LENGTH - 1),
      u64be(0, 1),
      [0]
    ]));

    expect(() => parseSessionString(session)).toThrow();
  });

  it('rejects an unknown DC', () => {
    const session = toBase64(concat([
      [9],
      [0],
      makeKey(0),
      u64be(0, 1),
      [0]
    ]));

    expect(() => parseSessionString(session)).toThrow();
  });
});
