import { encodeLinkToBits } from './linkToBits.js';

const QR_BYTE_CAPACITY_L = [
    null,
    19,
    34,
    55,
    80,
    108,
    136,
    156,
    194,
    232,
    274,
    324,
    370,
    428,
    461,
    523,
    589,
    647,
    721,
    795,
    861,
    932,
    1006,
    1094,
    1174,
    1276,
    1370,
    1468,
    1531,
    1631,
    1735,
    1843,
    1955,
    2071,
    2191,
    2306,
    2434,
    2566,
    2702,
    2812,
    2956
];

export function smallestVersionForByteLength(byteLength) {
    if (!Number.isFinite(byteLength) || byteLength < 0) {
        return null;
    }

    for (let version = 1; version < QR_BYTE_CAPACITY_L.length; version++) {
        if (byteLength <= QR_BYTE_CAPACITY_L[version]) {
            return version;
        }
    }

    return null;
}

export function getVersionCapacityBytes(version) {
    if (!Number.isInteger(version) || version <= 0 || version >= QR_BYTE_CAPACITY_L.length) {
        return null;
    }
    return QR_BYTE_CAPACITY_L[version] ?? null;
}

function byteCountBitWidth(version) {
    return version >= 1 && version <= 9 ? 8 : version <= 26 ? 16 : 16;
}

export function smallestVersionForLink(link) {
    const bytes = encodeLinkToBits(link);
    const byteLength = bytes.length;
    if (!Number.isFinite(byteLength)) return null;

    for (let version = 1; version < QR_BYTE_CAPACITY_L.length; version++) {
        const capacityBytes = QR_BYTE_CAPACITY_L[version];
        if (!capacityBytes) continue;
        const capacityBits = capacityBytes * 8;
        const headerBits = 4 + byteCountBitWidth(version);
        const totalBits = headerBits + byteLength * 8;
        if (totalBits <= capacityBits) {
            return version;
        }
    }

    return null;
}
