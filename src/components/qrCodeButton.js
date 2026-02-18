// ES Module: QrCodeButton
// Encapsulates behavior, accessibility, and QR overlay rendering for the QR code menu button.
import { encodeLinkToBits } from '../qrCode/linkToBits.js';
import { smallestVersionForLink } from '../qrCode/versionCalc.js';
import { buildFixedPattern, patternToLogLines } from '../qrCode/patternBuilder.js';
import { buildByteModeBitStream } from '../qrCode/bytePadding.js';
import { buildInterleavedCodewords } from '../qrCode/reedSolomonECC.js';
import { placeDataBits, fillNullModules } from '../qrCode/dataPlacement.js';
import { applyMaskPattern } from '../qrCode/maskPatterns.js';

/**
 * @typedef {Object} QrCodeButtonOptions
 * @property {HTMLElement[]|HTMLElement|null} buttons - One or more button elements.
 * @property {string} [link] - Optional QR link override.
 * @property {() => string} [getLink] - Optional QR link getter override.
 * @property {(event:MouseEvent) => void} [onClick] - Optional click handler for QR button.
 */
export class QrCodeButton {
    /**
     * @param {QrCodeButtonOptions} opts
     */
    constructor(opts = {}) {
        this.buttons = Array.isArray(opts.buttons) ? opts.buttons.filter(Boolean) : (opts.buttons ? [opts.buttons] : []);
        this.link = typeof opts.link === 'string' && opts.link.trim() ? opts.link.trim() : 'https://joboblock.github.io/color-clash/?menu=online&key=tZ4o7xx4qw';
        this.getLink = typeof opts.getLink === 'function' ? opts.getLink : null;
        this.onClick = typeof opts.onClick === 'function' ? opts.onClick : null;
        this._onClick = this._onClick.bind(this);
        this._closeOnPointer = this._closeOnPointer.bind(this);
        this._closeOnKey = this._closeOnKey.bind(this);
        this._suppressClick = this._suppressClick.bind(this);
        this._overlayLastFocused = null;
        this._suppressNextClick = false;
        this._wire();
    }

    _wire() {
        for (const btn of this.buttons) {
            try {
                btn.classList.add('menu-box', 'qr-code-btn');
                btn.classList.remove('menu-close-btn');
                if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'QR code');
                if (!btn.getAttribute('title')) btn.setAttribute('title', 'QR code');
                if (!btn.hasAttribute('tabindex')) btn.tabIndex = 0;
                btn.addEventListener('click', this._onClick);
            } catch { /* ignore */ }
        }
    }

    _getLink() {
        if (this.getLink) {
            try {
                const value = this.getLink();
                if (typeof value === 'string' && value.trim()) return value.trim();
            } catch { /* ignore */ }
        }
        return this.link;
    }

    _buildQrOverlayLines() {
        const qrLink = this._getLink();
        const qrBytes = encodeLinkToBits(qrLink);
        const qrVersion = smallestVersionForLink(qrLink);
        console.log('[QR] link bytes:\n' + qrBytes.join('\n'));
        console.log('[QR] smallest version (L):', qrVersion);
        const qrPattern = buildFixedPattern({ version: qrVersion });
        const reservedGrid = qrPattern.map(row => row.slice());
        console.log('[QR] fixed pattern:\n' + patternToLogLines(qrPattern).join('\n'));
        const { codewords } = buildByteModeBitStream(qrLink, qrVersion);
        const { interleavedBits } = buildInterleavedCodewords({
            dataCodewords: codewords,
            version: qrVersion,
            eccLevel: 'L'
        });
        const { usedBits } = placeDataBits(qrPattern, interleavedBits);
        console.log('[QR] zigzag placed bits:', usedBits);
        console.log('[QR] data pattern:\n' + patternToLogLines(qrPattern).join('\n'));
        fillNullModules(qrPattern, false);
        applyMaskPattern(qrPattern, reservedGrid, 2);
        console.log('[QR] masked pattern (2):\n' + patternToLogLines(qrPattern).join('\n'));
        return patternToLogLines(qrPattern);
    }

    _renderQrOverlay(lines) {
        if (!Array.isArray(lines) || !lines.length) return;
        const existing = document.getElementById('qrOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'qrOverlay';
        const matrix = document.createElement('div');
        matrix.className = 'qr-matrix';
        matrix.style.setProperty('--qr-size', String(lines.length));

        for (const line of lines) {
            for (const char of line) {
                const cell = document.createElement('div');
                const isBlack = char === '#';
                cell.className = `qr-cell ${isBlack ? 'qr-cell--black' : 'qr-cell--white'}`;
                matrix.appendChild(cell);
            }
        }

        overlay.appendChild(matrix);
        document.body.appendChild(overlay);
    }

    _clearOverlayHandlers() {
        window.removeEventListener('pointerup', this._closeOnPointer, true);
        window.removeEventListener('keydown', this._closeOnKey, true);
        window.removeEventListener('click', this._suppressClick, true);
    }

    _hideOverlay(suppressClick = false) {
        const existing = document.getElementById('qrOverlay');
        if (existing) existing.remove();
        this._clearOverlayHandlers();
        this._suppressNextClick = !!suppressClick;
        if (this._suppressNextClick) window.addEventListener('click', this._suppressClick, true);
        if (this._overlayLastFocused && typeof this._overlayLastFocused.focus === 'function') {
            try { this._overlayLastFocused.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
        this._overlayLastFocused = null;
    }

    hideOverlay() {
        if (document.getElementById('qrOverlay')) this._hideOverlay();
    }

    _showOverlay() {
        this._overlayLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        try { this._overlayLastFocused && this._overlayLastFocused.blur(); } catch { /* ignore */ }
        this._renderQrOverlay(this._buildQrOverlayLines());
        this._clearOverlayHandlers();
        setTimeout(() => {
            window.addEventListener('pointerup', this._closeOnPointer, true);
            window.addEventListener('keydown', this._closeOnKey, true);
        }, 0);
    }

    _toggleOverlay() {
        const existing = document.getElementById('qrOverlay');
        if (existing) {
            this._hideOverlay();
            return;
        }
        this._showOverlay();
    }

    _closeOnPointer(event) {
        try { event.preventDefault(); } catch { /* ignore */ }
        try { event.stopImmediatePropagation(); } catch { /* ignore */ }
        try { event.stopPropagation(); } catch { /* ignore */ }
        // Touchscreens are weird
        this._hideOverlay(event?.pointerType === 'touch');
    }

    _suppressClick(event) {
        if (!this._suppressNextClick) return;
        try { event.preventDefault(); } catch { /* ignore */ }
        try { event.stopImmediatePropagation(); } catch { /* ignore */ }
        try { event.stopPropagation(); } catch { /* ignore */ }
        this._suppressNextClick = false;
        window.removeEventListener('click', this._suppressClick, true);
    }

    _closeOnKey(event) {
        try { event.preventDefault(); } catch { /* ignore */ }
        try { event.stopImmediatePropagation(); } catch { /* ignore */ }
        try { event.stopPropagation(); } catch { /* ignore */ }
        this._hideOverlay();
    }

    _onClick(event) {
        try { event.preventDefault(); } catch { /* ignore */ }
        try { event.stopPropagation(); } catch { /* ignore */ }
        this._toggleOverlay();
        if (!this.onClick) return;
        try { this.onClick(event); } catch { /* ignore */ }
    }

    destroy() {
        for (const btn of this.buttons) {
            try { btn.removeEventListener('click', this._onClick); } catch { /* ignore */ }
        }
        this._clearOverlayHandlers();
    }
}

export default QrCodeButton;
