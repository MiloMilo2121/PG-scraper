/**
 * 🛡️ OMEGA V9: THE NETWORK CLOAK INTERFACE
 * Task 1.3: Abstraction layer for bridging Node.js with the underlying Go/Rust network engine.
 * 
 * WHY: Node.js (and the V8 engine) operates with an unstable JA3/JA4 fingerprint
 * and cannot reliably impersonate modern browsers' TLS/HTTP2 framing at a packet level.
 * Therefore, we define an interface that a theoretical local Rust (wreq) or Go (httpcloak)
 * microservice will implement.
 */

import { ProxyTier } from '../../shared-runtime/network/proxy_tier_v9';

export interface ICloakHeaders {
    [key: string]: string;
}

export interface ICloakRequest {
    /** Target URL */
    url: string;
    /** HTTP Method */
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
    /** Raw headers exactly as they should be sent (order matters for HTTP/2 profiling) */
    headers?: ICloakHeaders;
    /** Optional JSON or Raw text payload */
    body?: string | Record<string, any>;
    /** The specific target fingerprint for the handshake (e.g. 'chrome_120_windows', 'safari_ios') */
    ja4ImpersonationProfile: string;
    /** Enforces the routing of this request through a specific Proxy Tier */
    proxyTierRequest: ProxyTier;
    /** Connection timeout in milliseconds */
    timeoutMs?: number;
}

export interface ICloakResponse<T = any> {
    /** HTTP Status Code */
    status: number;
    /** Response headers */
    headers: ICloakHeaders;
    /** Response body, parsed if possible */
    data: T;
    /** 
     * Network timing telemetry for logging and jitter adjustments.
     * Expressed in milliseconds.
     */
    telemetry: {
        rtt: number;
        tlsHandshakeDuration: number;
    };
    /** True if the request was blocked by a WAF (HTTP 403, 429, or specific injected headers) */
    wafIntercepted: boolean;
}

/**
 * The standard contract for executing pure-HTTP requests (bypassing headless browsers)
 * with mathematically perfect TLS and TCP fingerprints.
 */
export interface INetworkCloak {
    /**
     * Executes a stealth request.
     * Under the hood, this will likely serialize the ICloakRequest and pass it via gRPC
     * or local UNIX socket to the Go/Rust engine running in the Padova Data Center.
     */
    execute<T = any>(request: ICloakRequest): Promise<ICloakResponse<T>>;

    /**
     * Pings the internal proxy and engine to compute the current local latency 
     * to the VSIX/MIX hubs.
     */
    ping(): Promise<number>;
}
