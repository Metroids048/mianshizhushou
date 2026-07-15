export const MAIL_TEMPLATES = {
  welcome: {
    subject: "欢迎来到 AI 求职台",
  },
  verifyEmail: {
    subject: "请验证你的邮箱",
  },
  resetPassword: {
    subject: "重置你的 AI 求职台密码",
  },
  accountDeletion: {
    subject: "你的 AI 求职台账号已删除",
  },
  feedbackNotice: {
    subject: "收到新的用户反馈",
  },
} as const;

export type MailTemplateName = keyof typeof MAIL_TEMPLATES;
