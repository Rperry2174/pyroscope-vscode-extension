/**
 * Utilities for parsing pprof protobuf format
 * The pprof format is defined at: https://github.com/google/pprof/blob/main/proto/profile.proto
 */

import * as zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

/**
 * Simple protobuf parser for pprof format
 * This is a minimal implementation to extract the key data we need
 */

export interface PprofProfile {
  sampleType: SampleType[];
  sample: Sample[];
  mapping: Mapping[];
  location: Location[];
  function: Function[];
  stringTable: string[];
  timeNanos: number;
  durationNanos: number;
  periodType?: ValueType;
  period: number;
}

export interface SampleType {
  type: number; // index into string table
  unit: number; // index into string table
}

export interface Sample {
  locationId: number[];
  value: number[];
  label: Label[];
}

export interface Label {
  key: number;
  str: number;
  num: number;
}

export interface Mapping {
  id: number;
  memoryStart: number;
  memoryLimit: number;
  fileOffset: number;
  filename: number; // index into string table
  buildId: number; // index into string table
}

export interface Location {
  id: number;
  mappingId: number;
  address: number;
  line: Line[];
}

export interface Line {
  functionId: number;
  line: number;
}

export interface Function {
  id: number;
  name: number; // index into string table
  systemName: number; // index into string table
  filename: number; // index into string table
  startLine: number;
}

export interface ValueType {
  type: number;
  unit: number;
}

/**
 * Parse a pprof .pb.gz file
 */
export async function parsePprofFile(buffer: Buffer): Promise<PprofProfile> {
  // Check if gzipped
  let data = buffer;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    data = await gunzip(buffer);
  }

  return parseProtobuf(data);
}

/**
 * Simple protobuf parser
 * This is a minimal implementation focused on extracting pprof data
 */
function parseProtobuf(buffer: Buffer): PprofProfile {
  const profile: PprofProfile = {
    sampleType: [],
    sample: [],
    mapping: [],
    location: [],
    function: [],
    stringTable: [],
    timeNanos: 0,
    durationNanos: 0,
    period: 0,
  };

  let offset = 0;

  while (offset < buffer.length) {
    // Safeguard against reading past buffer
    if (offset >= buffer.length) {
      break;
    }

    let fieldNumber: number, wireType: number, newOffset: number;
    try {
      const tag = readTag(buffer, offset);
      fieldNumber = tag.fieldNumber;
      wireType = tag.wireType;
      newOffset = tag.newOffset;
    } catch (e) {
      console.error(`[Pyroscope] Error reading tag at offset ${offset}:`, e);
      break;
    }

    // Validate wire type
    if (wireType < 0 || wireType > 5) {
      console.warn(
        `[Pyroscope] Invalid wire type ${wireType} for field ${fieldNumber} at offset ${offset}, skipping to next field`
      );
      // Try to skip ahead and recover
      offset = newOffset + 1;
      continue;
    }

    offset = newOffset;

    try {
      switch (fieldNumber) {
        case 1: // sample_type
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.sampleType.push(parseSampleType(value));
            offset = newOffset;
          }
          break;

        case 2: // sample
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.sample.push(parseSample(value));
            offset = newOffset;
          }
          break;

        case 3: // mapping
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.mapping.push(parseMapping(value));
            offset = newOffset;
          }
          break;

        case 4: // location
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.location.push(parseLocation(value));
            offset = newOffset;
          }
          break;

        case 5: // function
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.function.push(parseFunction(value));
            offset = newOffset;
          }
          break;

        case 6: // string_table
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            profile.stringTable.push(value.toString('utf-8'));
            offset = newOffset;
          }
          break;

        case 9: // time_nanos
          {
            const { value, newOffset } = readVarint(buffer, offset);
            profile.timeNanos = value;
            offset = newOffset;
          }
          break;

        case 10: // duration_nanos
          {
            const { value, newOffset } = readVarint(buffer, offset);
            profile.durationNanos = value;
            offset = newOffset;
          }
          break;

        case 11: // period_type
          {
            const { value, newOffset } = readLengthDelimited(buffer, offset);
            // Skip for now
            offset = newOffset;
          }
          break;

        case 12: // period
          {
            const { value, newOffset } = readVarint(buffer, offset);
            profile.period = value;
            offset = newOffset;
          }
          break;

        default:
          // Skip unknown fields
          offset = skipField(buffer, offset, wireType);
          break;
      }
    } catch (e) {
      console.error(
        `[Pyroscope] Error parsing field ${fieldNumber} at offset ${offset}:`,
        e
      );
      // Try to skip this field and continue
      try {
        offset = skipField(buffer, offset, wireType);
      } catch (skipError) {
        console.error(`[Pyroscope] Could not skip field, aborting parse`);
        break;
      }
    }
  }

  return profile;
}

