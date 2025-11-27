const cutoff = Date.parse('2025-11-26T09:24:48Z');

module.exports = {
    hooks: {
        updateConfig(config) {
            return {
                ...config,
                minimumReleaseAge: Math.max(
                    0,
                    Math.ceil((Date.now() - cutoff) / 60_000) + 1
                ),
            };
        },
    },
};
