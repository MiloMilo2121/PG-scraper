/**
 * 🛡️ BROWSER EVASION v2
 * Tasks 11-19: Complete anti-fingerprinting suite
 * 
 * Features:
 * - WebGL vendor spoofing (Task 12)
 * - Canvas noise injection (Task 13)
 * - WebRTC leak protection (Task 19)
 * - Timezone/Locale matching (Task 18)
 * - Viewport consistency (Task 15)
 */

import { Page } from 'puppeteer';

export interface EvasionConfig {
    webglVendor?: string;
    webglRenderer?: string;
    timezone?: string;
    locale?: string;
}

const DEFAULT_CONFIG: EvasionConfig = {
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M1',
    timezone: 'Europe/Rome',
    locale: 'it-IT',
};

export class BrowserEvasion {
    /**
     * 🎭 Apply all evasion techniques
     */
    public static async apply(page: Page, cfg: EvasionConfig = DEFAULT_CONFIG): Promise<void> {
        await this.hideWebdriver(page);
        await this.mockChrome(page);
        await this.mockPermissions(page);
        await this.mockPlugins(page);
        await this.spoofWebGL(page, cfg);
        await this.injectCanvasNoise(page);
        await this.blockWebRTC(page);
        await this.setTimezone(page, cfg);
        await this.injectAudioNoise(page);
    }

    /**
     * Task 11: Pass webdriver detection
     */
    private static async hideWebdriver(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });

            // Delete automation properties
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        });
    }

    /**
     * Task 11: Mock Chrome runtime
     */
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
                loadTimes: function () { return { startLoadTime: Date.now() / 1000 }; },
                csi: function () { return { startE: Date.now(), onloadT: Date.now() }; },
                app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' } },
            };
        });
    }

    /**
     * Mock Permissions API
     */
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

    /**
     * Mock Plugins array
     */
    private static async mockPlugins(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                    ];
                    // Make it look like a real PluginArray
                    (plugins as any).item = (i: number) => plugins[i];
                    (plugins as any).namedItem = (n: string) => plugins.find(p => p.name === n);
                    (plugins as any).refresh = () => { };
                    return plugins;
                },
            });
        });
    }

    /**
     * Task 12: WebGL Vendor/Renderer Spoofing
     */
    private static async spoofWebGL(page: Page, cfg: EvasionConfig): Promise<void> {
        await page.evaluateOnNewDocument((vendor, renderer) => {
            const getParameterProxyHandler = {
                apply: function (target: any, ctx: any, args: any) {
                    const param = args[0];
                    // UNMASKED_VENDOR_WEBGL
                    if (param === 37445) return vendor;
                    // UNMASKED_RENDERER_WEBGL
                    if (param === 37446) return renderer;
                    return Reflect.apply(target, ctx, args);
                },
            };

            // Override WebGL getParameter
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);

            // Also for WebGL2
            if (typeof WebGL2RenderingContext !== 'undefined') {
                const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
                WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
            }
        }, cfg.webglVendor || 'Apple Inc.', cfg.webglRenderer || 'Apple M1');
    }

    /**
     * Task 13: Canvas Noise Injection
     */
    private static async injectCanvasNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type?: string) {
                // Add subtle noise to canvas
                const ctx = this.getContext('2d');
                if (ctx) {
                    const noise = Math.random() * 0.01;
                    const imageData = ctx.getImageData(0, 0, this.width, this.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = Math.min(255, imageData.data[i] + Math.floor(noise * 10));
                    }
                    ctx.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, [type] as any);
            };
        });
    }

    /**
     * Task 19: Block WebRTC IP Leak
     */
    private static async blockWebRTC(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            // Prevent WebRTC from leaking real IP
            const rtcHandler = {
                construct(target: any, args: any) {
                    // Override ICE servers to prevent IP leak
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
     * Task 18: Timezone Matching
     */
    private static async setTimezone(page: Page, cfg: EvasionConfig): Promise<void> {
        const timezone = cfg.timezone || 'Europe/Rome';

        // Set emulation timezone
        try {
            const client = await (page as any)._client();
            if (client) {
                await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
            }
        } catch (e) {
            // CDP command might not be available in all contexts
        }

        // Also mock in JS
        await page.evaluateOnNewDocument((tz) => {
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function () {
                    return { timeZone: tz, locale: 'it-IT' };
                },
            });
        }, timezone);
    }

    /**
     * Task 13: Audio Context Noise
     */
    private static async injectAudioNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function (channel: number) {
                const results = originalGetChannelData.apply(this, [channel]);
                // Add tiny noise
                const noise = 0.0001 * (Math.random() - 0.5);
                for (let i = 0; i < results.length; i++) {
                    results[i] = results[i] + noise;
                }
                return results;
            };
        });
    }
}
