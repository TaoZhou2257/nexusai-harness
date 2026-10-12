#!/usr/bin/env node
/**
 * NexusAgent Builder 产品介绍 — 7 页 PPT 生成脚本（pptxgenjs）。
 *
 * 运行：node dist/ppt/build-deck.cjs
 * 产物：dist/ppt/NexusAgentBuilder-产品介绍.pptx
 *
 * 对外宣传口径：不呈现实现状态（已实现/内测/进度），能力按蓝图全量书写；
 * 不出现底座产品名，内核能力以产品话术表达。
 *
 * 视觉语言（内容驱动）：产品自有品牌绿 #00C29A 为主色；
 * 节点图母题（侧栏品牌 mark）+ 连通状态点（绿/红/灰）作装饰母题。
 */
const path = require('node:path')
const { execSync } = require('node:child_process')

// The project's own node_modules shadows the globally installed toolchain
// (react/react-dom versions differ), so every dependency here resolves from
// the global root explicitly.
const GLOBAL_ROOT = execSync('npm root -g', { encoding: 'utf8' }).trim()
const req = name => require(require.resolve(name, { paths: [GLOBAL_ROOT] }))

const pptxgen = req('pptxgenjs')
const React = req('react')
const ReactDOMServer = req('react-dom/server')
const sharp = req('sharp')
const {
  FaUserTie, FaBookOpen, FaPlug,
  FaShieldAlt, FaLink, FaUserCheck,
  FaCodeBranch, FaExchangeAlt, FaToggleOn, FaListUl,
} = req('react-icons/fa')

// ---------- palette ----------
const INK = '0B1A16'        // dark bg
const INK_CARD = '132720'   // dark card
const LINE_DIM = '1F3A31'   // dark hairlines / graph edges
const GREEN = '00C29A'      // product green
const GREEN_DEEP = '049D7D'
const MINT = '7BE8CE'       // light accent on dark
const BG = 'F2F8F5'         // light bg
const CARD = 'FFFFFF'
const TEXT = '15261F'
const MUTED = '5C736B'
const DARK_TXT = 'E9F4F0'   // body text on dark
const DARK_MUTED = '8FA8A0'

const FONT = 'PingFang SC'
const W = 13.333, H = 7.5

const makeShadow = () => ({ type: 'outer', color: '0B1A16', blur: 10, offset: 3, angle: 90, opacity: 0.10 })

async function iconPng(Icon, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Icon, { color, size: String(size) }))
  const buf = await sharp(Buffer.from(svg)).png().toBuffer()
  return 'image/png;base64,' + buf.toString('base64')
}

/** Line from (x1,y1) to (x2,y2) as a bounding box + flip. */
function line(slide, pres, x1, y1, x2, y2, opts) {
  const flipV = (x1 - x2) * (y1 - y2) < 0
  slide.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    line: { color: LINE_DIM, width: 1.25, ...opts },
    ...(flipV ? { flipV: true } : {}),
  })
}

/** The node-graph motif (the product's brand mark): shared by cover + closing. */
function drawGraph(slide, pres) {
  const nodes = [
    [10.10, 1.45, 0.09, 'dim'], [11.45, 1.10, 0.14, 'green'], [12.80, 1.75, 0.08, 'dim'],
    [10.75, 2.60, 0.11, 'mint'], [12.25, 2.95, 0.17, 'green'], [10.05, 3.70, 0.08, 'dim'],
    [11.60, 4.20, 0.11, 'mint'], [12.82, 4.55, 0.09, 'dim'],
  ]
  const edges = [[0, 1], [1, 2], [0, 3], [1, 3], [3, 4], [2, 4], [4, 6], [3, 5], [5, 6], [6, 7], [4, 7], [1, 4]]
  for (const [a, b] of edges) line(slide, pres, nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1], {})
  for (const [x, y, r, kind] of nodes) {
    const style = kind === 'green' ? { fill: { color: GREEN }, line: { color: GREEN, width: 0 } }
      : kind === 'mint' ? { fill: { color: MINT }, line: { color: MINT, width: 0 } }
        : { fill: { color: LINE_DIM }, line: { color: LINE_DIM, width: 0 } }
    slide.addShape(pres.shapes.OVAL, { x: x - r, y: y - r, w: r * 2, h: r * 2, ...style })
  }
}

