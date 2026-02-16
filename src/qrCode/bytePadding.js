import { encodeLinkToBits } from './linkToBits.js';
import { getVersionCapacityBytes } from './versionCalc.js';

const MODE_BYTE = '0100';
const TERMINATOR = '0000';
const PAD_BYTES = ['11101100', '00010001'];

function toBitString(value, width) {
    if (!Number.isInteger(value) || value < 0) {
        return ''.padStart(width, '0');
    }
    return value.toString(2).padStart(width, '0');
}

function byteCountBitWidth(version) {
    return version >= 1 && version <= 9 ? 8 : version <= 26 ? 16 : 16;
}

export function buildByteModeBitStream(link, version) {
    const capacityBytes = getVersionCapacityBytes(version);
    if (!capacityBytes) {
        return { bitStream: '', codewords: [] };
    }

    const dataBytes = encodeLinkToBits(link);
    const countBits = toBitString(dataBytes.length, byteCountBitWidth(version));
    let bitStream = MODE_BYTE + countBits + dataBytes.join('');

    const capacityBits = capacityBytes * 8;
    const remainingBeforeTerminator = capacityBits - bitStream.length;
    if (remainingBeforeTerminator > 0) {
        const terminatorBits = TERMINATOR.slice(0, Math.min(4, remainingBeforeTerminator));
        bitStream += terminatorBits;
    }

    const remainder = bitStream.length % 8;
    if (remainder !== 0) {
        bitStream += ''.padStart(8 - remainder, '0');
    }

    let padIndex = 0;
    while (bitStream.length + 8 <= capacityBits) {
        bitStream += PAD_BYTES[padIndex % PAD_BYTES.length];
        padIndex += 1;
    }

    const codewords = [];
    for (let i = 0; i < bitStream.length; i += 8) {
        codewords.push(bitStream.slice(i, i + 8));
    }

    return { bitStream, codewords };
}
