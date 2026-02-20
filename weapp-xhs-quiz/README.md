# weapp-xhs-quiz

微信小程序版：2026 打工型还是创业型（首次免费 + 激励广告解锁）

## 1. 导入

- 打开微信开发者工具
- 导入目录：`weapp-xhs-quiz`
- 把 `project.config.json` 里的 `appid` 改成你自己的小程序 AppID

## 2. 后端域名白名单

在小程序后台添加合法 request 域名：

- `https://app.yoominic.cn`

## 3. 激励广告位

在小程序后台创建激励视频广告位，拿到 `adunit-xxxx`。

然后到服务器配置：

`/opt/douyin-mcp-server-app/.env.xhs.local`

```env
WEAPP_REWARDED_AD_UNIT_ID=adunit-xxxx
QUIZ_AD_UNLOCK_SECRET=随机高强度密钥
QUIZ_AD_DEMO=false
```

重启服务：

```bash
systemctl restart douyin-app
```

## 4. 真实广告回调

本小程序直接用 `wx.createRewardedVideoAd`。

- 看完广告后，前端调用后端 `/api/quiz/unlock-ad-verify`
- 后端用 ticket+signature 校验并发放次数

## 5. 本地测试

- 真机调试广告能力（开发者工具不完全模拟）
- 可先把 `QUIZ_AD_DEMO=true` 验证流程
