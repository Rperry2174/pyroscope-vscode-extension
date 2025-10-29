"use strict";
/**
 * Generate a mock pprof profile for testing
 * Run with: npx ts-node test-data/generateMockProfile.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const zlib = __importStar(require("zlib"));
const path = __importStar(require("path"));
// Simple protobuf encoding helpers
function encodeVarint(value) {
    const bytes = [];
    while (value > 0x7f) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
}
function encodeTag(fieldNumber, wireType) {
    return encodeVarint((fieldNumber << 3) | wireType);
}
function encodeLengthDelimited(fieldNumber, data) {
    const tag = encodeTag(fieldNumber, 2); // wireType 2 = length-delimited
    const length = encodeVarint(data.length);
    return Buffer.concat([tag, length, data]);
}
function encodeString(fieldNumber, str) {
    return encodeLengthDelimited(fieldNumber, Buffer.from(str, 'utf-8'));
}
function encodeUint64(fieldNumber, value) {
    const tag = encodeTag(fieldNumber, 0); // wireType 0 = varint
    const val = encodeVarint(value);
    return Buffer.concat([tag, val]);
}
/**
 * Create a mock pprof profile
 */
function createMockProfile() {
    const parts = [];
    // String table (field 6)
    const strings = [
        '', // 0 = empty string (required)
        'samples', // 1
        'count', // 2
        'cpu', // 3
        'nanoseconds', // 4
        'processOrder', // 5
        'validateInput', // 6
        'calculateTotal', // 7
        'fetchData', // 8
        'parseJSON', // 9
        'writeLog', // 10
        'formatOutput', // 11
        'cleanup', // 12
        '/path/to/sample.go', // 13
    ];
    strings.forEach((str) => {
        parts.push(encodeString(6, str));
    });
    // Sample type (field 1)
    const sampleType = Buffer.concat([
        encodeUint64(1, 1), // type = "samples"
        encodeUint64(2, 2), // unit = "count"
    ]);
    parts.push(encodeLengthDelimited(1, sampleType));
    // Time nanos (field 9)
    const timeNanos = Date.now() * 1000000;
    parts.push(encodeUint64(9, timeNanos));
    // Duration nanos (field 10) - 10 seconds
    parts.push(encodeUint64(10, 10 * 1e9));
    // Period (field 12)
    parts.push(encodeUint64(12, 10000000)); // 10ms = 100Hz
    // Functions (field 5)
    const functions = [
        { id: 1, name: 5, filename: 13, line: 45 }, // processOrder
        { id: 2, name: 6, filename: 13, line: 67 }, // validateInput
        { id: 3, name: 7, filename: 13, line: 89 }, // calculateTotal
        { id: 4, name: 8, filename: 13, line: 123 }, // fetchData
        { id: 5, name: 9, filename: 13, line: 156 }, // parseJSON
        { id: 6, name: 10, filename: 13, line: 178 }, // writeLog
        { id: 7, name: 11, filename: 13, line: 201 }, // formatOutput
        { id: 8, name: 12, filename: 13, line: 234 }, // cleanup
    ];
    functions.forEach((func) => {
        const funcData = Buffer.concat([
            encodeUint64(1, func.id),
            encodeUint64(2, func.name),
            encodeUint64(4, func.filename),
            encodeUint64(5, func.line),
        ]);
        parts.push(encodeLengthDelimited(5, funcData));
    });
    // Locations (field 4)
    functions.forEach((func, index) => {
        const line = Buffer.concat([
            encodeUint64(1, func.id), // function_id
            encodeUint64(2, func.line), // line
        ]);
        const location = Buffer.concat([
            encodeUint64(1, index + 1), // location id
            encodeUint64(3, 0), // address
            encodeLengthDelimited(4, line),
        ]);
        parts.push(encodeLengthDelimited(4, location));
    });
    // Samples (field 2) - simulate realistic distribution
    const sampleData = [
        { locationId: 1, count: 3450 }, // processOrder: 34.5%
        { locationId: 2, count: 1230 }, // validateInput: 12.3%
        { locationId: 3, count: 1870 }, // calculateTotal: 18.7%
        { locationId: 4, count: 980 }, // fetchData: 9.8%
        { locationId: 5, count: 710 }, // parseJSON: 7.1%
        { locationId: 6, count: 450 }, // writeLog: 4.5%
        { locationId: 7, count: 320 }, // formatOutput: 3.2%
        { locationId: 8, count: 150 }, // cleanup: 1.5%
    ];
    sampleData.forEach((sample) => {
        const sampleMsg = Buffer.concat([
            encodeUint64(1, sample.locationId), // location_id
            encodeUint64(2, sample.count), // value (sample count)
        ]);
        parts.push(encodeLengthDelimited(2, sampleMsg));
    });
    return Buffer.concat(parts);
}
/**
 * Main function
 */
async function main() {
    console.log('Generating mock pprof profile...');
    const profile = createMockProfile();
    // Gzip the profile
    const gzipped = zlib.gzipSync(profile);
    // Write to file
    const outputPath = path.join(__dirname, 'sample-profile.pb.gz');
    fs.writeFileSync(outputPath, gzipped);
    console.log(`✓ Created ${outputPath}`);
    console.log(`  Size: ${gzipped.length} bytes`);
    console.log(`\nYou can now load this profile in the extension!`);
}
main().catch(console.error);
//# sourceMappingURL=generateMockProfile.js.map