
export class ProxyManager {
    private static proxies: string[] = [];
    private static currentIndex = 0;

    public static getProxy(): string | undefined {
        if (this.proxies.length === 0) return undefined;
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }

    public static loadProxies(list: string[]) {
        this.proxies = list;
    }
}
