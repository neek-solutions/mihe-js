# @mihe-dev/react

Mihe is an assistant you embed in your React app. It knows your screens,
components and actions, and it operates the app for your users, under your
own permission model: it finds things, opens screens, fills in and points
at forms, and runs actions, asking for approval wherever you say it must.
Users can type or talk to it.

## Install

```bash
npm install @mihe-dev/react
```

React 18 or later. The package is ES modules with TypeScript types, and it
marks itself `"use client"`, so it works in Next.js App Router, Vite and
other bundlers without extra configuration.

## A first integration

```tsx
import { AssistantProvider, AssistantWidget, useAssistantScreen } from "@mihe-dev/react";

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <AssistantProvider
      url="wss://runtime.mihe.dev/v1/ws"
      publicKey={process.env.NEXT_PUBLIC_MIHE_PUBLIC_KEY!}
      // Your server mints this token for the signed-in user, signed with
      // your app secret. It carries who they are and what they may do.
      getUserToken={() => fetch("/api/mihe/token").then((r) => r.text())}
      navigate={(route) => router.push(route)}
    >
      {children}
      <AssistantWidget />
    </AssistantProvider>
  );
}

function OrdersPage() {
  // Tell the assistant where the user is and what they can see.
  useAssistantScreen({
    screenId: "orders.list",
    route: "/orders",
    title: "Orders",
    visibleData: { pending: 16 },
  });
  // …
}
```

Create an app and its keys in the [dashboard](https://app.mihe.dev), then
follow the [quickstart](https://mihe.dev/docs/quickstart).

## Documentation

- [Quickstart](https://mihe.dev/docs/quickstart)
- [Screens and components](https://mihe.dev/docs/screens-and-components):
  what the assistant can see and point at
- [Actions](https://mihe.dev/docs/actions) and
  [permissions and risk](https://mihe.dev/docs/permissions-and-risk):
  what it can do, and what needs approval
- [User tokens](https://mihe.dev/docs/user-tokens)
- [The widget](https://mihe.dev/docs/widget) and [voice](https://mihe.dev/docs/voice)
- [SDK reference](https://mihe.dev/docs/sdk-reference)

## License

MIT © Neek Digital Solutions Ltd
