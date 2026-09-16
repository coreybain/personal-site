export type ManagementEnvironment = 'development' | 'production';

export interface ManagementConfig {
  endpoint: string;
  environment: ManagementEnvironment;
  token: string;
  timeoutMs: number;
}

/** Configuration errors intentionally never include an environment value. */
export class ConfigurationError extends Error {}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ManagementConfig {
  const rawUrl = env.HOME_MANAGEMENT_URL;
  if (!rawUrl) throw new ConfigurationError('HOME_MANAGEMENT_URL is required.');

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigurationError('HOME_MANAGEMENT_URL must be a valid HTTPS origin.');
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConfigurationError('HOME_MANAGEMENT_URL requires HTTPS except on loopback.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new ConfigurationError('HOME_MANAGEMENT_URL must be an origin without credentials, path, query or fragment.');
  }

  const environment = env.HOME_MANAGEMENT_ENVIRONMENT;
  if (environment !== 'development' && environment !== 'production') {
    throw new ConfigurationError('HOME_MANAGEMENT_ENVIRONMENT must explicitly be development or production.');
  }

  const token = env.HOME_MANAGEMENT_TOKEN;
  if (!token || !/^mgmt_[a-f0-9]{64}$/.test(token)) {
    throw new ConfigurationError('HOME_MANAGEMENT_TOKEN must be a valid management credential.');
  }

  return {
    endpoint: new URL('/management/v1', url.origin).href,
    environment,
    token,
    timeoutMs: 20_000,
  };
}