/** A slim statement band on a light slide (dot + one line). */
function lightBand(slide, pres, y, text, x = 0.9, w = 11.53, h = 0.8) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08, fill: { color: 'E2F4ED' }, line: { color: 'CBE9DE', width: 1 },
  })
  slide.addShape(pres.shapes.OVAL, { x: x + 0.38, y: y + h / 2 - 0.065, w: 0.13, h: 0.13, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
  slide.addText(text, { x: x + 0.66, y: y + 0.06, w: w - 0.9, h: h - 0.12, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: TEXT, valign: 'middle' })
}

/** A slim statement band on a dark slide (dot + one line). */
function darkBand(slide, pres, y, text, x = 0.9, w = 11.53, h = 0.62) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.07, fill: { color: INK_CARD }, line: { color: LINE_DIM, width: 1 },
  })
  slide.addShape(pres.shapes.OVAL, { x: x + 0.38, y: y + h / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
  slide.addText(text, { x: x + 0.68, y: y + 0.05, w: w - 0.95, h: h - 0.1, margin: 0, fontFace: FONT, fontSize: 12.5, color: MINT, valign: 'middle' })
}

async function main() {
  const pres = new pptxgen()
  pres.defineLayout({ name: 'WIDE', width: W, height: H })
  pres.layout = 'WIDE'
  pres.author = 'NexusAI'
  pres.title = 'NexusAgent Builder — 产品介绍'

  const [tie, book, plug, shield, link, userCheck, branch, exchange, toggle, list] = await Promise.all([
    iconPng(FaUserTie, '#FFFFFF'), iconPng(FaBookOpen, '#FFFFFF'), iconPng(FaPlug, '#FFFFFF'),
    iconPng(FaShieldAlt, MINT), iconPng(FaLink, MINT), iconPng(FaUserCheck, MINT),
    iconPng(FaCodeBranch, '#FFFFFF'), iconPng(FaExchangeAlt, '#FFFFFF'), iconPng(FaToggleOn, '#FFFFFF'), iconPng(FaListUl, '#FFFFFF'),
  ])

  // ============================================================ 1 · 封面
  const s1 = pres.addSlide()
  s1.background = { color: INK }
  drawGraph(s1, pres)

  s1.addText('NEXUSAI', {
    x: 0.9, y: 0.95, w: 8.0, h: 0.32, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true,
    color: GREEN, charSpacing: 4,
  })
  s1.addText('NexusAgent Builder', {
    x: 0.88, y: 1.32, w: 8.6, h: 0.9, margin: 0, fontFace: FONT, fontSize: 46, bold: true, color: 'FFFFFF',
  })
  s1.addText('让每个企业，拥有自己的 AI 工作台', {
    x: 0.9, y: 2.28, w: 11.0, h: 0.42, margin: 0, fontFace: FONT, fontSize: 19, color: MINT,
  })
  s1.addText([
    { text: '本地独立 Agent ＋ 企业能力直连，安全可控、开箱即用。', options: { breakLine: true } },
    { text: '一个工作台，装下企业的 AI 能力。', options: { breakLine: true } },
    { text: '从工具连接到智能编排，为每家企业白标交付。', options: {} },
  ], {
    x: 0.9, y: 2.95, w: 8.6, h: 1.15, margin: 0, fontFace: FONT, fontSize: 13.5, color: DARK_MUTED, lineSpacing: 22,
  })

  const chipW = 2.73, chipY = 4.75, chipH = 1.32
  const chips = [
    ['成熟内核', '规划、调用与会话能力全内置'],
    ['双轨模型', '本地与企业模型，双轨并行'],
    ['三支柱工作台', '专家 · 技能 · 连接器'],
    ['白标交付', '一套客户端，服务每家企业'],
  ]
  chips.forEach(([title, desc], i) => {
    const x = 0.9 + i * (chipW + 0.2)
    s1.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: chipY, w: chipW, h: chipH, rectRadius: 0.09,
      fill: { color: INK_CARD }, line: { color: LINE_DIM, width: 1 },
    })
    s1.addShape(pres.shapes.OVAL, { x: x + 0.32, y: chipY + 0.30, w: 0.11, h: 0.11, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s1.addText(title, {
      x: x + 0.55, y: chipY + 0.20, w: chipW - 0.8, h: 0.34, margin: 0, fontFace: FONT, fontSize: 14, bold: true, color: 'FFFFFF', valign: 'middle',
    })
    s1.addText(desc, {
      x: x + 0.32, y: chipY + 0.62, w: chipW - 0.64, h: 0.58, margin: 0, fontFace: FONT, fontSize: 10.5, color: DARK_MUTED, lineSpacing: 15,
    })
  })

  s1.addText('NexusAI · 产品介绍', { x: 0.9, y: 6.95, w: 5, h: 0.3, margin: 0, fontFace: FONT, fontSize: 10, color: '54706A' })
  s1.addText('让每个企业拥有自己的 AI 工作台', { x: 7.4, y: 6.95, w: 5.0, h: 0.3, margin: 0, fontFace: FONT, fontSize: 10, color: '54706A', align: 'right' })

  // ============================================================ 2 · 产品定位
  const s2 = pres.addSlide()
  s2.background = { color: BG }
  s2.addText('产品定位', { x: 0.9, y: 0.52, w: 4, h: 0.3, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN_DEEP, charSpacing: 2 })
  s2.addText('为什么是桌面客户端？', { x: 0.88, y: 0.82, w: 11.5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: TEXT })
  s2.addText('安全、直连、人人可用 —— 桌面形态的三个理由。', {
    x: 0.9, y: 1.42, w: 11.5, h: 0.36, margin: 0, fontFace: FONT, fontSize: 12.5, color: MUTED,
  })

  const reasons = [
    [shield, '数据留在本地', 'Agent 与数据，都在企业自己的电脑上；信息不出域，安全可控。'],
    [link, '企业能力直连', '一次登录，企业能力自动就位；随组织切换，实时刷新。'],
    [userCheck, '人人可以用', '全程可视化操作，零门槛上手，不需要开发者。'],
  ]
  reasons.forEach(([icon, title, desc], i) => {
    const x = 0.9 + i * 3.91
    s2.addShape(pres.shapes.OVAL, { x, y: 2.28, w: 0.56, h: 0.56, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s2.addImage({ data: icon, x: x + 0.13, y: 2.41, w: 0.30, h: 0.30 })
    s2.addText(title, { x: x + 0.76, y: 2.28, w: 2.9, h: 0.56, margin: 0, fontFace: FONT, fontSize: 16, bold: true, color: TEXT, valign: 'middle' })
    s2.addText(desc, { x, y: 3.06, w: 3.51, h: 1.5, margin: 0, fontFace: FONT, fontSize: 11, color: MUTED, lineSpacing: 17 })
    if (i < 2) s2.addShape(pres.shapes.LINE, { x: x + 3.66, y: 2.4, w: 0, h: 1.62, line: { color: 'D5E6DF', width: 1 } })
  })

  lightBand(s2, pres, 5.3, '这就是桌面形态：数据不出域，能力进得来，体验属于每个人。')

  // ============================================================ 3 · 核心能力
  const s3 = pres.addSlide()
  s3.background = { color: BG }
  s3.addText('核心能力', { x: 0.9, y: 0.52, w: 4, h: 0.3, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN_DEEP, charSpacing: 2 })
  s3.addText('一个工作台，装下企业的 AI 能力', { x: 0.88, y: 0.82, w: 11.5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: TEXT })
  s3.addText('登录即装载，随组织而变；本地能力，始终可用。', {
    x: 0.9, y: 1.42, w: 11.5, h: 0.36, margin: 0, fontFace: FONT, fontSize: 12.5, color: MUTED,
  })

  const cards = [
    {
      icon: tie, title: '专家', slogan: '企业智慧，随呼随用',
      desc: '企业沉淀的专家能力，在会话中直接可用，随组织而变。',
    },
    {
      icon: book, title: '技能', slogan: '一键装配，即装即用',
      desc: '从企业目录到中文技能市场，获取、管理、启停，全程可视。',
    },
    {
      icon: plug, title: '连接器', slogan: '连接一切，无缝融入',
      desc: '主流协议一站接入，新旧服务统统接得进来，能力一目了然。',
    },
  ]
  const cardW = 3.71, cardY = 1.98, cardH = 3.0
  cards.forEach((card, i) => {
    const x = 0.9 + i * (cardW + 0.2)
    s3.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH, rectRadius: 0.08,
      fill: { color: CARD }, line: { color: 'DCEDE6', width: 1 }, shadow: makeShadow(),
    })
    s3.addShape(pres.shapes.OVAL, { x: x + 0.34, y: cardY + 0.34, w: 0.64, h: 0.64, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s3.addImage({ data: card.icon, x: x + 0.49, y: cardY + 0.49, w: 0.34, h: 0.34 })
    s3.addText(card.title, {
      x: x + 0.34, y: cardY + 1.16, w: cardW - 0.68, h: 0.48, margin: 0, fontFace: FONT, fontSize: 20, bold: true, color: TEXT,
    })
    s3.addText(card.slogan, {
      x: x + 0.34, y: cardY + 1.70, w: cardW - 0.68, h: 0.38, margin: 0, fontFace: FONT, fontSize: 13.5, bold: true, color: GREEN_DEEP,
    })
    s3.addText(card.desc, {
      x: x + 0.34, y: cardY + 2.14, w: cardW - 0.68, h: 0.8, margin: 0, fontFace: FONT, fontSize: 11.5, color: MUTED, lineSpacing: 17,
    })
  })

  lightBand(s3, pres, 5.25, '统一入口：专家 · 技能 · 连接器，随企业身份而行。')

  // ============================================================ 4 · 连接能力
  const s4 = pres.addSlide()
  s4.background = { color: INK }
  s4.addText('连接能力', { x: 0.9, y: 0.52, w: 4, h: 0.3, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN, charSpacing: 2 })
  s4.addText('连接一切 MCP 服务', { x: 0.88, y: 0.82, w: 11.5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: 'FFFFFF' })
  s4.addText('没有接不进来的服务，只有还没添加的服务。', {
    x: 0.9, y: 1.42, w: 11.5, h: 0.36, margin: 0, fontFace: FONT, fontSize: 12.5, color: DARK_MUTED,
  })

  const blocks = [
    [branch, '全形态接入', '主流接入方式，一站支持', '新服务，即添即用'],
    [exchange, '兼容存量', '旧式服务也能接入', '存量资产，全部盘活'],
    [toggle, '连接可见', '连通状态与能力，一目了然', '启停自如，即时生效'],
    [list, '工具透明', 'AI 能调用什么，清清楚楚', '参数与说明，全部可见'],
  ]
  const blockW = 5.66, blockH = 1.82
  blocks.forEach(([icon, title, line1, line2], i) => {
    const x = 0.9 + (i % 2) * (blockW + 0.21)
    const y = 1.95 + Math.floor(i / 2) * (blockH + 0.18)
    s4.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w: blockW, h: blockH, rectRadius: 0.08, fill: { color: INK_CARD }, line: { color: LINE_DIM, width: 1 },
    })
    s4.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.28, w: 0.5, h: 0.5, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s4.addImage({ data: icon, x: x + 0.415, y: y + 0.395, w: 0.27, h: 0.27 })
    s4.addText(title, { x: x + 0.96, y: y + 0.28, w: blockW - 1.3, h: 0.5, margin: 0, fontFace: FONT, fontSize: 15, bold: true, color: 'FFFFFF', valign: 'middle' })
    s4.addText([{ text: line1, options: { breakLine: true } }, { text: line2 }], { x: x + 0.3, y: y + 0.94, w: blockW - 0.6, h: 0.72, margin: 0, fontFace: FONT, fontSize: 10.5, color: DARK_MUTED, lineSpacing: 16 })
  })

  darkBand(s4, pres, 6.02, '从创建到桥接，从状态到参数 —— 连接器的每个细节都看得见。')

  // ============================================================ 5 · 能力版图
  const s5 = pres.addSlide()
  s5.background = { color: BG }
  s5.addText('能力版图', { x: 0.9, y: 0.52, w: 4, h: 0.3, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN_DEEP, charSpacing: 2 })
  s5.addText('面向企业智能的下一站', { x: 0.88, y: 0.82, w: 11.5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: TEXT })
  s5.addText('能力版图持续扩展：AI，正在成为企业自己的基础设施。', {
    x: 0.9, y: 1.42, w: 11.5, h: 0.36, margin: 0, fontFace: FONT, fontSize: 12.5, color: MUTED,
  })

  const future = [
    ['01', '可视化工作流', '让流程自己跑起来', '拖拽编排，人人可搭'],
    ['02', '企业知识库', '让知识会回答', '随问随答，有据可依'],
    ['03', '企业级治理', '让智能可控可管', '私有化 · 权限 · 审计'],
    ['04', '生态与协作', '让能力流动起来', '共享复用，协同进化'],
  ]
  const fCardW = 2.73, fCardY = 1.98, fCardH = 3.0
  future.forEach(([num, title, slogan, desc], i) => {
    const x = 0.9 + i * (fCardW + 0.2)
    s5.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y: fCardY, w: fCardW, h: fCardH, rectRadius: 0.08,
      fill: { color: CARD }, line: { color: 'DCEDE6', width: 1 }, shadow: makeShadow(),
    })
    s5.addShape(pres.shapes.OVAL, { x: x + 0.3, y: fCardY + 0.3, w: 0.46, h: 0.46, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s5.addText(num, { x: x + 0.3, y: fCardY + 0.3, w: 0.46, h: 0.46, margin: 0, fontFace: FONT, fontSize: 12, bold: true, color: '06281F', align: 'center', valign: 'middle' })
    s5.addText(title, { x: x + 0.3, y: fCardY + 0.92, w: fCardW - 0.6, h: 0.4, margin: 0, fontFace: FONT, fontSize: 14.5, bold: true, color: TEXT })
    s5.addText(slogan, { x: x + 0.3, y: fCardY + 1.36, w: fCardW - 0.6, h: 0.36, margin: 0, fontFace: FONT, fontSize: 11.5, bold: true, color: GREEN_DEEP })
    s5.addText(desc, { x: x + 0.3, y: fCardY + 1.76, w: fCardW - 0.6, h: 0.6, margin: 0, fontFace: FONT, fontSize: 10.5, color: MUTED, lineSpacing: 16 })
  })

  lightBand(s5, pres, 5.25, '从连接到编排，从知识到治理 —— 企业智能，一站配齐。')

  // ============================================================ 6 · 为什么选我们
  const s6 = pres.addSlide()
  s6.background = { color: INK }
  s6.addText('为什么选我们', { x: 0.9, y: 0.52, w: 4, h: 0.3, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN, charSpacing: 2 })
  s6.addText('为什么选 NexusAgent Builder', { x: 0.88, y: 0.82, w: 11.5, h: 0.6, margin: 0, fontFace: FONT, fontSize: 30, bold: true, color: 'FFFFFF' })
  s6.addText('站在成熟内核之上，也与同类方案拉开了身位', {
    x: 0.9, y: 1.42, w: 11.5, h: 0.32, margin: 0, fontFace: FONT, fontSize: 12.5, color: DARK_MUTED,
  })

  s6.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.9, y: 1.82, w: 11.53, h: 0.78, rectRadius: 0.08, fill: { color: INK_CARD }, line: { color: LINE_DIM, width: 1 },
  })
  s6.addShape(pres.shapes.OVAL, { x: 1.22, y: 2.15, w: 0.12, h: 0.12, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
  s6.addText('成熟内核', { x: 1.48, y: 1.94, w: 1.9, h: 0.54, margin: 0, fontFace: FONT, fontSize: 13.5, bold: true, color: MINT, valign: 'middle' })
  s6.addText([
    { text: '任务规划 · 工具调用 · 会话与技能体系 · 浏览器与电脑操作 全内置；', options: { breakLine: true } },
    { text: '本地运行、安全可控 —— 专注把企业能力与体验做到极致。', options: {} },
  ], {
    x: 3.30, y: 1.92, w: 8.90, h: 0.58, margin: 0, fontFace: FONT, fontSize: 10.5, color: DARK_MUTED, lineSpacing: 15, valign: 'middle',
  })

  s6.addText('通用本地客户端的常见局限', { x: 0.9, y: 2.78, w: 5.2, h: 0.32, margin: 0, fontFace: FONT, fontSize: 13, bold: true, color: DARK_MUTED })
  s6.addText('NexusAgent Builder · 我们的优势', { x: 7.15, y: 2.78, w: 5.4, h: 0.32, margin: 0, fontFace: FONT, fontSize: 13, bold: true, color: MINT })
  s6.addShape(pres.shapes.LINE, { x: 6.62, y: 3.16, w: 0, h: 3.08, line: { color: LINE_DIM, width: 1 } })

  const pairs = [
    ['模型通道单一', '双轨模型：本地与企业模型，双轨并行'],
    ['能力散落各处', '全域工作台：专家 · 技能 · 连接器，一屏统管'],
    ['知识与流程割裂', '知识与流程：会回答，更能自动执行'],
    ['脱离组织身份', '企业直连：账号、组织、能力，随身份而行'],
    ['存量服务接不进', '连接最全：新老服务，一次接齐'],
    ['中文场景缺位', '中文生态：中文市场与场景，原生适配'],
    ['无法品牌化', '白标交付：一套客户端，服务每家企业'],
  ]
  const pairY = 3.18, pairH = 0.44
  pairs.forEach(([weak, strong], i) => {
    const y = pairY + i * pairH
    s6.addText(weak, { x: 0.9, y, w: 5.5, h: pairH, margin: 0, fontFace: FONT, fontSize: 11, color: DARK_MUTED, valign: 'middle' })
    s6.addShape(pres.shapes.OVAL, { x: 6.92, y: y + 0.165, w: 0.11, h: 0.11, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s6.addText(strong, { x: 7.15, y, w: 5.30, h: pairH, margin: 0, fontFace: FONT, fontSize: 11.5, bold: true, color: DARK_TXT, valign: 'middle' })
  })

  darkBand(s6, pres, 6.36, '企业级就绪：数据不出域；组织、权限与品牌，随企业体系同行。')

  // ============================================================ 7 · 收尾
  const s7 = pres.addSlide()
  s7.background = { color: INK }
  drawGraph(s7, pres)

  s7.addText('NEXUSAI', { x: 0.9, y: 1.35, w: 8.0, h: 0.32, margin: 0, fontFace: FONT, fontSize: 12.5, bold: true, color: GREEN, charSpacing: 4 })
  s7.addText('让每个企业，拥有自己的 AI 工作台', {
    x: 0.88, y: 1.82, w: 9.2, h: 0.9, margin: 0, fontFace: FONT, fontSize: 33, bold: true, color: 'FFFFFF',
  })
  s7.addText('本地安全、企业直连、白标交付 —— 属于每家企业自己的智能工作台。', {
    x: 0.9, y: 2.85, w: 9.0, h: 0.42, margin: 0, fontFace: FONT, fontSize: 14, color: MINT,
  })

  const closers = [
    ['本地运行 · 数据不出域', 'Agent 与数据都在企业自己的电脑上'],
    ['登录即装载 · 随组织而变', '专家 · 技能 · 连接器 · 知识，一次接入'],
    ['白标交付 · 多租户就绪', '品牌、服务器可配，一套客户端服务每家企业'],
  ]
  closers.forEach(([title, desc], i) => {
    const x = 0.9 + i * 3.91
    s7.addShape(pres.shapes.OVAL, { x, y: 4.62, w: 0.12, h: 0.12, fill: { color: GREEN }, line: { color: GREEN, width: 0 } })
    s7.addText(title, { x: x + 0.26, y: 4.42, w: 3.5, h: 0.4, margin: 0, fontFace: FONT, fontSize: 13, bold: true, color: 'FFFFFF', valign: 'middle' })
    s7.addText(desc, { x, y: 4.94, w: 3.62, h: 0.8, margin: 0, fontFace: FONT, fontSize: 10.5, color: DARK_MUTED, lineSpacing: 15 })
    if (i < 2) s7.addShape(pres.shapes.LINE, { x: x + 3.72, y: 4.46, w: 0, h: 1.28, line: { color: LINE_DIM, width: 1 } })
  })

  s7.addText('NexusAI · NexusAgent Builder', { x: 0.9, y: 6.95, w: 6, h: 0.3, margin: 0, fontFace: FONT, fontSize: 10, color: '54706A' })

  const out = path.join(__dirname, 'NexusAgentBuilder-产品介绍.pptx')
  await pres.writeFile({ fileName: out })
  console.log('written:', out)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
