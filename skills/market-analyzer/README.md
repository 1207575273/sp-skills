# market-analyzer

只读的股票/基金行情分析工具(Claude Code skill)。查 A股/港股/美股/场内ETF 的实时报价、历史K线,算 MA/RSI/MACD/KDJ 技术指标,并能生成自包含 HTML 走势报告。**只读取数与本地分析,不含任何交易/下单能力。**

## 运行要求

- Node >= 20(用内置 fetch 与 node:test)。
- 零第三方依赖,无需 npm install、无需 node_modules。

## 用法

在本目录下执行:

```
node scripts/run-market.mjs quote sh600000 hk00700 usAAPL          # 实时报价
node scripts/run-market.mjs kline usAAPL --limit 60                # 历史K线
node scripts/run-market.mjs indicator sh600000 --type MACD --limit 120 --html  # 指标 + HTML 报告
node scripts/run-market.mjs signals sh600519                       # 信号面板(客观统计+指标状态)
node scripts/run-market.mjs gold                                   # 上海黄金交易所 Au99.99 分时
node scripts/run-market.mjs compare sz300750 sh600519 usAAPL       # 多只并排对比网页(compare.html)
node scripts/run-market.mjs --list-sources                         # 数据源与覆盖
node scripts/run-market.mjs --help                                 # 全部选项
```

代码前缀:A股/场内ETF `sh`/`sz`、港股 `hk`、美股 `us`。

脚本生成的 HTML **一律收敛到 `reports/`,不写到目录外**:`--html` 不带值按时间戳命名 `YYYYMMDDHHMMSS_命令_标的.html`(历史积累不覆盖),`--html 名字.html` 就用该文件名(带目录也只取文件名);环境变量 `MARKET_ANALYZER_REPORTS` 可改 `reports/` 的位置。`reports/` 会随分析积累,按需自行 gitignore。

## 配置

无需配置。数据来自公开接口(腾讯 / 东方财富 / Yahoo Finance),无需注册或密钥。

## 测试

```
npm test
```

内置 `node --test`,含指标计算、http 封装、各数据源解析、命令分发、HTML 渲染的单元测试。数据源另有实跑冒烟(依赖外网,不进常规测试)。

## 免责声明

数据来自民用公开接口,非官方保障,可能延迟、限频或口径变动。本工具提供的是数据与分析,**不构成投资建议,投资决策与盈亏由使用者自负**。工具只读,不含任何交易能力,也**不预测涨跌、不推荐买卖标的**;signals 面板只是对已发生数据与指标状态的客观描述。
