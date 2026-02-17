/**
 * BROWSER EVASION v3 - "Invisible Crowd"
 * Complete anti-fingerprinting suite with consistency enforcement
 *
 * NINJA CORE - Mirror of pg3/src/enricher/core/browser/evasion.ts
 */

import { Page } from 'puppeteer';

export interface EvasionConfig {
    webglVendor?: string;
    webglRenderer?: string;
    timezone?: string;
    locale?: string;
    clientHints?: any;
    os?: 'windows' | 'macos' | 'linux' | 'ios' | 'android';
    browser?: 'chrome' | 'firefox' | 'safari' | 'edge';
    connectionType?: string;
    connectionDownlink?: number;
    connectionRtt?: number;
    screenWidth?: number;
    screenHeight?: number;
    screenDepth?: number;
    deviceMemory?: number;
    maxTouchPoints?: number;
}

// Speech voices (embedded to avoid cross-package imports)
const SPEECH_VOICES: Record<string, Array<{ name: string; lang: string; default: boolean }>> = {
    macos: [
        { name: 'Samantha', lang: 'en-US', default: true },
        { name: 'Alex', lang: 'en-US', default: false },
        { name: 'Alice', lang: 'it-IT', default: false },
    ],
    windows: [
        { name: 'Microsoft David', lang: 'en-US', default: true },
        { name: 'Microsoft Zira', lang: 'en-US', default: false },
        { name: 'Microsoft Elsa', lang: 'it-IT', default: false },
    ],
    linux: [
        { name: 'English (America)', lang: 'en-US', default: true },
    ],
    ios: [
        { name: 'Samantha', lang: 'en-US', default: true },
    ],
    android: [
        { name: 'Google US English', lang: 'en-US', default: true },
    ],
};

const DEFAULT_CONFIG: EvasionConfig = {
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    os: 'macos',
    browser: 'chrome',
    connectionType: 'wifi',
    connectionDownlink: 10,
    connectionRtt: 100,
    screenWidth: 1920,
    screenHeight: 1080,
    screenDepth: 24,
    deviceMemory: 8,
    maxTouchPoints: 0,
};

export class BrowserEvasion {
    public static async apply(page: Page, cfg: EvasionConfig = DEFAULT_CONFIG): Promise<void> {
        const config = { ...DEFAULT_CONFIG, ...cfg };
        await this.hideWebdriver(page);
        await this.mockChrome(page);
        await this.mockPermissions(page);
        await this.mockPlugins(page);
        await this.spoofWebGL(page, config);
        await this.injectCanvasNoise(page);
        await this.blockWebRTC(page);
        await this.setTimezone(page, config);
        await this.injectAudioNoise(page);
        await this.injectClientHints(page, config);
        await this.mockConnection(page, config);
        await this.mockScreenProperties(page, config);
        await this.defendFontEnumeration(page);
        await this.mockSpeechVoices(page, config);
        await this.mockDeviceMemory(page, config);
        await this.mockMaxTouchPoints(page, config);
    }

