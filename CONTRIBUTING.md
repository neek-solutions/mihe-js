# Contributing

Thank you for helping. Issues are the most useful thing you can send: a bug
with the smallest page or component that shows it, or a gap you hit while
integrating.

Pull requests are welcome too. This repository is published from Mihe's main
codebase, so a merged change is applied there and arrives here with the next
release, credited to you. Small, focused changes with a test are the easiest
to take.

Before opening one:

```bash
npm install
npm test
npm run typecheck
```

Please don't send a change to `protocol/src/generated/`. Those types are
generated from the Mihe runtime's source; open an issue instead.

For anything security-related, see [SECURITY.md](SECURITY.md) rather than
opening a public issue.
