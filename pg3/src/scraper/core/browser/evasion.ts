
import { Page } from 'puppeteer';

export class BrowserEvasion {
    public static async apply(page: Page): Promise<void> {
        // Pass the Webdriver Test
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        // Mock Chrome
        await page.evaluateOnNewDocument(() => {
            // @ts-ignore
            window.chrome = {
                runtime: {},
                // @ts-ignore
                loadTimes: function () { },
                // @ts-ignore
                csi: function () { },
                // @ts-ignore
                app: {}
            };
        });

        // Mock Permissions
        await page.evaluateOnNewDocument(() => {
            const originalQuery = window.navigator.permissions.query;
            // @ts-ignore
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission } as PermissionStatus) :
                    originalQuery(parameters)
            );
        });

        // Mock Plugins
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
        });

        // Hardware Concurrency
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 4,
            });
        });
    }
}
