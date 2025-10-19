const cutoff = Date.parse('2025-10-19T09:24:48Z');

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
