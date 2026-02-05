/**
 * 🛡️ BROWSER EVASION v2
 * Complete anti-fingerprinting suite
 * 
 * Features:
 * - WebGL vendor spoofing
 * - Canvas noise injection
 * - WebRTC leak protection
 * - Timezone/Locale matching
 * 
 * NINJA CORE - Shared between PG1 and PG3
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
                loadTimes: function () { return { startLoadTime: Date.now() / 1000 }; },
                csi: function () { return { startE: Date.now(), onloadT: Date.now() }; },
                app: { isInstalled: false },
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
                    if (param === 37445) return vendor;
                    if (param === 37446) return renderer;
                    return Reflect.apply(target, ctx, args);
                },
            };
            const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);

            if (typeof WebGL2RenderingContext !== 'undefined') {
                const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
                WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
            }
        }, cfg.webglVendor || 'Apple Inc.', cfg.webglRenderer || 'Apple M1');
    }

    private static async injectCanvasNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function (type?: string) {
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
        });
    }

    private static async setTimezone(page: Page, cfg: EvasionConfig): Promise<void> {
        const timezone = cfg.timezone || 'Europe/Rome';
        try {
            const client = await (page as any)._client();
            if (client) {
                await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
            }
        } catch (e) { }

        await page.evaluateOnNewDocument((tz) => {
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function () {
                    return { timeZone: tz, locale: 'it-IT' };
                },
            });
        }, timezone);
    }

    private static async injectAudioNoise(page: Page): Promise<void> {
        await page.evaluateOnNewDocument(() => {
            const originalGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function (channel: number) {
                const results = originalGetChannelData.apply(this, [channel]);
                const noise = 0.0001 * (Math.random() - 0.5);
                for (let i = 0; i < results.length; i++) {
                    results[i] = results[i] + noise;
                }
                return results;
            };
        });
    }
}
