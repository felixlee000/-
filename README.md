# 本地背单词工具

一个面向英语词汇复习的纯前端本地应用。项目不依赖后端服务，打开 `index.html` 就可以创建词表、录入单词、进行测试，并把学习数据保存在当前浏览器的 `localStorage` 中。

## 功能特点

- 创建、重命名、删除多个词表
- 逐条录入单词、释义和备注
- 收藏重点词，单独进行收藏词练习
- 自动记录答题正确数、错误数和复习状态
- 自动生成错题本，支持只练错题
- 支持跨词表综合测试
- 支持按全部词、收藏词、错题词、到期复习词和智能推荐范围抽题
- 根据复习情况安排下一次复习时间
- 支持拖拽调整词条顺序
- 支持 CSV 导入和导出
- 支持日间 / 夜间主题切换
- 数据完全保存在本机浏览器中

## 项目结构

```text
.
├── index.html    # 页面入口
├── style.css     # 页面样式和主题变量
├── app.js        # 应用状态、渲染、交互、测试和 CSV 逻辑
└── README.md     # 项目说明
```

## 快速开始

本项目没有构建步骤，也不需要安装依赖。

直接双击打开：

```text
index.html
```

也可以在项目目录启动一个本地静态服务：

```bash
python -m http.server 8000
```

然后在浏览器访问：

```text
http://localhost:8000
```

## 使用说明

1. 进入页面后，点击「新建词表」创建一个单词本。
2. 在词表编辑页填写单词和解释，只有两项都填写完整的词条才会进入测试。
3. 点击「全部练习」开始当前词表测试，页面会显示解释，需要输入对应单词。
4. 答错的词会自动进入错题本，可以通过「练错题」集中复习。
5. 点击收藏按钮可以标记重点词，之后通过「只练收藏」进行专项练习。
6. 首页的「综合测试」可以跨多个词表抽题复习。
7. 右上角可以切换日间 / 夜间模式。

## 快捷键

在词表编辑页中，可以使用下面的快捷键快速新增词条：

```text
Windows / Linux: Ctrl + Enter
macOS: Command + Enter
```

## CSV 导入导出

在词表编辑页点击「导入 CSV」可以批量导入单词，点击「导出 CSV」可以备份当前词表。

CSV 至少需要包含 `word` 和 `meaning` 两列：

```csv
word,meaning
abandon,放弃；抛弃
beneficial,有益的
```

导入时也支持没有表头的简单格式，此时默认第一列为单词，第二列为解释：

```csv
abandon,放弃；抛弃
beneficial,有益的
```

导出的 CSV 会包含更多学习记录字段：

```csv
word,meaning,note,favorite,correctCount,wrongCount,lastReviewedAt,createdAt,reviewLevel,nextReviewAt,consecutiveCorrect,lastAnswerCorrect,totalReviewCount
```

## 数据存储

应用数据保存在当前浏览器的 `localStorage` 中，主要键名为：

```text
local-vocabulary-tool:v1
local-vocabulary-tool:theme
```

注意事项：

- 同一个浏览器、同一个站点地址下的数据会自动保留。
- 更换浏览器、清除浏览器数据或更换访问地址后，可能看不到原来的词表。
- 建议定期使用「导出 CSV」备份重要词表。
- 如果浏览器禁用了本地存储，应用会提示保存失败。

## 开发说明

这是一个无框架的静态网页项目，核心逻辑都在 `app.js` 中：

- 使用全局 `state` 保存当前视图、词表、测试和弹窗状态
- 使用 `localStorage` 持久化词表和主题
- 使用模板字符串渲染页面
- 使用事件委托处理按钮、输入、表单、拖拽和快捷键
- 使用 Levenshtein 距离给出拼写相似度提示
- 使用复习等级和答题记录计算下次复习时间

修改代码后刷新浏览器即可看到效果。

## 浏览器支持

推荐使用最新版 Chrome、Edge、Firefox 或 Safari。应用依赖现代浏览器能力，包括：

- `localStorage`
- `FileReader`
- `Blob`
- `URL.createObjectURL`
- `crypto.randomUUID`
- HTML5 拖拽事件

如果浏览器不支持 `crypto.randomUUID`，应用会自动使用时间戳和随机数生成本地 ID。
