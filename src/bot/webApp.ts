const DEFAULT_WEBAPP_URL = 'https://calbot-web-self.vercel.app';

export function getWebAppUrl(): string {
  return process.env.WEBAPP_URL ?? DEFAULT_WEBAPP_URL;
}