// Protobuf parsing helpers

function readTag(
  buffer: Buffer,
  offset: number
): { fieldNumber: number; wireType: number; newOffset: number } {
  const { value, newOffset } = readVarint(buffer, offset);
  return {
    fieldNumber: value >>> 3,
    wireType: value & 0x7,
    newOffset,
  };
}

function readVarint(
  buffer: Buffer,
  offset: number
): { value: number; newOffset: number } {
  let value = 0;
  let shift = 0;
  const maxIterations = 10; // Max 10 bytes for a varint
  let iterations = 0;

  while (offset < buffer.length && iterations < maxIterations) {
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;
    iterations++;
  }

  if (iterations >= maxIterations) {
    throw new Error(`Invalid varint at offset ${offset - iterations}: too many bytes`);
  }

  return { value, newOffset: offset };
}

function readLengthDelimited(
  buffer: Buffer,
  offset: number
): { value: Buffer; newOffset: number } {
  const { value: length, newOffset } = readVarint(buffer, offset);
  return {
    value: buffer.slice(newOffset, newOffset + length),
    newOffset: newOffset + length,
  };
}

function skipField(buffer: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case 0: // Varint
      return readVarint(buffer, offset).newOffset;
    case 1: // 64-bit / Fixed64
      return offset + 8;
    case 2: // Length-delimited
      return readLengthDelimited(buffer, offset).newOffset;
    case 3: // Start group (deprecated, skip to matching end group)
      // For now, just try to skip past it
      console.warn('[Pyroscope] Encountered deprecated wire type 3 (start group), skipping');
      return offset;
    case 4: // End group (deprecated)
      console.warn('[Pyroscope] Encountered deprecated wire type 4 (end group), skipping');
      return offset;
    case 5: // 32-bit / Fixed32
      return offset + 4;
    default:
      // Unknown wire type - try to continue parsing
      console.warn(`[Pyroscope] Unknown wire type: ${wireType} at offset ${offset}, attempting to skip`);
      // Try to read as varint and continue
      try {
        return readVarint(buffer, offset).newOffset;
      } catch (e) {
        // If that fails, skip one byte and hope for the best
        return offset + 1;
      }
  }
}

// Message parsers

function parseSampleType(buffer: Buffer): SampleType {
  const result: SampleType = { type: 0, unit: 0 };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, newOffset: tagOffset } = readTag(buffer, offset);
    const { value, newOffset } = readVarint(buffer, tagOffset);

    if (fieldNumber === 1) {
      result.type = value;
    } else if (fieldNumber === 2) {
      result.unit = value;
    }

    offset = newOffset;
  }

  return result;
}

