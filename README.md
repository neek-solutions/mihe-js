# Mihe JavaScript SDKs

[Mihe](https://mihe.dev) is an assistant you embed in your web app. It knows
your screens, components and actions, and it operates the app for your users,
under your own permission model: it finds things, opens screens, fills in and
points at forms, and runs actions, asking for approval wherever you say it
must. Users can type or talk to it.

| Package | For |
|---|---|
| [`@mihe-dev/js`](js) | Any web app: Vue, Svelte, Angular, server-rendered pages, or a page with no build step. Includes the widget as a web component. |
| [`@mihe-dev/react`](react) | React 18 and later. Built on `@mihe-dev/js`. |
| [`@mihe-dev/protocol`](protocol) | The wire types both use. You don't usually install it yourself. |

```bash
npm install @mihe-dev/react   # or @mihe-dev/js
```

Start with the [quickstart](https://mihe.dev/docs/quickstart). The
[JavaScript SDK](https://mihe.dev/docs/javascript) and
[React SDK reference](https://mihe.dev/docs/sdk-reference) cover each package.

## What runs where

These packages run in your users' browsers. They hold no secrets, and they
decide nothing about what the assistant may do: the Mihe runtime does that,
from the registry you publish and the user token your backend signs. An
approval card is drawn only from what the runtime sends, never from text the
model wrote, so content the model reads cannot change what a user approves.

## Developing

```bash
npm install
npm test            # vitest, in happy-dom
npm run typecheck
npm run build       # → dist-packages/, as published, plus @mihe-dev/js's single files
```

## License

MIT © Neek Digital Solutions Ltd
