const GF256_PRIMITIVE = 0x11d;
const ECC_LEN_V4_L = 20;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) {
            x ^= GF256_PRIMITIVE;
        }
    }
    for (let i = 255; i < 512; i++) {
        GF_EXP[i] = GF_EXP[i - 255];
    }
})();

function bitStringToHex(bitString) {
    const value = parseInt(bitString, 2);
    return Number.isNaN(value) ? '00' : value.toString(16).padStart(2, '0').toUpperCase();
}

function hexToBitString(hex) {
    const value = parseInt(hex, 16);
    return Number.isNaN(value) ? '00000000' : value.toString(2).padStart(8, '0');
}

function gfMul(a, b) {
    if (a === 0 || b === 0) {
        return 0;
    }
    const logSum = GF_LOG[a] + GF_LOG[b];
    return GF_EXP[logSum];
}

function generatorDivisor(eccLength) {
    const result = new Array(eccLength).fill(0);
    result[eccLength - 1] = 1;
    let root = 1;

    for (let i = 0; i < eccLength; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMul(result[j], root);
            if (j + 1 < result.length) {
                result[j] ^= result[j + 1];
            }
        }
        root = gfMul(root, 0x02);
    }

    return result;
}

function computeEccCodewords(dataBytes, eccLength) {
    const divisor = generatorDivisor(eccLength);
    const result = new Array(eccLength).fill(0);

    for (const byte of dataBytes) {
        const factor = byte ^ result[0];
        result.shift();
        result.push(0);
        for (let i = 0; i < result.length; i++) {
            result[i] ^= gfMul(divisor[i], factor);
        }
    }

    return result;
}

export function buildInterleavedCodewords({
    dataCodewords,
    version,
    eccLevel = 'L'
}) {
    const dataHex = (dataCodewords || []).map(bitStringToHex);

    if (version !== 4 || eccLevel !== 'L' || dataHex.length !== 80) {
        return {
            blocks: [],
            dataHex,
            eccHex: [],
            interleavedHex: dataHex.slice(),
            interleavedBits: dataHex.map(hexToBitString).join('')
        };
    }

    const dataBytes = dataHex.map((hex) => parseInt(hex, 16));
    const eccBytes = computeEccCodewords(dataBytes, ECC_LEN_V4_L);
    const eccHex = eccBytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase());

    const blocks = [{ index: 0, dataHex: dataHex.slice(), eccHex }];
    const interleavedHex = blocks[0].dataHex.concat(blocks[0].eccHex);
    const interleavedBits = interleavedHex.map(hexToBitString).join('');

    return {
        blocks,
        dataHex,
        eccHex,
        interleavedHex,
        interleavedBits
    };
}
