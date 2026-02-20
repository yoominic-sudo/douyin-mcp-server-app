const app = getApp();

const QUESTIONS = {
  q1: {
    group: "风险偏好",
    title: "如果 2026 行业突然波动，你第一反应是？",
    options: [
      { id: "A", text: "先保住当前岗位和现金流", score: { risk: 0, stability: 3 }, set: { risk: "low" }, next: "q2_stable" },
      { id: "B", text: "先观望，再决定是否转向", score: { risk: 1, stability: 2 }, set: { risk: "mid" }, next: "q2_mix" },
      { id: "C", text: "快速找新机会，准备切赛道", score: { risk: 3, growth: 2 }, set: { risk: "high" }, next: "q2_attack" }
    ]
  },
  q2_stable: {
    group: "职业选择",
    title: "你最看重的工作属性是？",
    options: [
      { id: "A", text: "五险一金+稳定晋升", score: { stability: 4 }, set: { role: "job" }, next: "q3_common" },
      { id: "B", text: "稳定中带一点创新空间", score: { stability: 3, growth: 1 }, set: { role: "mixed" }, next: "q3_common" },
      { id: "C", text: "高回报，不怕不稳定", score: { risk: 3, growth: 2 }, set: { role: "biz" }, next: "q3_common" }
    ]
  },
  q2_mix: {
    group: "职业选择",
    title: "对你来说，理想状态更像哪一种？",
    options: [
      { id: "A", text: "主业稳定，副业小步试错", score: { stability: 2, autonomy: 1 }, set: { role: "mixed" }, next: "q3_common" },
      { id: "B", text: "在公司内做核心项目并拿结果", score: { execution: 2, growth: 2 }, set: { role: "job" }, next: "q3_common" },
      { id: "C", text: "希望逐步过渡到自己做业务", score: { autonomy: 2, growth: 2 }, set: { role: "biz" }, next: "q3_common" }
    ]
  },
  q2_attack: {
    group: "职业选择",
    title: "如果让你选 2026 的主线，你会选？",
    options: [
      { id: "A", text: "快速搭建个人产品并验证", score: { autonomy: 3, execution: 2 }, set: { role: "biz" }, next: "q3_common" },
      { id: "B", text: "加入高增长团队借势起飞", score: { growth: 3, execution: 1 }, set: { role: "job" }, next: "q3_common" },
      { id: "C", text: "白天主业，夜晚搞项目", score: { resilience: 2, autonomy: 2 }, set: { role: "mixed" }, next: "q3_common" }
    ]
  },
  q3_common: {
    group: "执行力",
    title: "面对一个新机会，你通常会怎么做？",
    options: [
      { id: "A", text: "收集信息，做完整计划再动", score: { stability: 2, execution: 1 }, next: "q4_common" },
      { id: "B", text: "先做最小测试，边做边改", score: { execution: 3, growth: 1 }, next: "q4_common" },
      { id: "C", text: "先抢窗口，再补流程", score: { risk: 2, execution: 2 }, next: "q4_common" }
    ]
  },
  q4_common: {
    group: "抗压能力",
    title: "连续两周结果不理想，你会？",
    options: [
      { id: "A", text: "先停下，减少损失", score: { stability: 2, resilience: 1 }, nextBy: { role: { biz: "q5_biz", mixed: "q5_mixed", job: "q5_job" } } },
      { id: "B", text: "复盘后调整策略继续做", score: { resilience: 3, execution: 1 }, nextBy: { role: { biz: "q5_biz", mixed: "q5_mixed", job: "q5_job" } } },
      { id: "C", text: "拉更多资源，把局面打回来", score: { resilience: 2, autonomy: 2 }, nextBy: { role: { biz: "q5_biz", mixed: "q5_mixed", job: "q5_job" } } }
    ]
  },
  q5_job: {
    group: "组织协作",
    title: "你在团队里更像哪类角色？",
    options: [
      { id: "A", text: "流程稳定器：把事做稳", score: { stability: 3 }, next: "finish" },
      { id: "B", text: "推进器：拉齐资源拿结果", score: { execution: 3, growth: 1 }, next: "finish" },
      { id: "C", text: "创新者：不断提出新打法", score: { growth: 3, autonomy: 1 }, next: "finish" }
    ]
  },
  q5_mixed: {
    group: "双轨发展",
    title: "主业和副业冲突时你会怎么排优先级？",
    options: [
      { id: "A", text: "主业优先，副业保持续", score: { stability: 3, autonomy: 1 }, next: "finish" },
      { id: "B", text: "看阶段目标动态切换", score: { execution: 2, resilience: 2 }, next: "finish" },
      { id: "C", text: "副业冲刺，主业兜底", score: { autonomy: 3, risk: 2 }, next: "finish" }
    ]
  },
  q5_biz: {
    group: "创业决策",
    title: "你更愿意用哪种方式做创业起盘？",
    options: [
      { id: "A", text: "先小模型验证，再放大", score: { execution: 3, risk: 1 }, next: "finish" },
      { id: "B", text: "先做品牌声量，再导入产品", score: { growth: 3, autonomy: 2 }, next: "finish" },
      { id: "C", text: "重投放快起量，抢时间窗口", score: { risk: 3, execution: 2 }, next: "finish" }
    ]
  }
};

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

