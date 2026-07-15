import { ArrowLeft, HelpCircle, Info, Shield } from "lucide-react";
import { navigateTo } from "../../lib/router";
import { Seo } from "../system/Seo";

const TERMS_CONTENT = `用户协议

最后更新：2025年7月

1. 服务说明
AI 求职台（以下简称"本产品"）是一款面向个人求职者的 AI 面试准备工具，提供岗位解析、模拟面试、实时助手等功能。

2. 账户与安全
2.1 您应提供真实、准确的手机号完成注册，并对账户安全负责。
2.2 不得将账户转让或出借给他人使用。
2.3 如发现未经授权使用您账户的情况，请立即联系我们。

3. 使用规则
3.1 本产品仅供个人求职练习使用，不得用于任何违法或侵犯他人权益的活动。
3.2 不得利用本产品生成虚假面试内容、冒用他人身份或实施欺诈行为。
3.3 不得对服务进行反向工程、篡改或干扰服务的正常运行。

4. 知识产权
本产品所包含的代码、设计、文案及算法模型均为产品方的知识产权，未经许可不得复制或分发。

5. 免责声明
5.1 AI 生成内容仅供参考，不构成求职建议或录用保证。
5.2 本产品不对因使用服务而产生的任何直接或间接损失承担责任。
5.3 服务可能因维护、升级或不可抗力中断，我们会尽快恢复。

6. 终止
我们保留在违反本协议的情况下暂停或终止您账户的权利。

7. 联系方式
如有任何问题，请通过产品内的反馈功能联系我们。`;

const PRIVACY_CONTENT = `隐私政策

最后更新：2025年7月

1. 信息收集
1.1 我们收集以下信息：
  - 手机号：用于账户注册和登录
  - 简历内容：您主动上传或输入的简历文本
  - 岗位信息：您输入的职位描述（JD）
  - 面试记录：模拟面试的对话内容和评分
  - 语音转写文本：您主动使用麦克风或 Windows 音频桥时生成的实时转写文本
  - 使用数据：AI 调用次数和功能使用情况

1.2 所有信息仅在您主动提供、主动开启语音听取，或主动连接 Windows 音频桥并授权时收集。系统不会在未连接音频桥时采集桌面系统音频。

2. 信息使用
2.1 我们使用您的信息来：
  - 提供和优化 AI 面试准备服务
  - 生成个性化的练习建议和成长报告
  - 改进 AI 模型的回答质量
  - 保障服务安全和防止滥用

2.2 我们不会将您的个人信息用于广告投放或出售给第三方。

3. 信息存储
3.1 您的数据存储在安全服务器上，采用加密传输和存储。
3.2 您可以随时导出或删除您的数据。删除操作将在 30 天内完成清理。

4. 信息共享
4.1 我们不会与第三方共享您的个人信息，除非：
  - 获得您的明确授权
  - 法律法规要求
  - 保护我们的合法权益

5. AI 模型说明
5.1 本产品使用第三方大语言模型 API 提供服务。
5.2 发送给 AI 模型的内容仅用于生成回复，不会被用于模型训练（除非模型服务商另有规定）。
5.3 模型服务商可能保留日志用于服务监控和合规目的。

6. 您的权利
6.1 您有权访问、更正、导出和删除您的个人数据。
6.2 您可以通过产品内功能或联系我们行使这些权利。

7. Cookie 政策
7.1 本产品使用必要的本地存储来维持登录状态和草稿缓存。
7.2 不使用第三方追踪 Cookie。

8. 政策更新
我们可能会更新本隐私政策，重大变更将通过站内通知告知。

9. 内测说明
当前为内测版：语音与简历数据用于生成练习内容；邮件通知与找回密码功能暂未开通。

10. 联系方式
如有隐私相关问题，请通过产品内的反馈功能联系我们。`;

