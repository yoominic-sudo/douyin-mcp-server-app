const app = getApp();

function req(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBase}${path}`,
      method: "GET",
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

const CATEGORIES = [
  {
    name: "实用工具",
    items: [
      { key: "douyin_tool", title: "抖音无水印下载助手", desc: "链接解析效率工具", icon: "🛠" },
      { key: "content_idea", title: "爆款选题生成器", desc: "10秒给你选题方向", icon: "💡" }
    ]
  },
  {
    name: "人格测评",
    items: [
      { key: "chuangye", title: "2026 打工型还是创业型", desc: "首次免费，后续看广告", icon: "🧭" },
      { key: "city_persona", title: "你的城市人格", desc: "测你更适合哪座城", icon: "🏙" }
    ]
  }
];

Page({
  data: {
    categories: CATEGORIES,
    quotaMap: {},
    deviceId: ""
  },

  async onLoad() {
    const deviceId = wx.getStorageSync("quiz_device_id") || `wx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    wx.setStorageSync("quiz_device_id", deviceId);
    this.setData({ deviceId });
    await this.loadQuota();
  },

  async loadQuota() {
    const { deviceId } = this.data;
    const flat = CATEGORIES.flatMap((c) => c.items);
    const entries = await Promise.all(flat.map(async (it) => {
      const q = await req(`/api/quiz/quota/${it.key}/${deviceId}`);
      return [it.key, q];
    }));
    const quotaMap = Object.fromEntries(entries);
    this.setData({ quotaMap });
  },

  openApp(e) {
    const { key, title } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/run/index?appKey=${key}&title=${encodeURIComponent(title)}` });
  }
});
