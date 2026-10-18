# @mihe-dev/js

Mihe is an assistant you embed in your web app. It knows your screens,
components and actions, and it operates the app for your users, under your
own permission model: it finds things, opens screens, fills in and points
at forms, and runs actions, asking for approval wherever you say it must.
Users can type or talk to it.

This is the framework-free package: plain JavaScript or TypeScript, for Vue,
Svelte, Angular, server-rendered pages, or no framework at all. For React,
use `@mihe-dev/react`, which is built on this one.

## Install

```bash
npm install @mihe-dev/js
```

The package is ES modules with TypeScript types, and has no dependencies
beyond `@mihe-dev/protocol`.

No build step? It also ships as one self-contained file, for WordPress, a
server-rendered page or a plain `static/` folder:

```html
<script src="https://cdn.jsdelivr.net/npm/@mihe-dev/js@0.1.0/dist/mihe.iife.min.js"></script>
<script>
  const mihe = Mihe.createMihe({ url: "wss://runtime.mihe.dev/v1/ws", publicKey: "pk_live_…", getUserToken });
  Mihe.mountWidget(mihe);
</script>
```

`dist/mihe.min.js` is the same as an ES module. Pin the version in the URL,
or copy the file into your site.

## A first integration

```ts
import { createMihe } from "@mihe-dev/js";

const mihe = createMihe({
  url: "wss://runtime.mihe.dev/v1/ws",
  publicKey: "pk_live_…",
  // Your server mints this token for the signed-in user, signed with your
  // app secret. It carries who they are and what they may do.
  getUserToken: () => fetch("/api/mihe/token").then((r) => r.text()),
  navigate: (route) => { location.hash = route; },
  // Refetch what the page shows after the assistant changes data.
  onActionComplete: () => refresh(),
});

// On each page: tell the assistant where the user is and what they can see.
// Keep the returned function and call it when they leave.
const leave = mihe.setScreen({
  screenId: "orders.list",
  route: "/orders",
  title: "Orders",
  visibleData: { pending: 16 },
});
```

Every `set…` and `register…` method returns a function that removes what it
declared. Calling one again with the same id updates the declaration rather
than adding a second.

```ts
mihe.registerComponent(button, "orders.new", { type: "button", label: "New order" });
mihe.registerAction("print_receipt", ({ orderId }) => printReceipt(orderId));
mihe.registerTable({
  id: "orders.table",
  label: "Orders",
  columns: [{ key: "number", label: "Order" }, { key: "total", label: "Total" }],
  rows: orders,
  rowId: (order) => order.id,
  rowIdName: "orderId",
});
mihe.bindTrigger(document.querySelector("#ask")!);
```

The widget is `<mihe-assistant>`, a web component in its own shadow root,
so your page's CSS can't reach it:

```ts
import { mountWidget } from "@mihe-dev/js";

mountWidget(mihe);                                           // the orb
mountWidget(mihe, { form: "classic" });                      // launcher and panel
mountWidget(mihe, { layout: "inline", container: sidebar }); // the panel, in your layout
```

Theme it with `--mihe-accent`, `--mihe-radius` and `--mihe-font` on the
`mihe-assistant` element. If your page already has a floating widget in the
same corner, such as a support chat, lift Mihe above it:
`mountWidget(mihe, { offset: { bottom: 92 } })`.

Or draw your own UI. State is a snapshot you subscribe to:

```ts
mihe.subscribe(() => render(mihe.getState()));
mihe.send("How many orders are pending?");
```

Create an app and its keys in the [dashboard](https://app.mihe.dev), then
follow the [quickstart](https://mihe.dev/docs/quickstart).

## Documentation

- [Quickstart](https://mihe.dev/docs/quickstart)
- [SDK reference](https://mihe.dev/docs/sdk-reference)
- [Security](https://mihe.dev/docs/security): what the assistant can and
  cannot do, and why

## License

MIT © Neek Digital Solutions Ltd
