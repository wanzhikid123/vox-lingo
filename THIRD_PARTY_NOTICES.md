# Emoji Assets and Data

[简体中文](THIRD_PARTY_NOTICES.zh-CN.md)

- **Twemoji**: graphics by Twitter, Inc. and contributors, see the [project](https://github.com/jdecked/twemoji). Graphics are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and served unchanged from local SVG files. Packaging/optimization by Samuel Kopp is MIT licensed; see `node_modules/@twemoji/svg/license`. This project pins `@twemoji/svg@15.0.0`.
- **Emojibase data**: by Miles Johnson and contributors, see the [project](https://github.com/milesj/emojibase) and [datasets](https://emojibase.dev/docs/datasets/). MIT license: `node_modules/emojibase-data/LICENSE`. The server uses English, German, Chinese, Japanese, Korean, French and Spanish labels from `emojibase-data@17.0.0`; only entries with available local SVGs are exposed.

Emoji are served locally under `/assets/emoji/`, without a browser request to an external emoji CDN. `npm ci` restores pinned dependencies. Upstream license texts are not translated or modified.
