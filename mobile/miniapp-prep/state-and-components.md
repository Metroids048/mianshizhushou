# 核心状态与组件拆分建议

## 核心状态

- 当前岗位 `activePositionId`
- 岗位列表 `positions`
- 简历档案 `profile`
- 当前面试配置 `InterviewConfig`
- 实时助手转写状态 `RecognizedDraft`
- 模拟面试 transcript / cue cards / backend status
- 记录列表与当前记录 `interviewRecords / activeRecordId`

## 建议拆出的组件

- 岗位卡
- 顶部状态栏
- 提词卡面板
- 语音操作条
- 问题折叠行
- 简历模块导航
- 记录列表项

## 小程序适配注意点

- Web Speech 需要替换为小程序录音与转写能力。
- 当前 drawer / dialog 结构建议替换为原生 page + popup 组合。
- 右侧栏信息在小程序里应转为二级页或底部弹层。
