export function encodeLinkToBits(link) {
    if (typeof link !== 'string') {
        return [];
    }

    const bytes = [];
    for (let i = 0; i < link.length; i++) {
        const code = link.charCodeAt(i) & 0xff;
        bytes.push(code.toString(2).padStart(8, '0'));
    }
    return bytes;
}
