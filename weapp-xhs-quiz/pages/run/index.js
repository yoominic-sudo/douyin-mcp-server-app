const app = getApp();

function req(path, method = "GET", data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBase}${path}`,
      method,
      data,
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

const BANK = {
  default: [
    { q: "你更喜欢哪种工作状态？", a: ["稳定流程", "自由尝试", "高速冲刺"] },
    { q: "面对不确定收入，你的感受是？", a: ["压力很大", "可接受", "很兴奋"] },
    { q: "你更在意什么？", a: ["稳定现金流", "成长空间", "规模回报"] }
  ]
};

Page({
  data: {
    appKey: "",
    title: "",
    started: false,
    finished: false,
    lockState: false,
    quota: { free_remaining: 1, ad_credits: 0, can_play: true },
    adConfig: { enabled: false, ad_unit_id: "", demo_mode: false },
    idx: 0,
    score: 0,
    result: ""
  },

  deviceId: "",

  async onLoad(options) {
    const appKey = options.appKey || "chuangye";
    const title = decodeURIComponent(options.title || "应用");
    this.deviceId = wx.getStorageSync("quiz_device_id");
    this.setData({ appKey, title });
    wx.setNavigationBarTitle({ title });
    await this.refreshStatus();
  },

  async refreshStatus() {
    const { appKey } = this.data;
    const [quota, adConfig] = await Promise.all([
      req(`/api/quiz/quota/${appKey}/${this.deviceId}`),
      req("/api/quiz/ad-config")
    ]);
    this.setData({ quota, adConfig, lockState: !quota.can_play });
  },

  async startRun() {
    const { appKey } = this.data;
    const data = await req("/api/quiz/consume", "POST", { device_id: this.deviceId, app_key: appKey });
    if (!data.success) {
      this.setData({ lockState: true });
      return;
    }
    this.setData({ started: true, finished: false, lockState: false, quota: data.quota, idx: 0, score: 0, result: "" });
  },

  async unlockByAd() {
    const { adConfig, appKey } = this.data;
    if (!adConfig.ad_unit_id) {
      wx.showToast({ title: "先配置广告位ID", icon: "none" });
      return;
    }
    const ticket = await req("/api/quiz/ad-ticket", "POST", { device_id: this.deviceId, app_key: appKey });
    if (!ticket.success) {
      wx.showToast({ title: ticket.error || "票据失败", icon: "none" });
      return;
    }

    const rewarded = wx.createRewardedVideoAd({ adUnitId: adConfig.ad_unit_id });
    rewarded.onClose(async (res) => {
      if (!(res && res.isEnded)) {
        wx.showToast({ title: "需看完广告", icon: "none" });
        return;
      }
      const verify = await req("/api/quiz/unlock-ad-verify", "POST", {
        device_id: this.deviceId,
        app_key: appKey,
        ticket_id: ticket.ticket_id,
        signature: ticket.signature
      });
      if (verify.success) {
        this.setData({ quota: verify.quota, lockState: false });
        wx.showToast({ title: "解锁成功", icon: "success" });
      } else {
        wx.showToast({ title: verify.error || "校验失败", icon: "none" });
      }
    });
    rewarded.show().catch(() => rewarded.load().then(() => rewarded.show()));
  },

  answer(e) {
    const v = Number(e.currentTarget.dataset.v || 0);
    const idx = this.data.idx + 1;
    const score = this.data.score + v;
    if (idx >= BANK.default.length) {
      let result = "你更偏向平衡路线";
      if (score <= 4) result = "你更偏向稳健打工路线";
      if (score >= 7) result = "你更偏向创业增长路线";
      this.setData({ finished: true, started: false, result, score, idx });
      return;
    }
    this.setData({ idx, score });
  },

  async resetRun() {
    this.setData({ started: false, finished: false, idx: 0, score: 0, result: "" });
    await this.refreshStatus();
  }
});
