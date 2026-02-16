/**
 * Re-export from enricher's canonical UA database.
 * Kept for backward compatibility with scraper imports.
 */
export {
    UA_DATABASE,
    USER_AGENTS,
    getRandomUserAgent,
    getWeightedRandomUA,
    buildClientHints,
    WEBGL_PROFILES,
    VIEWPORT_PRESETS,
    LOCALE_CONFIGS,
    SPEECH_VOICES,
} from '../../../enricher/core/browser/ua_db';

export type {
    UAEntry,
    ClientHintsData,
    WebGLProfile,
    ViewportPreset,
    LocaleConfig,
} from '../../../enricher/core/browser/ua_db';