    private static async hideWebdriver(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        });
    }

    private static async mockChrome(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            (window as any).chrome = {
                runtime: {
                    PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
                    PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
                },
                loadTimes: function () {
                    const now = Date.now() / 1000;
                    return {
                        requestTime: now - 0.3, startLoadTime: now - 0.2, commitLoadTime: now - 0.1,
                        finishDocumentLoadTime: now, finishLoadTime: now + 0.05, firstPaintTime: now - 0.05,
                        firstPaintAfterLoadTime: 0, navigationType: 'Other',
                        wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
                        wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
                    };
                },
                csi: function () {
                    return { startE: Date.now(), onloadT: Date.now(), pageT: 300 + Math.random() * 200, tran: 15 };
                },
                app: { isInstalled: false, getDetails: () => null, getIsInstalled: () => false },
            };
        });
    }

    private static async mockPermissions(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
            (window.navigator.permissions as any).query = (parameters: any) => (
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                    : originalQuery(parameters)
            );
        });
    }

    private static async mockPlugins(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                    ];
                    (plugins as any).item = (i: number) => plugins[i];
                    (plugins as any).namedItem = (n: string) => plugins.find(p => p.name === n);
                    (plugins as any).refresh = () => { };
                    return plugins;
                },
            });
        });
    }

    private static async spoofWebGL(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((vendor, renderer) => {
            const handler = {
                apply: function (target: any, ctx: any, args: any) {
                    if (args[0] === 37445) return vendor;
                    if (args[0] === 37446) return renderer;
                    return Reflect.apply(target, ctx, args);
                },
            };
            WebGLRenderingContext.prototype.getParameter = new Proxy(
                WebGLRenderingContext.prototype.getParameter, handler
            );
            if (typeof WebGL2RenderingContext !== 'undefined') {
                WebGL2RenderingContext.prototype.getParameter = new Proxy(
                    WebGL2RenderingContext.prototype.getParameter, handler
                );
            }
        }, cfg.webglVendor || DEFAULT_CONFIG.webglVendor!, cfg.webglRenderer || DEFAULT_CONFIG.webglRenderer!);
    }

    // FIXED: Per-pixel noise
    private static async injectCanvasNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const sessionSeed = Math.random() * 10000;
            function pixelNoise(index: number, channel: number): number {
                return ((Math.sin(index * 0.017 + channel * 0.31 + sessionSeed) * 10000) % 5) - 2;
            }
            function applyNoise(canvas: HTMLCanvasElement): void {
                const ctx = canvas.getContext('2d');
                if (!ctx || canvas.width === 0 || canvas.height === 0) return;
                try {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i]     = Math.min(255, Math.max(0, imageData.data[i]     + Math.round(pixelNoise(i, 0))));
                        imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + Math.round(pixelNoise(i, 1))));
                        imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + Math.round(pixelNoise(i, 2))));
                    }
                    ctx.putImageData(imageData, 0, 0);
                } catch { /* tainted canvas */ }
            }
            const origURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: any) {
                applyNoise(this); return origURL.call(this, type, quality);
            };
            const origBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, quality?: any) {
                applyNoise(this); return origBlob.call(this, cb, type, quality);
            };
        });
    }

    private static async blockWebRTC(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const handler = {
                construct(target: any, args: any) {
                    if (args[0]?.iceServers) args[0].iceServers = [];
                    return new target(...args);
                },
            };
            // @ts-ignore
            if (window.RTCPeerConnection) window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, handler);
        });
    }

    // FIXED: Non-destructive resolvedOptions
    private static async setTimezone(page: Page, cfg: EvasionConfig): Promise<void> {
        const timezone = cfg.timezone || 'Europe/Rome';
        try {
            const client = await (page as any)._client();
            if (client) await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
        } catch { /* CDP unavailable */ }

        await page.evaluateOnNewDocument((tz) => {
            const orig = Intl.DateTimeFormat.prototype.resolvedOptions;
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function () { return { ...orig.call(this), timeZone: tz }; },
            });
        }, timezone);
    }

    // FIXED: Per-sample noise
    private static async injectAudioNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const sessionSeed = Math.random() * 10000;
            const orig = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function (channel: number) {
                const results = orig.apply(this, [channel]);
                for (let i = 0; i < results.length; i++) {
                    results[i] += 0.00003 * Math.sin(i * 0.013 + channel * 0.7 + sessionSeed);
                }
                return results;
            };
        });
    }

    // ── New v3 techniques ────────────────────────────────────────────

    private static async injectClientHints(page: Page, cfg: EvasionConfig): Promise<void> {
        if (!cfg.clientHints) return;
        const ch = cfg.clientHints;
        await page.evaluateOnNewDocument((hints: any) => {
            const uaData = {
                brands: hints.brands,
                mobile: hints.isMobile,
                platform: hints.platform,
                getHighEntropyValues: (keys: string[]) => {
                    const result: any = { brands: hints.brands, mobile: hints.isMobile, platform: hints.platform };
                    if (keys.includes('architecture')) result.architecture = hints.architecture;
                    if (keys.includes('bitness')) result.bitness = hints.bitness;
                    if (keys.includes('fullVersionList')) result.fullVersionList = hints.fullVersionList;
                    if (keys.includes('model')) result.model = '';
                    if (keys.includes('platformVersion')) result.platformVersion = hints.platformVersion;
                    return Promise.resolve(result);
                },
                toJSON: () => ({ brands: hints.brands, mobile: hints.isMobile, platform: hints.platform }),
            };
            Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
        }, ch);
    }

    private static async mockConnection(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((type, downlink, rtt) => {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: type, downlink, rtt, saveData: false, onchange: null,
                    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
                }),
                configurable: true,
            });
        }, cfg.connectionType || 'wifi', cfg.connectionDownlink || 10, cfg.connectionRtt || 100);
    }

    private static async mockScreenProperties(page: Page, cfg: EvasionConfig): Promise<void> {
        const sw = cfg.screenWidth || 1920, sh = cfg.screenHeight || 1080, d = cfg.screenDepth || 24;
        const offset = cfg.os === 'macos' ? 25 : cfg.os === 'windows' ? 40 : 30;
        await page.evaluateOnNewDocument((sw, sh, d, offset) => {
            Object.defineProperty(screen, 'width', { get: () => sw });
            Object.defineProperty(screen, 'height', { get: () => sh });
            Object.defineProperty(screen, 'availWidth', { get: () => sw });
            Object.defineProperty(screen, 'availHeight', { get: () => sh - offset });
            Object.defineProperty(screen, 'colorDepth', { get: () => d });
            Object.defineProperty(screen, 'pixelDepth', { get: () => d });
        }, sw, sh, d, offset);
    }

    private static async defendFontEnumeration(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const seed = Math.random() * 10000;
            const orig = CanvasRenderingContext2D.prototype.measureText;
            CanvasRenderingContext2D.prototype.measureText = function (text: string) {
                const result = orig.call(this, text);
                let h = 0;
                for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
                const noise = 0.00001 * Math.sin(h + seed);
                return new Proxy(result, {
                    get(t, p) {
                        if (p === 'width') return t.width + noise;
                        const v = (t as any)[p]; return typeof v === 'function' ? v.bind(t) : v;
                    },
                });
            };
        });
    }

    private static async mockSpeechVoices(page: Page, cfg: EvasionConfig): Promise<void> {
        const voices = SPEECH_VOICES[cfg.os || 'macos'] || SPEECH_VOICES.macos;
        await page.evaluateOnNewDocument((voiceList: any) => {
            const sv = voiceList.map((v: any) => ({ name: v.name, lang: v.lang, localService: true, default: v.default, voiceURI: v.name }));
            if (window.speechSynthesis) {
                window.speechSynthesis.getVoices = () => sv as SpeechSynthesisVoice[];
            }
        }, voices);
    }

    private static async mockDeviceMemory(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((mem) => {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => mem, configurable: true });
        }, cfg.deviceMemory || 8);
    }

    private static async mockMaxTouchPoints(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((pts) => {
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => pts, configurable: true });
        }, cfg.maxTouchPoints ?? 0);
    }
}
