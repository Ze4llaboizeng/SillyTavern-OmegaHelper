export const MODULE_NAME = 'omegaHelper';
export const EXT_ID = 'omega-helper';
export const LOG = '[OmegaHelper]';
export const VERSION = '1.6.3';

/** Update this block together with the extension whenever Omega ships a JB patch. */
export const PATCH_NOTICE = {
    id: 'gemini-omega-2.6-2026-08-15',
    title: 'Gemini Omega 2.6',
    version: '2.6',
    fileName: 'Gemini Omega 2.6 (15-8-26)',
    sourceUrl: 'https://discord.com/channels/1325303011702079560/1455967291790331978/1537440603019808869',
};

export const DEFAULTS = {
    enabled: true,
    showQuickButton: true,
    showWandButton: true,
    closeOnEscape: true,
    reloadChatAfterToggle: true,
    collapsedGroups: {},
    profiles: [],
    lastProfileId: null,
    activeTab: 'features', // features | regex
    alerts: true,            // popup notifications
    watchReasoning: true,    // inspect each message's native reasoning block
    checkFormatting: true,   // check Reasoning Formatting vs model
    autoFixFormatting: false,
};

/** The reasoning template Omega/5EX presets expect. Both fields, both model rules. */
export const REASONING_TEMPLATE = { prefix: '<planning>', suffix: '</planning>' };

/** Only these preset families use the planning block. Anything else: stay out. */
export const SUPPORTED_PRESET = /omega|5\s*ex|5ex/i;

/** Omega infrastructure prompts that must be enabled before every real generation. */
export const REQUIRED_PROMPT_PATTERNS = [
    /^sigil\s+(?:fence|clock|stage|facts)\s+cut\s*\(display\)$/i,
    /^sigil\s+normalize\s+(?:clk|stg|fact)\s*\(prompt\)$/i,
    /^sigil\s+trim\s+(?:clk|stg|fact)\s*\(prompt\)$/i,
    /^sigil\s+auto[-\s]fence\s+wrap\s*\(prompt\)$/i,
    /^sigil\s+(?:fence|clock|stage|facts)\s+cut[-\s]off\s*\(prompt\)$/i,
];

/**
 * Reasoning Formatting rules per model family.
 * prefill  = Start Reply With must hold the reasoning prefix + show prefix in chat ON
 *            (gemini 3.5 flash / 3.1 pro and older)
 * noPrefill = Start Reply With empty + show prefix in chat OFF
 *            (gemini 3.5 flash-lite, 3.6 flash and newer)
 */
export const MODEL_RULES = {
    prefill: {
        id: 'prefill',
        label: 'Prefill (3.5 flash / 3.1 pro ลงมา)',
        startReplyWith: 'prefix',
        showPrefix: true,
    },
    noPrefill: {
        id: 'noPrefill',
        label: 'No prefill (3.5 flash-lite / 3.6 flash ขึ้นไป)',
        startReplyWith: '',
        showPrefix: false,
    },
};
