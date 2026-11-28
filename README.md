# ETF Replication Lab (`159201` 个人复制策略收益实验室)

> 围绕 **华夏国证自由现金流 ETF（159201）** 构建的零依赖、单文件、可交互量化研究实验室：对比「直接买 ETF」与「个人按持仓复制一篮子股票」在**股息税、网上打新、管理费/交易成本、样本外历史跟踪误差**四个维度上的真实差异。

- **在线体验（GitHub Pages）**：https://dabuside.github.io/etf-replication-lab/

## 核心设计原则

1. **双输入契约（Two-Inputs-Only Contract）**  
   页面只暴露两个交互输入：**本金（元）** 与 **拟合方式（`buy_etf` / Top5 / Top10 / Top20 / Top30 / Full）**。其余全部指标由冻结数据集与核心模型实时推导，避免用大量可调参数“凑结论”。
2. **数据溯源分级（Provenance Tagging）**  
   所有呈现在页面上的数字都显式标注来源类型：
   - **真实披露数据（`disclosed`）**：基金定期报告、交易所规则、披露费率与分红/网下打新记录。
   - **历史统计估计（`statistical`）**：近两年沪深新股逐只期望、样本外历史回测、有效股息税率回推。
   - **模型假设（`assumption`）**：个人交易成本（佣金/印花税/过户费/冲击成本）与年换手率等显式假设。
3. **单文件零运行时依赖**  
   `npm run build` 将模型层（`EtfLab`）、裁剪后的冻结数据（`LAB_DATA`）、模块化前端脚本与 CSS 全部内联进单一 `dist/index.html`（无后端、无 CDN、无运行时 `fetch`），本地双击或托管在任意静态空间均可直接打开。

## 架构与数据流

```text
公开数据源 (基金报告 / 行情 / 分红 / 新股)
   │  npm run scrape
   ▼
data/raw/ (不提交，可重抓)
   │  npm run derive
   ▼
data/derived/dataset.json (已提交的冻结数据集)
   │  npm run build (bundle-model.ts + build.ts)
   ▼
dist/index.html (单文件静态应用：EtfLab + LAB_DATA + web/*)
```

## 目录结构

```text
.
├── data/derived/         # 冻结后的派生数据集 (dataset.json)
├── src/
│   ├── types.ts          # 领域类型与数据溯源 (Provenance) 定义
│   ├── dataset.ts        # Dataset 结构定义与读写
│   ├── model.ts          # 核心计算引擎 compute(dataset, capital, method, knobs)
│   ├── backtest.ts       # 样本外滚动窗口回测、OLS 回归与 Active Share
│   ├── derive.ts         # 股息率、有效税率回推、费率与基金打新稀释推导
│   ├── domain/           # 纯领域逻辑：ipo.ts / portfolio.ts / tax.ts
│   ├── scrape/           # 原始公开数据抓取与 PDF 解析脚本
│   └── cli/              # 构建与派生入口：derive.ts / bundle-model.ts / build.ts / transpile.ts
├── web/
│   ├── index.html        # 单文件 HTML 模板
│   ├── style.css         # 页面样式与响应式布局
│   ├── types.ts          # 复用 src/ 领域类型的前端类型声明
│   ├── format.ts         # 格式化、HTML 转义与常量
│   ├── charts.ts         # 原生 Canvas 收益/回撤图表（O(N) 回撤 + HiDPI）
│   ├── panels.ts         # 11 个分析面板与页头渲染器
│   └── app.ts            # 状态管理与按需渲染入口
├── test/                 # Node 原生单元测试 (`node --test`)
├── scripts/smoke.ts      # 无头 VM 冒烟测试（校验 dist/index.html 全部 12 个面板）
├── e2e/lab.spec.ts       # Playwright 端到端交互测试
└── .github/workflows/    # ci.yml (PR 校验) & deploy-pages.yml (main 自动部署)
```

## 快速开始

### 环境要求

- **Node.js `>= 24.0.0`**（项目使用 Node 24 原生 TypeScript 执行，无需额外的 `ts-node` / `tsx` 运行时）。

### 本地开发与验证

```bash
# 安装依赖
npm ci

# 类型检查
npm run typecheck

# 运行单元测试
npm run test

# 构建单文件产物 dist/index.html
npm run build

# 无头冒烟测试（验证构建产物全部面板正常渲染）
npm run smoke

# 本地预览（默认 http://localhost:4173）
npm run dev

# 完整验证（含 Playwright E2E，首次需先 npx playwright install chromium）
npm run verify
```

### 刷新数据（可选）

```bash
# 重新抓取公开数据至 data/raw/
npm run scrape

# 重新生成 data/derived/dataset.json
npm run derive
```

## CI/CD 与部署

- **Pull Request 检查（`.github/workflows/ci.yml`）**：每次提交 PR 自动运行 `typecheck`、`test`、`build` 与 `smoke`，并将构建出的 `dist/index.html` 作为 Workflow Artifact 上传，方便合并前下载检查。
- **自动部署（`.github/workflows/deploy-pages.yml`）**：合并到 `main`（或手动触发）后，自动完成全量校验并发布至 GitHub Pages（`https://dabuside.github.io/etf-replication-lab/`）。

## 免责声明

本项目仅用于量化研究与策略机制拆解，不构成任何投资建议。市场有风险，历史回测与统计期望不预示未来收益。
