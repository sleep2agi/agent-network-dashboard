# Agent 头像素材落地规则（设计侧对接）

1. 图片文件放本目录（`public/avatars/`）。建议 PNG/WebP、方图、≤300KB（渲染尺寸 ≤44px）。
2. 在 `manifest.json` 加一行：`"<agent 别名>": "/avatars/<文件名>"`（别名必须与 fleet 中完全一致，含中文）。
3. 跑 `npm run avatars:check` —— 0 error 即接入完成，**无需改任何代码**，全站 13 处头像面自动生效。
4. 通用插画池：`manifest.json` 的 `"_pool": ["/avatars/xx.webp", …]` 列出共享插画；没有专属条目的 agent 会按别名稳定哈希从池里分到一张（同一 agent 永远同一张）。新插画到货只需放文件 + 往 `_pool` 追加一行。
5. 未收录且池为空时回落到字母色圈；用户在节点设置里自设的 URL 优先级最高（高于专属条目和池）。
6. 源图太大时先压缩再入库（本批 1254px PNG ≈2MB → 256px WebP ≈7KB）：`node -e "require('sharp')(src).resize(256,256).webp({quality:82}).toFile(dst)"`。
