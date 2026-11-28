import isValidDcId from '@lib/mtproto/isValidDcId';
import longFromBytes from '@helpers/long/longFromBytes';

/**
 * A Telegram account session taken out of a string produced by another client,
 * ready to be imported: the DC that holds the account and the raw 256-byte
 * permanent auth key. This client can talk MTProto with the key as it is (the
 * server recognizes the account by it), so a phone number, a login code and a
 * cloud password are all skipped.
 */
export type ParsedSessionString = {
  dcId: number,
  authKey: Uint8Array,
  /** The account the session belongs to, when the format carries it. */
  userId?: string,
  apiId?: number,
  isTest: boolean
};

const AUTH_KEY_LENGTH = 256;

// * the formats are recognized by what the client that wrote them puts before the
// * key: gogram has two textual prefixes, GramJS/Telethon a leading "1", Pyrogram
// * packs the fields and the length tells one layout from another

const GOGRAM_MODERN_PREFIX = '1BvE';
const GOGRAM_LEGACY_PREFIX = '1BvX';
// * gogram separates the legacy fields with this (and an older "::")
const GOGRAM_SEPARATOR = ':_:';
const GOGRAM_LEGACY_SEPARATOR = '::';

function decodeBase64(input: string): Uint8Array {
  let base64 = input.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = base64.length % 4;
  if(remainder === 1) {
    throw new Error('Invalid base64');
  }

  if(remainder) {
    base64 += '='.repeat(4 - remainder);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; ++i) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function readUint64BE(bytes: Uint8Array, offset: number): string {
  // * longFromBytes reads little-endian, so hand it the slice reversed
  return longFromBytes(bytes.slice(offset, offset + 8).reverse());
}

function bytesToString(bytes: Uint8Array): string {
  let result = '';
  for(let i = 0; i < bytes.length; ++i) {
    result += String.fromCharCode(bytes[i]);
  }

  return result;
}

function makeResult(o: ParsedSessionString): ParsedSessionString {
  if(o.authKey.length !== AUTH_KEY_LENGTH) {
    throw new Error('Invalid session: auth key is not 256 bytes');
  }

  if(!isValidDcId(o.dcId, o.isTest)) {
    throw new Error('Invalid session: unknown DC ' + o.dcId);
  }

  return o;
}

function parseGogramModern(input: string): ParsedSessionString {
  const payload = JSON.parse(bytesToString(decodeBase64(input.slice(GOGRAM_MODERN_PREFIX.length))));
  if(!payload || typeof(payload) !== 'object' || typeof(payload.dc_id) !== 'number') {
    throw new Error('Invalid gogram session');
  }

  // * Go marshals a []byte as standard base64
  const authKey = typeof(payload.key) === 'string' ?
    decodeBase64(payload.key) :
    new Uint8Array(payload.key || []);

  return makeResult({
    dcId: payload.dc_id,
    authKey,
    apiId: typeof(payload.app_id) === 'number' ? payload.app_id : undefined,
    isTest: false
  });
}

function parseGogramLegacy(input: string): ParsedSessionString {
  const decoded = decodeBase64(input.slice(GOGRAM_LEGACY_PREFIX.length));
  // * the key is the first 256 bytes, the rest is text: hash, address, DC and app id
  const authKey = decoded.slice(0, AUTH_KEY_LENGTH);
  let rest = bytesToString(decoded.slice(AUTH_KEY_LENGTH));

  const separator = rest.startsWith(GOGRAM_SEPARATOR) ? GOGRAM_SEPARATOR :
    (rest.startsWith(GOGRAM_LEGACY_SEPARATOR) ? GOGRAM_LEGACY_SEPARATOR : undefined);
  if(!separator) {
    throw new Error('Invalid gogram session');
  }

  // * skip the separator and the 8-byte hash, then the separator after it
  rest = rest.slice(separator.length + 8);
  if(!rest.startsWith(separator)) {
    throw new Error('Invalid gogram session');
  }

  rest = rest.slice(separator.length);
  const appStart = rest.lastIndexOf(separator);
  if(appStart < 0) {
    throw new Error('Invalid gogram session');
  }

  const dcStart = rest.lastIndexOf(separator, appStart - 1);
  if(dcStart < 0) {
    throw new Error('Invalid gogram session');
  }

  const dcId = parseInt(rest.slice(dcStart + separator.length, appStart), 10);
  const apiId = parseInt(rest.slice(appStart + separator.length), 10);

  return makeResult({
    dcId,
    authKey,
    apiId: Number.isFinite(apiId) ? apiId : undefined,
    isTest: false
  });
}

/**
 * GramJS and Telethon: a leading "1" and base64 of the DC as one byte, then how
 * the client reaches the DC, and the key at the end.
 */
function parseFirstByteDc(input: string): ParsedSessionString {
  const decoded = decodeBase64(input.slice(1));
  if(decoded.length < 1 + AUTH_KEY_LENGTH) {
    throw new Error('Invalid session string');
  }

  return makeResult({
    dcId: decoded[0],
    authKey: decoded.slice(-AUTH_KEY_LENGTH),
    isTest: false
  });
}

function parsePyrogram(decoded: Uint8Array): ParsedSessionString {
  // * ">BI?256sQ?" (271), ">B?256sQ?" (267), ">B?256sI?" (263)
  switch(decoded.length) {
    case 271: {
      return makeResult({
        dcId: decoded[0],
        apiId: readUint32BE(decoded, 1),
        isTest: !!decoded[5],
        authKey: decoded.slice(6, 6 + AUTH_KEY_LENGTH),
        userId: readUint64BE(decoded, 262)
      });
    }

    case 267: {
      return makeResult({
        dcId: decoded[0],
        isTest: !!decoded[1],
        authKey: decoded.slice(2, 2 + AUTH_KEY_LENGTH),
        userId: readUint64BE(decoded, 258)
      });
    }

    case 263: {
      return makeResult({
        dcId: decoded[0],
        isTest: !!decoded[1],
        authKey: decoded.slice(2, 2 + AUTH_KEY_LENGTH),
        userId: readUint32BE(decoded, 258).toString()
      });
    }
  }

  // * a bare "DC as a 32-bit big-endian integer + key", as some tools write it
  if(decoded.length === 4 + AUTH_KEY_LENGTH) {
    return makeResult({
      dcId: readUint32BE(decoded, 0),
      authKey: decoded.slice(4),
      isTest: false
    });
  }

  if(decoded.length === 1 + AUTH_KEY_LENGTH) {
    return makeResult({
      dcId: decoded[0],
      authKey: decoded.slice(1),
      isTest: false
    });
  }

  throw new Error('Unrecognized session string format');
}

/**
 * Reads a session string written by Pyrogram, GramJS/Telethon or gogram.
 * Throws with a message a user can be shown when it is none of those.
 */
export default function parseSessionString(input: string): ParsedSessionString {
  const session = (input || '').trim();
  if(!session) {
    throw new Error('Empty session string');
  }

  if(session.startsWith(GOGRAM_MODERN_PREFIX)) {
    return parseGogramModern(session);
  }

  if(session.startsWith(GOGRAM_LEGACY_PREFIX)) {
    return parseGogramLegacy(session);
  }

  // * GramJS/Telethon use a printable "1" as a version marker in front of base64;
  // * a Pyrogram string starts with its DC byte, which base64 turns into "A"/"B"
  if(session[0] === '1' && session.length > 2) {
    return parseFirstByteDc(session);
  }

  return parsePyrogram(decodeBase64(session));
}
