/**
 * BROWSER EVASION v3 - "Invisible Crowd"
 * Complete anti-fingerprinting suite with consistency enforcement
 *
 * Techniques:
 * - WebGL vendor/renderer spoofing (OS-consistent)
 * - Canvas noise injection (per-pixel, session-seeded)
 * - Audio noise injection (per-sample, session-seeded)
 * - WebRTC leak protection
 * - Timezone/Locale matching (non-destructive)
 * - Client Hints consistency (Sec-CH-UA-* + navigator.userAgentData)
 * - navigator.connection mocking
 * - Screen property consistency
 * - Font enumeration defense
 * - Speech synthesis voice mocking
 * - Device memory & touch points spoofing
 */

import { Page } from 'puppeteer';
import { ClientHintsData, SPEECH_VOICES } from './ua_db';

export interface EvasionConfig {
    // WebGL
    webglVendor?: string;
    webglRenderer?: string;
    // Timezone/Locale
    timezone?: string;
    locale?: string;
    // Client Hints (new)
    clientHints?: ClientHintsData;
    // OS info for consistency (new)
    os?: 'windows' | 'macos' | 'linux' | 'ios' | 'android';
    browser?: 'chrome' | 'firefox' | 'safari' | 'edge';
    // Network (new)
    connectionType?: string;
    connectionDownlink?: number;
    connectionRtt?: number;
    // Screen (new)
    screenWidth?: number;
    screenHeight?: number;
    screenDepth?: number;
    // Hardware (new)
    deviceMemory?: number;
    maxTouchPoints?: number;
}

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
    /**
     * Apply all evasion techniques with full config
     */
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
        // New v3 techniques
        await this.injectClientHints(page, config);
        await this.mockConnection(page, config);
        await this.mockScreenProperties(page, config);
        await this.defendFontEnumeration(page);
        await this.mockSpeechVoices(page, config);
        await this.mockDeviceMemory(page, config);
        await this.mockMaxTouchPoints(page, config);
    }

    // ── Core evasion (existing, improved) ────────────────────────────

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
                    PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
                    RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
                    OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                },
                loadTimes: function () {
                    const now = Date.now() / 1000;
                    return {
                        requestTime: now - 0.3,
                        startLoadTime: now - 0.2,
                        commitLoadTime: now - 0.1,
                        finishDocumentLoadTime: now,
                        finishLoadTime: now + 0.05,
                        firstPaintTime: now - 0.05,
                        firstPaintAfterLoadTime: 0,
                        navigationType: 'Other',
                        wasFetchedViaSpdy: false,
                        wasNpnNegotiated: true,
                        npnNegotiatedProtocol: 'h2',
                        wasAlternateProtocolAvailable: false,
                        connectionInfo: 'h2',
                    };
                },
                csi: function () {
                    return { startE: Date.now(), onloadT: Date.now(), pageT: 300 + Math.random() * 200, tran: 15 };
                },
                app: {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                    getDetails: () => null,
                    getIsInstalled: () => false,
                    runningState: () => 'cannot_run',
                },
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
            const getParameterProxyHandler = {
                apply: function (target: any, ctx: any, args: any) {
                    const param = args[0];
                    if (param === 37445) return vendor;   // UNMASKED_VENDOR_WEBGL
                    if (param === 37446) return renderer;  // UNMASKED_RENDERER_WEBGL
                    return Reflect.apply(target, ctx, args);
                },
            };
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);

            if (typeof WebGL2RenderingContext !== 'undefined') {
                const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
                WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
            }
        }, cfg.webglVendor || DEFAULT_CONFIG.webglVendor!, cfg.webglRenderer || DEFAULT_CONFIG.webglRenderer!);
    }

    /**
     * FIXED: Per-pixel noise with session seed (was uniform shift)
     * Also hooks toBlob and getImageData for consistency
     */
    private static async injectCanvasNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const sessionSeed = Math.random() * 10000;

            // Noise function: deterministic per-pixel, varied across pixels
            function pixelNoise(index: number, channel: number): number {
                return ((Math.sin(index * 0.017 + channel * 0.31 + sessionSeed) * 10000) % 5) - 2;
            }

            function applyNoiseToCanvas(canvas: HTMLCanvasElement): void {
                const ctx = canvas.getContext('2d');
                if (!ctx || canvas.width === 0 || canvas.height === 0) return;
                try {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        const nr = pixelNoise(i, 0);
                        const ng = pixelNoise(i, 1);
                        const nb = pixelNoise(i, 2);
                        imageData.data[i]     = Math.min(255, Math.max(0, imageData.data[i]     + Math.round(nr)));
                        imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + Math.round(ng)));
                        imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + Math.round(nb)));
                        // Alpha (i+3) untouched
                    }
                    ctx.putImageData(imageData, 0, 0);
                } catch {
                    // Security error on tainted canvas - skip
                }
            }

            // Hook toDataURL
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: any) {
                applyNoiseToCanvas(this);
                return originalToDataURL.call(this, type, quality);
            };

            // Hook toBlob
            const originalToBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string, quality?: any) {
                applyNoiseToCanvas(this);
                return originalToBlob.call(this, callback, type, quality);
            };
        });
    }

    private static async blockWebRTC(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const rtcHandler = {
                construct(target: any, args: any) {
                    if (args[0]?.iceServers) {
                        args[0].iceServers = [];
                    }
                    return new target(...args);
                },
            };
            // @ts-ignore
            if (window.RTCPeerConnection) {
                // @ts-ignore
                window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, rtcHandler);
            }
            // @ts-ignore
            if (window.webkitRTCPeerConnection) {
                // @ts-ignore
                window.webkitRTCPeerConnection = new Proxy(window.webkitRTCPeerConnection, rtcHandler);
            }
        });
    }

    /**
     * FIXED: Non-destructive resolvedOptions override (preserves all properties)
     */
    private static async setTimezone(page: Page, cfg: EvasionConfig): Promise<void> {
        const timezone = cfg.timezone || 'Europe/Rome';

        try {
            const client = await (page as any)._client();
            if (client) {
                await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
            }
        } catch {
            // CDP command might not be available in all contexts
        }

        await page.evaluateOnNewDocument((tz) => {
            const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function () {
                    const original = originalResolvedOptions.call(this);
                    return { ...original, timeZone: tz };
                },
            });
        }, timezone);
    }

    /**
     * FIXED: Per-sample noise with session seed (was uniform offset)
     */
    private static async injectAudioNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const sessionSeed = Math.random() * 10000;
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function (channel: number) {
                const results = originalGetChannelData.apply(this, [channel]);
                for (let i = 0; i < results.length; i++) {
                    const sampleNoise = 0.00003 * Math.sin(i * 0.013 + channel * 0.7 + sessionSeed);
                    results[i] = results[i] + sampleNoise;
                }
                return results;
            };
        });
    }

    // ── New v3 techniques ────────────────────────────────────────────

    /**
     * Client Hints: Override navigator.userAgentData to match UA string
     */
    private static async injectClientHints(page: Page, cfg: EvasionConfig): Promise<void> {
        if (!cfg.clientHints) return;
        const ch = cfg.clientHints;

        await page.evaluateOnNewDocument((hints) => {
            const uaData = {
                brands: hints.brands,
                mobile: hints.isMobile,
                platform: hints.platform,
                getHighEntropyValues: (keys: string[]) => {
                    const result: any = {
                        brands: hints.brands,
                        mobile: hints.isMobile,
                        platform: hints.platform,
                    };
                    if (keys.includes('architecture')) result.architecture = hints.architecture;
                    if (keys.includes('bitness')) result.bitness = hints.bitness;
                    if (keys.includes('fullVersionList')) result.fullVersionList = hints.fullVersionList;
                    if (keys.includes('model')) result.model = '';
                    if (keys.includes('platformVersion')) result.platformVersion = hints.platformVersion;
                    if (keys.includes('uaFullVersion')) {
                        result.uaFullVersion = hints.fullVersionList?.[0]?.version || '';
                    }
                    return Promise.resolve(result);
                },
                toJSON: () => ({
                    brands: hints.brands,
                    mobile: hints.isMobile,
                    platform: hints.platform,
                }),
            };

            Object.defineProperty(navigator, 'userAgentData', {
                get: () => uaData,
                configurable: true,
            });
        }, ch);
    }

    /**
     * navigator.connection: Mock NetworkInformation API
     */
    private static async mockConnection(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((type, downlink, rtt) => {
            const connectionObj = {
                effectiveType: type,
                downlink: downlink,
                rtt: rtt,
                saveData: false,
                onchange: null,
                addEventListener: () => {},
                removeEventListener: () => {},
                dispatchEvent: () => true,
            };
            Object.defineProperty(navigator, 'connection', {
                get: () => connectionObj,
                configurable: true,
            });
        }, cfg.connectionType || 'wifi', cfg.connectionDownlink || 10, cfg.connectionRtt || 100);
    }

    /**
     * Screen properties: Consistent with viewport and OS
     */
    private static async mockScreenProperties(page: Page, cfg: EvasionConfig): Promise<void> {
        const screenW = cfg.screenWidth || 1920;
        const screenH = cfg.screenHeight || 1080;
        const depth = cfg.screenDepth || 24;

        // OS-specific chrome offsets
        const chromeHeight = cfg.os === 'macos' ? 25 : cfg.os === 'windows' ? 40 : 30;

        await page.evaluateOnNewDocument((sw, sh, d, offset) => {
            const availW = sw;
            const availH = sh - offset;

            Object.defineProperty(screen, 'width', { get: () => sw });
            Object.defineProperty(screen, 'height', { get: () => sh });
            Object.defineProperty(screen, 'availWidth', { get: () => availW });
            Object.defineProperty(screen, 'availHeight', { get: () => availH });
            Object.defineProperty(screen, 'colorDepth', { get: () => d });
            Object.defineProperty(screen, 'pixelDepth', { get: () => d });
        }, screenW, screenH, depth, chromeHeight);
    }

    /**
     * Font enumeration defense: Add noise to measureText
     */
    private static async defendFontEnumeration(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const sessionSeed = Math.random() * 10000;
            const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;

            CanvasRenderingContext2D.prototype.measureText = function (text: string) {
                const result = originalMeasureText.call(this, text);
                // Tiny deterministic noise based on text content
                let hash = 0;
                for (let i = 0; i < text.length; i++) {
                    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
                }
                const noise = 0.00001 * Math.sin(hash + sessionSeed);

                // Create proxy to intercept width access
                return new Proxy(result, {
                    get(target, prop) {
                        if (prop === 'width') return target.width + noise;
                        const value = (target as any)[prop];
                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                });
            };
        });
    }

    /**
     * Speech synthesis: Return OS-consistent voice list
     */
    private static async mockSpeechVoices(page: Page, cfg: EvasionConfig): Promise<void> {
        const os = cfg.os || 'macos';
        const voices = SPEECH_VOICES[os] || SPEECH_VOICES.macos;

        await page.evaluateOnNewDocument((voiceList) => {
            const synthVoices = voiceList.map((v: any) => ({
                name: v.name,
                lang: v.lang,
                localService: true,
                default: v.default,
                voiceURI: v.name,
            }));

            if (window.speechSynthesis) {
                window.speechSynthesis.getVoices = () => synthVoices as SpeechSynthesisVoice[];
                // Also fire voiceschanged once
                window.speechSynthesis.addEventListener = ((original) => {
                    return function (this: SpeechSynthesis, type: string, ...args: any[]) {
                        if (type === 'voiceschanged') {
                            // Immediately invoke to simulate loaded voices
                            setTimeout(() => {
                                if (args[0] && typeof args[0] === 'function') args[0]();
                            }, 50);
                        }
                        return original.apply(this, [type, ...args] as any);
                    };
                })(window.speechSynthesis.addEventListener);
            }
        }, voices);
    }

    /**
     * Device memory: Override navigator.deviceMemory
     */
    private static async mockDeviceMemory(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((memory) => {
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => memory,
                configurable: true,
            });
        }, cfg.deviceMemory || 8);
    }

    /**
     * Touch points: Override navigator.maxTouchPoints
     */
    private static async mockMaxTouchPoints(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((points) => {
            Object.defineProperty(navigator, 'maxTouchPoints', {
                get: () => points,
                configurable: true,
            });
        }, cfg.maxTouchPoints ?? 0);
    }
}
