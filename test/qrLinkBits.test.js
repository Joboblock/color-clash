import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeLinkToBits } from '../src/qrCode/linkToBits.js';
import { smallestVersionForLink } from '../src/qrCode/versionCalc.js';
import { buildByteModeBitStream } from '../src/qrCode/bytePadding.js';

test('qr: encode link to 8-bit lines', () => {
    const link = 'https://joboblock.github.io/color-clash/?menu=online&key=tZ4o7xx4qw';
    const expected = [
        '01101000',
        '01110100',
        '01110100',
        '01110000',
        '01110011',
        '00111010',
        '00101111',
        '00101111',
        '01101010',
        '01101111',
        '01100010',
        '01101111',
        '01100010',
        '01101100',
        '01101111',
        '01100011',
        '01101011',
        '00101110',
        '01100111',
        '01101001',
        '01110100',
        '01101000',
        '01110101',
        '01100010',
        '00101110',
        '01101001',
        '01101111',
        '00101111',
        '01100011',
        '01101111',
        '01101100',
        '01101111',
        '01110010',
        '00101101',
        '01100011',
        '01101100',
        '01100001',
        '01110011',
        '01101000',
        '00101111',
        '00111111',
        '01101101',
        '01100101',
        '01101110',
        '01110101',
        '00111101',
        '01101111',
        '01101110',
        '01101100',
        '01101001',
        '01101110',
        '01100101',
        '00100110',
        '01101011',
        '01100101',
        '01111001',
        '00111101',
        '01110100',
        '01011010',
        '00110100',
        '01101111',
        '00110111',
        '01111000',
        '01111000',
        '00110100',
        '01110001',
        '01110111'
    ];

    const result = encodeLinkToBits(link);
    assert.deepEqual(result, expected);
});

test('qr: smallest version (L) fits link', () => {
    const link = 'https://joboblock.github.io/color-clash/?menu=online&key=tZ4o7xx4qw';
    const version = smallestVersionForLink(link);
    assert.equal(version, 4);
});

test('qr: step 3 concatenation + padding', () => {
    const link = 'https://joboblock.github.io/color-clash/?menu=online&key=tZ4o7xx4qw';
    const { bitStream, codewords } = buildByteModeBitStream(link, 4);
    const expectedBitStream = '0100010000110110100001110100011101000111000001110011001110100010111100101111011010100110111101100010011011110110001001101100011011110110001101101011001011100110011101101001011101000110100001110101011000100010111001101001011011110010111101100011011011110110110001101111011100100010110101100011011011000110000101110011011010000010111100111111011011010110010101101110011101010011110101101111011011100110110001101001011011100110010100100110011010110110010101111001001111010111010001011010001101000110111100110111011110000111100000110100011100010111011100001110110000010001111011000001000111101100000100011110110000010001111011000001000111101100';

    assert.equal(bitStream, expectedBitStream);
    assert.equal(codewords.length, 80);
    assert.deepEqual(codewords.slice(0, 2), ['01000100', '00110110']);
    assert.deepEqual(codewords.slice(-2), ['00010001', '11101100']);
});