const ABOUT_CONTENT = `关于 AI 求职台

AI 求职台是一款面向应届、实习和校招用户的本地优先 AI 面试准备工具。

1. 我们解决什么
1.1 把真实 JD、简历证据和面试记录串成一条闭环：导入岗位与简历 → 模拟面试预演 → 实时助手生成提词卡 → 保存记录 → 复盘改进。
1.2 输出可讲的回答框架、要点与可能追问，而不是替你逐字代答。

2. 我们的边界
2.1 不做隐蔽代答。系统音频仅在你主动进入会议监听、生成配对码、启动 Windows 音频桥并授权后采集，用于把会议软件里播放的面试官声音转成文本。
2.2 AI 生成内容仅供练习参考，模型不可用时会明确标记“本地练习模式”，不把本地规则伪装成模型成功。

3. 技术与数据
3.1 语音能力默认使用浏览器麦克风与 Web Speech API；会议监听使用 Windows 音频桥连接系统音频；不支持、未授权或语音服务未配置时会明确提示并降级为文字输入。
3.2 原始音频不落盘保存；你的数据可随时导出或删除，详见隐私政策。

4. 联系方式
如需合作或反馈，请通过产品内的反馈功能联系我们。`;

const HELP_CONTENT = `帮助中心

最后更新：2025年7月

1. 新用户怎么开始
1.1 粘贴一份真实 JD，或填写目标岗位，系统会完成岗位 intake 审核。
1.2 导入或粘贴简历，补充项目资料与常见问题，作为 AI 的上下文底座。
1.3 先用模拟面试预演，再在真实面试中开启实时助手。

2. 实时助手怎么用
2.1 输入或用语音说出面试官的问题，助手会生成回答策略、开场句、要点、可引用证据与可能追问。
2.2 停止听取不会清空已识别文本，只有你点击清空/重录才会清空。
2.3 如果要听腾讯会议、飞书等会议软件的系统音频，请先进入“会议监听”生成配对码并连接 Windows 音频桥，再回到实时助手开启系统音频听取。

3. 模拟面试怎么用
3.1 选择岗位与风格（温和/严格/压力），系统按 JD、问题意图和简历证据排序出题。
3.2 回答后会生成追问、下一题或评价；结束后自动保存记录与报告。

4. 常见问题
4.1 看到“本地练习模式”是什么意思？表示后端未连接或模型暂时不可用，已切回本地规则，内容仅供练习。
4.2 语音用不了怎么办？请检查浏览器麦克风权限，或直接改用文字输入，不影响生成提词卡。
4.3 会议监听显示“语音服务未配置”是什么意思？表示音频桥已经连接，但服务端 ASR 没有配置，系统不会伪装成转写成功。
4.4 数据安全吗？数据可随时导出或删除，详见隐私政策。

5. 还有问题
请通过产品内的反馈功能联系我们。`;

type DocType = "terms" | "privacy" | "about" | "help";

const DOC_META: Record<DocType, { title: string; content: string; path: string; date?: string }> = {
  terms: { title: "用户协议", content: TERMS_CONTENT, path: "/terms-of-service", date: "2025年7月" },
  privacy: { title: "隐私政策", content: PRIVACY_CONTENT, path: "/privacy-policy", date: "2025年7月" },
  about: { title: "关于我们", content: ABOUT_CONTENT, path: "/about" },
  help: { title: "帮助中心", content: HELP_CONTENT, path: "/help", date: "2025年7月" },
};

export function LegalPage({ type }: { type: DocType }) {
  const meta = DOC_META[type];
  const Icon = type === "about" ? Info : type === "help" ? HelpCircle : Shield;

  return (
    <section className="page legal-page">
      <Seo title={`${meta.title} | AI 求职台`} description={`查看 AI 求职台的${meta.title}。`} />
      <div className="legal-card">
        <div className="legal-header">
          <button type="button" className="legal-back" onClick={() => navigateTo(window.history.length > 1 ? window.location.pathname : "/account")}>
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="legal-title-row">
            <Icon size={20} />
            <h1>{meta.title}</h1>
          </div>
          {meta.date ? <p className="legal-date">最后更新：{meta.date}</p> : null}
          <p className="legal-link-hint">固定访问路径：{meta.path}</p>
        </div>
        <div className="legal-body">
          {meta.content.split("\n").map((line, index) => {
            if (!line.trim()) return <br key={index} />;
            if (/^\d+\./.test(line.trim())) return <h3 key={index}>{line}</h3>;
            if (/^\d+\.\d+/.test(line.trim())) return <h4 key={index}>{line}</h4>;
            return <p key={index}>{line}</p>;
          })}
        </div>
      </div>
    </section>
  );
}
