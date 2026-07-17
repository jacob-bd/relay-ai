# Contributing to Relay AI

Thanks for taking the time to improve Relay AI. Focused pull requests are much easier to review, test, and merge, so please follow these guidelines before submitting changes.

## Before you start

- Search existing issues and pull requests for related work.
- Start from the latest `main` branch.
- Open an issue before beginning security-sensitive work involving authentication, credentials, proxies, networking, or modifications to installed third-party applications.
- Ask for maintainer agreement before starting a change expected to exceed 1,000 human-written lines or 20 source, test, or documentation files. Generated files and lockfiles do not count toward these numbers.

## Keep each pull request focused

- Submit one feature or fix per pull request.
- Do not bundle unrelated refactors, dependency migrations, UI work, or runtime upgrades with a feature.
- Split independent changes into separate pull requests, even when they were developed on the same branch.
- If a reviewer cannot test or revert a change independently, it probably belongs in a separate pull request.

Maintainers may close an oversized or mixed-scope pull request and ask for smaller submissions. This is about giving each contribution a fair and timely review, not rejecting the underlying ideas.

## Generated files

Do not edit or commit `dist/` files in a contributor pull request. Maintainers will regenerate release bundles from the accepted source changes.

Commit dependency lockfile changes only when the pull request intentionally changes dependencies.

## Quality requirements

Before submitting:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Your pull request should include:

- A plain-language explanation of the problem and the proposed change.
- Focused tests for new behavior and bug fixes.
- Any user-facing documentation affected by the change.
- Known limitations, compatibility concerns, and security implications.
- Screenshots for visible UI changes.

Please preserve authorship and link the original issue or pull request when adapting another contributor's work.

## Review expectations

Reviewers may ask you to reduce scope, rebase onto current `main`, add tests, or separate risky platform changes from user-facing features. Address those requests in the same focused branch without adding unrelated work.

Thank you for helping make Relay AI better.
