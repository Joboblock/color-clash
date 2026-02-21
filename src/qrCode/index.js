// ES Module: qrCode
// Public QR code builder interface for the rest of the app.
import { smallestVersionForLink } from './versionCalc.js';
import { buildFixedPattern } from './patternBuilder.js';
import { buildByteModeBitStream } from './bytePadding.js';
import { buildInterleavedCodewords } from './reedSolomonECC.js';
import { placeDataBits, fillNullModules } from './dataPlacement.js';
import { applyMaskPattern } from './maskPatterns.js';

/**
 * Build a QR code matrix for the provided link.
 * For now only supports eccLevel 'L' and maskId 2.
 * @param {string} link
 * @param {{ eccLevel?: 'L'|'M'|'Q'|'H', maskId?: number }} [options]
 * @returns {boolean[][]} Final QR module matrix.
 */
export function buildQrCodeMatrix(link, options = {}) {
    const safeLink = typeof link === 'string' ? link.trim() : '';
    if (!safeLink) return [];

    const eccLevel = options?.eccLevel ?? 'L';
    const maskId = Number.isInteger(options?.maskId) ? options.maskId : 2;
    const version = smallestVersionForLink(safeLink);

    const pattern = buildFixedPattern({ version, eccLevel, maskId });
    const reservedGrid = pattern.map((row) => row.slice());
    const { codewords } = buildByteModeBitStream(safeLink, version);
    const { interleavedBits } = buildInterleavedCodewords({
        dataCodewords: codewords,
        version,
        eccLevel
    });

    placeDataBits(pattern, interleavedBits);
    fillNullModules(pattern, false);
    applyMaskPattern(pattern, reservedGrid, maskId);
    return pattern;
}

export default buildQrCodeMatrix;
