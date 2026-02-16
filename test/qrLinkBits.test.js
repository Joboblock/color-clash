import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeLinkToBits } from '../src/qrCode/linkToBits.js';
import { smallestVersionForLink } from '../src/qrCode/versionCalc.js';

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