function parseSample(buffer: Buffer): Sample {
  const result: Sample = { locationId: [], value: [], label: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, wireType, newOffset: tagOffset } = readTag(
      buffer,
      offset
    );

    if (fieldNumber === 1) {
      // location_id (repeated uint64)
      if (wireType === 2) {
        // Packed repeated field
        const { value: packedData, newOffset } = readLengthDelimited(
          buffer,
          tagOffset
        );
        let packedOffset = 0;
        while (packedOffset < packedData.length) {
          const { value, newOffset: newPackedOffset } = readVarint(
            packedData,
            packedOffset
          );
          result.locationId.push(value);
          packedOffset = newPackedOffset;
        }
        offset = newOffset;
      } else {
        // Regular varint
        const { value, newOffset } = readVarint(buffer, tagOffset);
        result.locationId.push(value);
        offset = newOffset;
      }
    } else if (fieldNumber === 2) {
      // value (repeated int64)
      if (wireType === 2) {
        // Packed repeated field
        const { value: packedData, newOffset } = readLengthDelimited(
          buffer,
          tagOffset
        );
        let packedOffset = 0;
        while (packedOffset < packedData.length) {
          const { value, newOffset: newPackedOffset } = readVarint(
            packedData,
            packedOffset
          );
          result.value.push(value);
          packedOffset = newPackedOffset;
        }
        offset = newOffset;
      } else {
        // Regular varint
        const { value, newOffset } = readVarint(buffer, tagOffset);
        result.value.push(value);
        offset = newOffset;
      }
    } else {
      offset = skipField(buffer, tagOffset, wireType);
    }
  }

  return result;
}

function parseMapping(buffer: Buffer): Mapping {
  const result: Mapping = {
    id: 0,
    memoryStart: 0,
    memoryLimit: 0,
    fileOffset: 0,
    filename: 0,
    buildId: 0,
  };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, newOffset: tagOffset } = readTag(buffer, offset);
    const { value, newOffset } = readVarint(buffer, tagOffset);

    switch (fieldNumber) {
      case 1:
        result.id = value;
        break;
      case 2:
        result.memoryStart = value;
        break;
      case 3:
        result.memoryLimit = value;
        break;
      case 4:
        result.fileOffset = value;
        break;
      case 5:
        result.filename = value;
        break;
      case 6:
        result.buildId = value;
        break;
    }

    offset = newOffset;
  }

  return result;
}

function parseLocation(buffer: Buffer): Location {
  const result: Location = { id: 0, mappingId: 0, address: 0, line: [] };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, wireType, newOffset: tagOffset } = readTag(
      buffer,
      offset
    );

    if (fieldNumber === 1) {
      const { value, newOffset } = readVarint(buffer, tagOffset);
      result.id = value;
      offset = newOffset;
    } else if (fieldNumber === 2) {
      const { value, newOffset } = readVarint(buffer, tagOffset);
      result.mappingId = value;
      offset = newOffset;
    } else if (fieldNumber === 3) {
      const { value, newOffset } = readVarint(buffer, tagOffset);
      result.address = value;
      offset = newOffset;
    } else if (fieldNumber === 4) {
      const { value, newOffset } = readLengthDelimited(buffer, tagOffset);
      result.line.push(parseLine(value));
      offset = newOffset;
    } else {
      offset = skipField(buffer, tagOffset, wireType);
    }
  }

  return result;
}

function parseLine(buffer: Buffer): Line {
  const result: Line = { functionId: 0, line: 0 };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, newOffset: tagOffset } = readTag(buffer, offset);
    const { value, newOffset } = readVarint(buffer, tagOffset);

    if (fieldNumber === 1) {
      result.functionId = value;
    } else if (fieldNumber === 2) {
      result.line = value;
    }

    offset = newOffset;
  }

  return result;
}

function parseFunction(buffer: Buffer): Function {
  const result: Function = {
    id: 0,
    name: 0,
    systemName: 0,
    filename: 0,
    startLine: 0,
  };
  let offset = 0;

  while (offset < buffer.length) {
    const { fieldNumber, newOffset: tagOffset } = readTag(buffer, offset);
    const { value, newOffset } = readVarint(buffer, tagOffset);

    switch (fieldNumber) {
      case 1:
        result.id = value;
        break;
      case 2:
        result.name = value;
        break;
      case 3:
        result.systemName = value;
        break;
      case 4:
        result.filename = value;
        break;
      case 5:
        result.startLine = value;
        break;
    }

    offset = newOffset;
  }

  return result;
}
