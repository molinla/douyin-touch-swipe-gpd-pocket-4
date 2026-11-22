# 开发工具

这些工具通过 Playwright 在 Chrome 中打开抖音网页版，适合复现触控问题和检查页面结构。需要 Node.js 20 或以上以及已安装的 Google Chrome。可以用 `npm install` 安装依赖，也可以用 `pnpm install --frozen-lockfile` 按仓库内的锁定版本安装。

## 触控回归

在仓库根目录按需逐个运行。浏览器测试共用 `.local/douyin-test-profile/`，请在关闭上一项测试的浏览器后再运行下一项。抖音的页面、登录提示和推荐内容会影响结果，直播用例尤其依赖推荐流是否出现真实直播卡片。

| 命令 | 检查内容 |
| --- | --- |
| `npm run test:audio` | 在 Chrome 测试页面验证自动开声、浏览器拦截后的恢复和手动静音 |
| `npm run test:touch` | 上下切换、松手动画、短划、双指、长按倍速和鼠标行为 |
| `npm run test:live` | 直播卡片上下切换和长按行为 |
| `npm run test:comments` | 左滑打开、右滑关闭和评论列表滚动 |
| `npm run test:sidebar` | 默认折叠、点击展开、布局、刷新和路由切换 |
| `npm run test:fullscreen` | 网页全屏与原生全屏下的切换、评论和底部控件自动隐藏 |

给全屏用例设置环境变量 `DOUYIN_SEEK=1` 可检查触控拖动进度，设置 `DOUYIN_SEEK_CANCEL=1` 可检查上滑取消。PowerShell 中可先运行 `$env:DOUYIN_SEEK = '1'`，再执行 `npm run test:fullscreen`。如需调试另一个版本，可以用 `DOUYIN_TEST_SCRIPT` 指定 `test:touch` 加载的文件。

## 页面检查

直接运行 `node tooling/inspect.cjs`、`node tooling/inspect-track.cjs`、`node tooling/inspect-sidebar.cjs`、`node tooling/inspect-comments.cjs` 或 `node tooling/inspect-fullscreen.cjs`。这些脚本会在终端输出结构和状态，截图保存在 `.local/artifacts/`。终端输出和截图可能包含当前页面内容，分享前请先检查。

## 本机诊断

1. 运行 `npm run diag:build`。脚本会生成 `.local/douyin-touch-swipe.debug.user.js` 和本次诊断用的本地配置。
2. 在另一个终端运行 `npm run diag:serve`，启动只监听 `127.0.0.1:17846` 的接收服务。
3. 在油猴中停用发布版，安装生成的诊断版并在抖音推荐页复现手势。诊断日志会写到 `.local/douyin-diagnostics.ndjson`。
4. 结束后按 Ctrl+C 停止服务，停用诊断版并重新启用发布版。

`.local/` 已加入 Git 忽略规则。测试浏览器资料、诊断配置、生成的诊断脚本、截图和日志都保留在本机。
