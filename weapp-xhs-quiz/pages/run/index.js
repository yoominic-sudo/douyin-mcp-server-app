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

const QUIZ_BANK = {
  chuangye: [
    { q: "行业波动时你第一反应？", a: ["稳住岗位", "观望再动", "直接试错"] },
    { q: "你更看重什么？", a: ["稳定现金流", "成长空间", "规模化收益"] },
    { q: "面对失败你会？", a: ["止损", "复盘迭代", "加码冲刺"] }
  ],
  city_persona: [
    { q: "你更喜欢的生活节奏？", a: ["慢一点", "平衡", "快节奏"] },
    { q: "你对消费压力的接受度？", a: ["低", "中", "高"] },
    { q: "你更希望城市提供？", a: ["生活感", "平衡机会", "高密度机会"] }
  ]
};

const IDEA_TEMPLATES = [
  "{topic}普通人也能做：3步起号法",
  "我用7天验证了{topic}，结果太真实",
  "做{topic}一定要避开的3个坑",
  "{topic}从0到1的内容框架",
  "2026年{topic}还值不值得做？"
];

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
    result: "",
    toolInput: "",
    toolOutput: "",
    ideaTopic: "副业",
    ideaList: []
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
    this.setData({ started: true, finished: false, lockState: false, quota: data.quota, idx: 0, score: 0, result: "", toolOutput: "", ideaList: [] });
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

  onInputTool(e) {
    this.setData({ toolInput: e.detail.value });
  },

  onTopicInput(e) {
    this.setData({ ideaTopic: e.detail.value });
  },

  async runDouyinTool() {
    const text = (this.data.toolInput || "").trim();
    if (!text) {
      wx.showToast({ title: "先输入分享文案或链接", icon: "none" });
      return;
    }
    const data = await req("/api/video/info", "POST", { url: text, api_key: "" });
    if (!data.success) {
      wx.showToast({ title: data.error || "解析失败", icon: "none" });
      return;
    }
    this.setData({ toolOutput: `${data.title}\n${data.download_url}` });
  },

  genIdeas() {
    const topic = (this.data.ideaTopic || "副业").trim();
    const list = IDEA_TEMPLATES.map((t) => t.replace("{topic}", topic));
    this.setData({ ideaList: list });
  },

  answer(e) {
    const { appKey, idx } = this.data;
    const bank = QUIZ_BANK[appKey] || QUIZ_BANK.chuangye;
    const v = Number(e.currentTarget.dataset.v || 0);
    const nextIdx = idx + 1;
    const score = this.data.score + v;
    if (nextIdx >= bank.length) {
      this.finishQuiz(score);
      return;
    }
    this.setData({ idx: nextIdx, score });
  },

  finishQuiz(score) {
    const { appKey } = this.data;
    let result = "你更偏向平衡路线";
    if (appKey === "chuangye") {
      if (score <= 4) result = "稳健打工进阶型";
      else if (score >= 7) result = "创业增长型";
      else result = "职场创业双修型";
    } else {
      if (score <= 4) result = "烟火生活型城市人格";
      else if (score >= 7) result = "高机会密度型城市人格";
      else result = "平衡成长型城市人格";
    }
    this.setData({ finished: true, started: false, result, score });
  },

  onShareAppMessage() {
    const { title, result } = this.data;
    if (result) {
      return { title: `${title}：我测出「${result}」`, path: "/pages/index/index" };
    }
    return { title: "来测测你的职业/城市人格", path: "/pages/index/index" };
  },

  async resetRun() {
    this.setData({ started: false, finished: false, idx: 0, score: 0, result: "", toolOutput: "", ideaList: [] });
    await this.refreshStatus();
  }
});
