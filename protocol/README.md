# @mihe-dev/protocol

The wire types shared by the Mihe runtime and [`@mihe-dev/react`](https://www.npmjs.com/package/@mihe-dev/react):
messages, commands, screen context, action and workflow definitions.

You don't usually install this yourself. `@mihe-dev/react` depends on it, and its
types are re-exported where an integration needs them. Install it directly
only if you're building your own client for the Mihe protocol.

The types are generated from the runtime's Rust definitions, so they always
match what the runtime sends and accepts. Don't edit them by hand.

[Documentation](https://mihe.dev/docs)

## License

MIT © Neek Digital Solutions Ltd
