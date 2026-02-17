const GF256_PRIMITIVE = 0x11d;

const RS_BLOCK_TABLE_L = [
    null,
    { eccPerBlock: 7, groups: [{ count: 1, dataCodewords: 19 }] },
    { eccPerBlock: 10, groups: [{ count: 1, dataCodewords: 34 }] },
    { eccPerBlock: 15, groups: [{ count: 1, dataCodewords: 55 }] },
    { eccPerBlock: 20, groups: [{ count: 1, dataCodewords: 80 }] },
    { eccPerBlock: 26, groups: [{ count: 1, dataCodewords: 108 }] },
    { eccPerBlock: 18, groups: [{ count: 2, dataCodewords: 68 }] },
    { eccPerBlock: 20, groups: [{ count: 2, dataCodewords: 78 }] },
    { eccPerBlock: 24, groups: [{ count: 2, dataCodewords: 97 }] },
    { eccPerBlock: 30, groups: [{ count: 2, dataCodewords: 116 }] },
    { eccPerBlock: 18, groups: [{ count: 2, dataCodewords: 68 }, { count: 2, dataCodewords: 69 }] },
    { eccPerBlock: 20, groups: [{ count: 4, dataCodewords: 81 }] },
    { eccPerBlock: 24, groups: [{ count: 2, dataCodewords: 92 }, { count: 2, dataCodewords: 93 }] },
    { eccPerBlock: 26, groups: [{ count: 4, dataCodewords: 107 }] },
    { eccPerBlock: 30, groups: [{ count: 3, dataCodewords: 115 }, { count: 1, dataCodewords: 116 }] },
    { eccPerBlock: 22, groups: [{ count: 5, dataCodewords: 87 }, { count: 1, dataCodewords: 88 }] },
    { eccPerBlock: 24, groups: [{ count: 5, dataCodewords: 98 }, { count: 1, dataCodewords: 99 }] },
    { eccPerBlock: 28, groups: [{ count: 1, dataCodewords: 107 }, { count: 5, dataCodewords: 108 }] },
    { eccPerBlock: 30, groups: [{ count: 5, dataCodewords: 120 }, { count: 1, dataCodewords: 121 }] },
    { eccPerBlock: 28, groups: [{ count: 3, dataCodewords: 113 }, { count: 4, dataCodewords: 114 }] },
    { eccPerBlock: 28, groups: [{ count: 3, dataCodewords: 107 }, { count: 5, dataCodewords: 108 }] },
    { eccPerBlock: 28, groups: [{ count: 4, dataCodewords: 116 }, { count: 4, dataCodewords: 117 }] },
    { eccPerBlock: 28, groups: [{ count: 2, dataCodewords: 111 }, { count: 7, dataCodewords: 112 }] },
    { eccPerBlock: 30, groups: [{ count: 4, dataCodewords: 121 }, { count: 5, dataCodewords: 122 }] },
    { eccPerBlock: 30, groups: [{ count: 6, dataCodewords: 117 }, { count: 4, dataCodewords: 118 }] },
    { eccPerBlock: 26, groups: [{ count: 8, dataCodewords: 106 }, { count: 4, dataCodewords: 107 }] },
    { eccPerBlock: 28, groups: [{ count: 10, dataCodewords: 114 }, { count: 2, dataCodewords: 115 }] },
    { eccPerBlock: 30, groups: [{ count: 8, dataCodewords: 122 }, { count: 4, dataCodewords: 123 }] },
    { eccPerBlock: 30, groups: [{ count: 3, dataCodewords: 117 }, { count: 10, dataCodewords: 118 }] },
    { eccPerBlock: 30, groups: [{ count: 7, dataCodewords: 116 }, { count: 7, dataCodewords: 117 }] },
    { eccPerBlock: 30, groups: [{ count: 5, dataCodewords: 115 }, { count: 10, dataCodewords: 116 }] },
    { eccPerBlock: 30, groups: [{ count: 13, dataCodewords: 115 }, { count: 3, dataCodewords: 116 }] },
    { eccPerBlock: 30, groups: [{ count: 17, dataCodewords: 115 }] },
    { eccPerBlock: 30, groups: [{ count: 17, dataCodewords: 115 }, { count: 1, dataCodewords: 116 }] },
    { eccPerBlock: 30, groups: [{ count: 13, dataCodewords: 115 }, { count: 6, dataCodewords: 116 }] },
    { eccPerBlock: 30, groups: [{ count: 12, dataCodewords: 121 }, { count: 7, dataCodewords: 122 }] },
    { eccPerBlock: 30, groups: [{ count: 6, dataCodewords: 121 }, { count: 14, dataCodewords: 122 }] },
    { eccPerBlock: 30, groups: [{ count: 17, dataCodewords: 122 }, { count: 4, dataCodewords: 123 }] },
    { eccPerBlock: 30, groups: [{ count: 4, dataCodewords: 122 }, { count: 18, dataCodewords: 123 }] },
    { eccPerBlock: 30, groups: [{ count: 20, dataCodewords: 117 }, { count: 4, dataCodewords: 118 }] },
    { eccPerBlock: 30, groups: [{ count: 19, dataCodewords: 118 }, { count: 6, dataCodewords: 119 }] }
];

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

function getBlockSpec(version, eccLevel) {
    if (eccLevel !== 'L') return null;
    if (!Number.isInteger(version) || version <= 0 || version >= RS_BLOCK_TABLE_L.length) return null;
    return RS_BLOCK_TABLE_L[version] ?? null;
}

export function buildInterleavedCodewords({
    dataCodewords,
    version,
    eccLevel = 'L'
}) {
    const dataHex = (dataCodewords || []).map(bitStringToHex);

    const spec = getBlockSpec(version, eccLevel);
    if (!spec) {
        return {
            blocks: [],
            dataHex,
            eccHex: [],
            interleavedHex: dataHex.slice(),
            interleavedBits: dataHex.map(hexToBitString).join('')
        };
    }

    const expectedDataCodewords = spec.groups.reduce((sum, group) => sum + group.count * group.dataCodewords, 0);
    if (dataHex.length !== expectedDataCodewords) {
        return {
            blocks: [],
            dataHex,
            eccHex: [],
            interleavedHex: dataHex.slice(),
            interleavedBits: dataHex.map(hexToBitString).join('')
        };
    }

    const blocks = [];
    let offset = 0;
    let blockIndex = 0;
    for (const group of spec.groups) {
        for (let i = 0; i < group.count; i += 1) {
            const dataHexBlock = dataHex.slice(offset, offset + group.dataCodewords);
            offset += group.dataCodewords;
            const dataBytes = dataHexBlock.map((hex) => parseInt(hex, 16));
            const eccBytes = computeEccCodewords(dataBytes, spec.eccPerBlock);
            const eccHex = eccBytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase());
            blocks.push({ index: blockIndex, dataHex: dataHexBlock, eccHex });
            blockIndex += 1;
        }
    }

    const maxDataLength = Math.max(...blocks.map((block) => block.dataHex.length));
    const interleavedHex = [];
    for (let i = 0; i < maxDataLength; i += 1) {
        for (const block of blocks) {
            if (i < block.dataHex.length) interleavedHex.push(block.dataHex[i]);
        }
    }
    for (let i = 0; i < spec.eccPerBlock; i += 1) {
        for (const block of blocks) {
            interleavedHex.push(block.eccHex[i]);
        }
    }

    const eccHex = blocks.flatMap((block) => block.eccHex);
    const interleavedBits = interleavedHex.map(hexToBitString).join('');

    return {
        blocks,
        dataHex,
        eccHex,
        interleavedHex,
        interleavedBits
    };
}
