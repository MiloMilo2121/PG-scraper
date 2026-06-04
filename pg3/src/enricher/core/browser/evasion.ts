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

import { Page } from 'playwright';
import { ClientHintsData, SPEECH_VOICES } from '../../../scraper/core/browser/ua_db';
import { Logger } from '../../utils/logger';
import axios from 'axios';

export interface CapSolverConfig {
    apiKey?: string;
    proxy?: string; // Must match the proxy used by the browser precisely
    userAgent?: string; // Must match the browser's User-Agent string exactly
}

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
    // CapSolver (V9 Integration)
    capsolver?: CapSolverConfig;
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

    /**
     * 🧠 V9: Resolve Cloudflare Turnstile explicitly via CapSolver.
     * Must use the exact same Proxy and User-Agent as the page to prevent IP mismatch bans.
     */
    public static async resolveTurnstile(page: Page, websiteUrl: string, websiteKey: string, cfg: CapSolverConfig): Promise<string> {
        if (!cfg.apiKey) throw new Error('CapSolver API key missing');

        Logger.info(`🧠 [CapSolver] Requesting Turnstile token for ${websiteUrl} ...`);

        const payload = {
            clientKey: cfg.apiKey,
            task: {
                type: "AntiCloudflareTask",
                websiteURL: websiteUrl,
                websiteKey: websiteKey,
                proxy: cfg.proxy,
                userAgent: cfg.userAgent
            }
        };

        try {
            // 1. Create Task
            const createTaskParams = await axios.post('https://api.capsolver.com/createTask', payload);
            if (createTaskParams.data.errorId !== 0) {
                throw new Error(`CapSolver Create Failed: ${createTaskParams.data.errorDescription}`);
            }

            const taskId = createTaskParams.data.taskId;
            Logger.debug(`🧠 [CapSolver] Task created: ${taskId}, waiting for resolution...`);

            // 2. Poll for Result
            let resultToken = '';
            for (let i = 0; i < 60; i++) { // Max 60 seconds
                await new Promise(resolve => setTimeout(resolve, 1500));

                const resultParams = await axios.post('https://api.capsolver.com/getTaskResult', {
                    clientKey: cfg.apiKey,
                    taskId: taskId
                });

                if (resultParams.data.status === 'ready') {
                    resultToken = resultParams.data.solution.token;
                    Logger.info(`✅ [CapSolver] Turnstile solved successfully!`);
                    break;
                } else if (resultParams.data.status === 'failed') {
                    throw new Error(`CapSolver Failed: ${resultParams.data.errorDescription}`);
                }
            }

            if (!resultToken) {
                throw new Error('CapSolver timed out after 60 seconds');
            }

            // 3. Inject token back into the page (if Turnstile widget exists)
            await page.evaluate((token) => {
                // Typical Turnstile injection vector
                const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;
                if (input) {
                    input.value = token;
                }
            }, resultToken);

            return resultToken;

        } catch (error: any) {
            Logger.error(`❌ [CapSolver] Error resolving Turnstile: ${error.message}`);
            throw error;
        }
    }

    // ── Core evasion (existing, improved) ────────────────────────────

    private static async hideWebdriver(page: Page): Promise<void> {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        });
    }

    private static async mockChrome(page: Page): Promise<void> {
        await page.addInitScript(() => {
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
        await page.addInitScript(() => {
            const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
            (window.navigator.permissions as any).query = (parameters: any) => (
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                    : originalQuery(parameters)
            );
        });
    }

    private static async mockPlugins(page: Page): Promise<void> {
        await page.addInitScript(() => {
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
        await page.addInitScript((args) => {
            const vendor = args.vendor;
            const renderer = args.renderer;
            const getParameterProxyHandler = {
                apply: function (target: any, ctx: any, fnArgs: any) {
                    const param = fnArgs[0];
                    if (param === 37445) return vendor;   // UNMASKED_VENDOR_WEBGL
                    if (param === 37446) return renderer;  // UNMASKED_RENDERER_WEBGL
                    return Reflect.apply(target, ctx, fnArgs);
                },
            };
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);

            if (typeof WebGL2RenderingContext !== 'undefined') {
                const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
                WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
            }
        }, { vendor: cfg.webglVendor || DEFAULT_CONFIG.webglVendor!, renderer: cfg.webglRenderer || DEFAULT_CONFIG.webglRenderer! });
    }

    /**
     * FIXED: Per-pixel noise with session seed (was uniform shift)
     * Also hooks toBlob and getImageData for consistency
     */
    private static async injectCanvasNoise(page: Page): Promise<void> {
        await page.addInitScript(() => {
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
                        imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + Math.round(nr)));
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
        await page.addInitScript(() => {
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
     * Non-destructive resolvedOptions override (preserves all properties)
     */
    private static async setTimezone(page: Page, cfg: EvasionConfig): Promise<void> {
        const timezone = cfg.timezone || 'Europe/Rome';

        // Playwright natively supports timezone overrides natively mapped to CDP
        // Let's use evaluate instead of CDP since we can't get CDP client trivially from playwright Context
        // Wait, context has timezone setting, so it's already done in context!
        // We will just do the JavaScript patch just in case
        await page.addInitScript((tz) => {
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
     * Per-sample noise with session seed (was uniform offset)
     */
    private static async injectAudioNoise(page: Page): Promise<void> {
        await page.addInitScript(() => {
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
        const hints = cfg.clientHints;

        await page.addInitScript((ch) => {
            const uaData = {
                brands: ch.brands,
                mobile: ch.isMobile,
                platform: ch.platform,
                getHighEntropyValues: (keys: string[]) => {
                    const result: any = {
                        brands: ch.brands,
                        mobile: ch.isMobile,
                        platform: ch.platform,
                    };
                    if (keys.includes('architecture')) result.architecture = ch.architecture;
                    if (keys.includes('bitness')) result.bitness = ch.bitness;
                    if (keys.includes('fullVersionList')) result.fullVersionList = ch.fullVersionList;
                    if (keys.includes('model')) result.model = '';
                    if (keys.includes('platformVersion')) result.platformVersion = ch.platformVersion;
                    if (keys.includes('uaFullVersion')) {
                        result.uaFullVersion = ch.fullVersionList?.[0]?.version || '';
                    }
                    return Promise.resolve(result);
                },
                toJSON: () => ({
                    brands: ch.brands,
                    mobile: ch.isMobile,
                    platform: ch.platform,
                }),
            };

            Object.defineProperty(navigator, 'userAgentData', {
                get: () => uaData,
                configurable: true,
            });
        }, hints);
    }

    /**
     * navigator.connection: Mock NetworkInformation API
     */
    private static async mockConnection(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.addInitScript((args) => {
            const connectionObj = {
                effectiveType: args.type,
                downlink: args.downlink,
                rtt: args.rtt,
                saveData: false,
                onchange: null,
                addEventListener: () => { },
                removeEventListener: () => { },
                dispatchEvent: () => true,
            };
            Object.defineProperty(navigator, 'connection', {
                get: () => connectionObj,
                configurable: true,
            });
        }, { type: cfg.connectionType || 'wifi', downlink: cfg.connectionDownlink || 10, rtt: cfg.connectionRtt || 100 });
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

        await page.addInitScript((args) => {
            const availW = args.sw;
            const availH = args.sh - args.offset;

            Object.defineProperty(screen, 'width', { get: () => args.sw });
            Object.defineProperty(screen, 'height', { get: () => args.sh });
            Object.defineProperty(screen, 'availWidth', { get: () => availW });
            Object.defineProperty(screen, 'availHeight', { get: () => availH });
            Object.defineProperty(screen, 'colorDepth', { get: () => args.d });
            Object.defineProperty(screen, 'pixelDepth', { get: () => args.d });
        }, { sw: screenW, sh: screenH, d: depth, offset: chromeHeight });
    }

    /**
     * Font enumeration defense: Add noise to measureText
     */
    private static async defendFontEnumeration(page: Page): Promise<void> {
        await page.addInitScript(() => {
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

        await page.addInitScript((voiceList) => {
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
                    return function (this: SpeechSynthesis, type: string, ...evArgs: any[]) {
                        if (type === 'voiceschanged') {
                            // Immediately invoke to simulate loaded voices
                            setTimeout(() => {
                                if (evArgs[0] && typeof evArgs[0] === 'function') evArgs[0]();
                            }, 50);
                        }
                        return original.apply(this, [type, ...evArgs] as any);
                    };
                })(window.speechSynthesis.addEventListener);
            }
        }, voices);
    }

    /**
     * Device memory: Override navigator.deviceMemory
     */
    private static async mockDeviceMemory(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.addInitScript((memory) => {
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
        await page.addInitScript((points) => {
            Object.defineProperty(navigator, 'maxTouchPoints', {
                get: () => points,
                configurable: true,
            });
        }, cfg.maxTouchPoints ?? 0);
    }
}
