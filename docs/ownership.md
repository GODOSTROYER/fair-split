# Path ownership by workstream (decision register §11)

| WS         | Owned paths                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------- |
| WS-CORE    | packages/contracts, packages/domain, packages/seed                                            |
| WS-DATA    | packages/db, packages/outbox                                                                  |
| WS-PPCORE  | packages/paypal-core, apps/api/src/webhooks/**, tools/setup-webhooks.ts                       |
| WS-PPMONEY | packages/paypal-toolkit, packages/paypal-payouts                                              |
| WS-READ    | packages/ai/src/{gateway,read,ratecard,classify}/**, packages/eval                            |
| WS-AGENT   | packages/ai/src/{agent,explain}/**                                                            |
| WS-API     | apps/api/** (except webhooks), packages/api-client                                            |
| WS-OPS     | apps/tasks, render.yaml, tools/** (except paths owned elsewhere)                              |
| WS-DS      | packages/{tokens,motion,seal,ui-web,ui-native,i18n}, assets/**, apps/console/src/prototype/** |
| WS-CONSOLE | apps/console/** (except prototype)                                                            |
| WS-APP     | apps/mobile/**, eas.json                                                                      |
| WS-QA      | .github/**, packages/test-kit, e2e/**, postman/**, docs/**, README and repo hygiene files     |
| WS-MEDIA   | media/**, video/**, tools/{tts,imagegen}.ts                                                   |