Page({
  data: {
    started: false,
    finished: false,
    lockState: false,
    quota: { free_remaining: 1, ad_credits: 0, can_play: true },
    adConfig: { enabled: false, ad_unit_id: "", demo_mode: false },
    currentQuestionId: "q1",
    currentQuestion: QUESTIONS.q1,
    progress: 0,
    answered: 0,
    result: null
  },

  branch: { risk: "mid", role: "mixed" },
  scores: { risk: 0, execution: 0, stability: 0, growth: 0, autonomy: 0, resilience: 0 },
  deviceId: "",

  async onLoad() {
    this.deviceId = wx.getStorageSync("quiz_device_id") || `wx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    wx.setStorageSync("quiz_device_id", this.deviceId);
    await this.refreshStatus();
  },

  async refreshStatus() {
    const [quota, adConfig] = await Promise.all([
      req(`/api/quiz/quota/${this.deviceId}`),
      req("/api/quiz/ad-config")
    ]);
    this.setData({ quota, adConfig, lockState: !quota.can_play });
  },

  async startQuiz() {
    const data = await req("/api/quiz/consume", "POST", { device_id: this.deviceId });
    if (!data.success) {
      this.setData({ lockState: true });
      return;
    }
    this.setData({ started: true, lockState: false, quota: data.quota });
  },

  async unlockByAd() {
    const { adConfig } = this.data;
    if (!adConfig.ad_unit_id) {
      wx.showToast({ title: "先配置广告位ID", icon: "none" });
      return;
    }

    const ticket = await req("/api/quiz/ad-ticket", "POST", { device_id: this.deviceId });
    if (!ticket.success) {
      wx.showToast({ title: ticket.error || "票据失败", icon: "none" });
      return;
    }

    const rewarded = wx.createRewardedVideoAd({ adUnitId: adConfig.ad_unit_id });
    rewarded.onError(() => wx.showToast({ title: "广告加载失败", icon: "none" }));
    rewarded.onClose(async (res) => {
      if (res && res.isEnded) {
        const verify = await req("/api/quiz/unlock-ad-verify", "POST", {
          device_id: this.deviceId,
          ticket_id: ticket.ticket_id,
          signature: ticket.signature
        });
        if (verify.success) {
          this.setData({ quota: verify.quota, lockState: false });
          wx.showToast({ title: "解锁成功", icon: "success" });
        } else {
          wx.showToast({ title: verify.error || "校验失败", icon: "none" });
        }
      } else {
        wx.showToast({ title: "需看完广告", icon: "none" });
      }
    });
    rewarded.show().catch(() => rewarded.load().then(() => rewarded.show()));
  },

  selectOption(e) {
    const idx = e.currentTarget.dataset.idx;
    const opt = this.data.currentQuestion.options[idx];
    Object.keys(opt.score || {}).forEach((k) => { this.scores[k] += opt.score[k]; });
    Object.assign(this.branch, opt.set || {});

    const answered = this.data.answered + 1;
    let next = opt.next || null;
    if (!next && opt.nextBy && opt.nextBy.role) next = opt.nextBy.role[this.branch.role] || opt.nextBy.role.mixed;

    if (!next || next === "finish") {
      this.finishQuiz(answered);
      return;
    }

    this.setData({
      answered,
      progress: Math.min(answered / 5, 1),
      currentQuestionId: next,
      currentQuestion: QUESTIONS[next]
    });
  },

  finishQuiz(answered) {
    const jobPower = this.scores.stability + this.scores.execution + (this.branch.role === "job" ? 3 : 0);
    const bizPower = this.scores.autonomy + this.scores.risk + this.scores.growth + (this.branch.role === "biz" ? 3 : 0);
    let result = null;
    if (jobPower - bizPower >= 4) {
      result = { title: "稳健打工进阶型", oneLine: "先稳住，再升级。", job: 78, biz: 22, route: "主业冲刺" };
    } else if (bizPower - jobPower >= 4) {
      result = { title: "创业增长型", oneLine: "你更适合自己做盘子。", job: 28, biz: 72, route: "创业主线" };
    } else {
      result = { title: "职场创业双修型", oneLine: "主业保底，副业增量。", job: 52, biz: 48, route: "双轨平衡" };
    }
    this.setData({ finished: true, started: false, answered, progress: 1, result });
  },

  async resetQuiz() {
    this.branch = { risk: "mid", role: "mixed" };
    this.scores = { risk: 0, execution: 0, stability: 0, growth: 0, autonomy: 0, resilience: 0 };
    this.setData({
      started: false,
      finished: false,
      currentQuestionId: "q1",
      currentQuestion: QUESTIONS.q1,
      progress: 0,
      answered: 0,
      result: null
    });
    await this.refreshStatus();
  }
});
