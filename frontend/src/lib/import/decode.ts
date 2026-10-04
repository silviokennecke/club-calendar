/**
 * Text decoding of an ICS file (pure). RFC 5545 requires UTF-8, but older Windows tools still write
 * windows-1252. The bytes are read strictly as UTF-8 first; if that fails (invalid sequences), the file
 * is read as windows-1252 and the caller shows a notice in the review. A BOM never ends up in the text.
 */
export type IcsEncoding = "utf-8" | "utf-16" | "windows-1252";

export interface DecodedIcs {
  text: string;
  encoding: IcsEncoding;
}

export function decodeIcsBytes(bytes: Uint8Array): DecodedIcs {
  // UTF-16 with a byte order mark (Outlook "Unicode" exports).
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16" };
  }
  try {
    // `fatal` throws on invalid UTF-8; the default `ignoreBOM: false` drops a UTF-8 BOM.
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
