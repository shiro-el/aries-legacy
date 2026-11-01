const { execFileSync } = require('node:child_process');
const { version } = require('./scripts/app-version.cjs');

const DEFAULT_NOTIFY_RELAY_URL = 'https://notify.aries.shiroel.com';
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;
const DISTRIBUTION_CHANNELS = new Set(['app-store', 'google-play', 'github']);

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function distributionChannel(value) {
  const candidate = optionalString(value);
  return candidate && DISTRIBUTION_CHANNELS.has(candidate) ? candidate : null;
}

function optionalHttpsUrl(value) {
  const candidate = optionalString(value);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

function resolveGitCommit() {
  const environmentCommit = [
    process.env.WHIP_GIT_COMMIT,
    process.env.GITHUB_SHA,
    process.env.EAS_BUILD_GIT_COMMIT_HASH,
  ].find(value => value && COMMIT_PATTERN.test(value.trim()));

  if (environmentCommit) {
    return environmentCommit.trim();
  }

  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return COMMIT_PATTERN.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

module.exports = ({ config }) => {
  const gitCommit = resolveGitCommit();

  return {
    ...config,
    version,
    android: {
      ...config.android,
      ...(process.env.WHIP_GOOGLE_SERVICES_JSON ? {googleServicesFile: process.env.WHIP_GOOGLE_SERVICES_JSON} : {}),
    },
    extra: {
      ...config.extra,
      ...(gitCommit ? { gitCommit } : {}),
      notifyRelayUrl: optionalHttpsUrl(process.env.WHIP_NOTIFY_RELAY_URL) || DEFAULT_NOTIFY_RELAY_URL,
      distributionChannel: distributionChannel(
        process.env.WHIP_DISTRIBUTION_CHANNEL,
      ),
    },
  };
};
