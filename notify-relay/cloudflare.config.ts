import { bindings, defineConfig, triggers } from 'cf/config';

export default defineConfig({
  accountId: 'd47990d8be8da7136b8f22f8ab360194',
  worker: {
    name: 'aries-notify',
    compatibilityDate: '2026-10-28',
    compatibilityFlags: ['nodejs_compat'],
    entrypoint: 'src/index.ts',
    domains: ['notify.aries.shiroel.com'],
    observability: { enabled: true, headSamplingRate: 0.1 },
    triggers: [triggers.scheduled({ schedule: '*/15 * * * *' })],
    env: {
      DB: bindings.d1({
        name: 'aries-notify',
        id: '4fa5c576-d2e6-4c73-9006-76505724bf36',
      }),
      LIMITER: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 60, period: 60 },
      }),
    },
  },
});
