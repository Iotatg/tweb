import bytesToHex from '@helpers/bytes/bytesToHex';
import base64ToBytes from '@helpers/string/base64ToBytes';
import {DcId} from '@types';

export type ParsedSession = {
  dcId: DcId,
  /** 256-byte permanent auth key, hex (512 chars) */
  authKeyHex: string
};

const AUTH_KEY_LENGTH = 256;

// Pyrogram packs the session with struct, in one of three layouts over the
// years (all start with the 1-byte dc id):
//   ">BI?256sQ?"  current: dc, api_id, test_mode, auth_key, user_id, is_bot  (271 bytes)
//   ">B?256sQ?"   old 64:  dc, test_mode, auth_key, user_id, is_bot          (267 bytes)
//   ">B?256sI?"   old 32:  dc, test_mode, auth_key, api_id, is_bot           (263 bytes)
const PYROGRAM_SIZES = [
  {length: 271, keyStart: 6},
  {length: 267, keyStart: 2},
  {length: 263, keyStart: 2}
];

function isValidDcId(dcId: number) {
  return dcId >= 1 && dcId <= 5;
}

/**
 * Reads a Telethon or Pyrogram session string and returns the DC id and the
 * permanent auth key it carries, as hex.
 *
 * Telethon `StringSession`:
 *   base64( version:1 = 0, dcId:1, serverAddress:ascii, port:2, authKey:256 )
 * Pyrogram session string: one of the packed layouts above, urlsafe base64 with
 * the `=` padding stripped (an optional leading `1` version digit is tolerated).
 *
 * The server address and port are read but not used: a browser talks to a DC
 * over the WebSocket transport, not the raw ip:port a desktop client would.
 */
export default function parseSessionString(input: string): ParsedSession {
  const trimmed = input.trim().replace(/\s+/g, '');
  if(!trimmed) {
    throw new Error('Empty session string');
  }

  const candidates: string[] = [];
  // Pyrogram may prefix the base64 with a single format-version digit.
  if(/^[1-9][A-Za-z0-9+/=_-]+$/.test(trimmed)) {
    candidates.push(trimmed.slice(1));
  }
  candidates.push(trimmed);

  for(const candidate of candidates) {
    const parsed = parseBase64Candidate(candidate);
    if(parsed) {
      return parsed;
    }
  }

  throw new Error('Unrecognised session string');
}

function parseBase64Candidate(candidate: string): ParsedSession | undefined {
  // atob is forgiving about padding, but pad anyway so a stripped Pyrogram
  // string decodes the same everywhere.
  const padded = candidate + '='.repeat((4 - candidate.length % 4) % 4);

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(padded);
  } catch{
    return undefined;
  }

  // Pyrogram: the dc id is the first byte, the auth key sits at a fixed offset.
  for(const {length, keyStart} of PYROGRAM_SIZES) {
    if(bytes.length === length) {
      const dcId = bytes[0];
      if(isValidDcId(dcId)) {
        return {
          dcId: dcId as DcId,
          authKeyHex: bytesToHex(bytes.subarray(keyStart, keyStart + AUTH_KEY_LENGTH))
        };
      }
    }
  }

  // Telethon: version (1) = 0, dcId (1), server address (variable), port (2), authKey (256)
  if(bytes.length >= 2 + AUTH_KEY_LENGTH) {
    const dcId = bytes[1];
    if(bytes[0] === 0 && isValidDcId(dcId)) {
      return {
        dcId: dcId as DcId,
        authKeyHex: bytesToHex(bytes.subarray(bytes.length - AUTH_KEY_LENGTH))
      };
    }
  }

  return undefined;
}
