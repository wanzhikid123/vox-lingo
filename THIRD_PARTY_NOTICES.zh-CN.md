# Emoji 素材与数据

[English](THIRD_PARTY_NOTICES.md)

- **Twemoji**：图形由 Twitter, Inc. 及贡献者制作，见[项目](https://github.com/jdecked/twemoji)。采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可，作为未经修改的本地 SVG 提供。Samuel Kopp 的打包／优化采用 MIT 许可，见 `node_modules/@twemoji/svg/license`。本项目固定使用 `@twemoji/svg@15.0.0`。
- **Emojibase 数据**：由 Miles Johnson 及贡献者制作，见[项目](https://github.com/milesj/emojibase)和[数据集](https://emojibase.dev/docs/datasets/)。MIT 许可位于 `node_modules/emojibase-data/LICENSE`。服务端使用 `emojibase-data@17.0.0` 的英语、德语、中文、日语、韩语、法语及西班牙语标签，仅提供有本地 SVG 的条目。

Emoji 通过本地 `/assets/emoji/` 提供，浏览器不请求外部 Emoji CDN。`npm ci` 可恢复锁定版本依赖。第三方许可原文不翻译、不修改。
