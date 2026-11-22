# 抖音触屏优化GPD Pocket 4专版

给 GPD Pocket 4 的抖音网页版「推荐」页补上触屏手势。适合直接用手指刷视频、看评论和拖动进度条。

## 安装

1. 在浏览器里启用 [Tampermonkey（油猴）](https://www.tampermonkey.net/)。
2. 从 [Greasy Fork](https://greasyfork.org/zh-CN/scripts/606703) 或 [GitHub](https://raw.githubusercontent.com/molinla/douyin-touch-swipe-gpd-pocket-4/main/douyin-touch-swipe.user.js) 打开脚本，在油猴的确认页点击「安装」。
3. 打开[抖音推荐页](https://www.douyin.com/?recommend=1&from_nav=1)。如果进入了「精选」，点左侧的「推荐」。

从测试版迁移时，请先停用油猴中原来的「抖音推荐 · 触屏上下滑切视频」，再启用本发布版。

从 Greasy Fork 安装发布版后，油猴可以定期检查新版。开启油猴的自动安装更新后，发布新版时会沿用原脚本条目。

## 手势

| 操作 | 效果 |
| --- | --- |
| 在视频或直播预览画面上下滑 | 上滑下一条，下滑上一条。画面跟随手指，短划会回弹。 |
| 在视频画面左滑 | 打开评论区。 |
| 在视频画面或评论列表右滑 | 关闭已打开的评论区。评论列表内上下滑可以滚动评论。 |
| 长按普通视频画面两侧或右侧的评论、收藏、头像 | 画面两侧各约 20% 为长按区。临时切到 2 倍速，松手恢复原速。短按右侧按钮仍执行原来的操作。 |
| 在底部进度条附近左右拖动 | 触控命中高度约为原来的 1.8 倍。拖动时显示较粗的粉红色进度条、圆点和目标时间，松手跳转。 |
| 拖动进度时向上滑 | 看到「松手取消」后放手可保留原进度，滑回进度条附近可继续选位置。 |

「推荐」页默认收起左侧导航，点左上角按钮可展开。抖音的「全屏」和「网页全屏」都可以上下滑切换。全屏空闲 3 秒后会隐藏进度条、底部视频信息和右侧操作按钮，开启或关闭「清屏」时都生效。触摸或移动鼠标可重新显示。

进入推荐页时，脚本会尝试解除当前视频的默认静音。浏览器要求先有用户操作时，第一次触摸或按键会再尝试开声。手动静音仍然有效。

## 适用范围

面向 Windows 触屏设备上的抖音网页版和 Tampermonkey，已在 Chrome 的实际推荐页用 Playwright 模拟触屏测试。脚本声明 `@grant none`，由浏览器本地处理手势。

遇到问题时，可以在 [GitHub Issues](https://github.com/molinla/douyin-touch-swipe-gpd-pocket-4/issues) 附上浏览器版本、设备、触发手势和复现步骤。

## 开发与版本归档

仓库根目录的 `douyin-touch-swipe.user.js` 是编辑入口和 Greasy Fork 的同步源。[release/](release/) 保存各版本的发布快照。[开发工具说明](tooling/README.md) 包含 Playwright 测试、页面检查和触控诊断的用法。
