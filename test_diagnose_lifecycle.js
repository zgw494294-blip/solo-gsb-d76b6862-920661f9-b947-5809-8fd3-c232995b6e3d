/* 最小 DOM/事件 stub：加载真实 static/app.js，端到端验证替代性诊断的生命周期。 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------------- mini DOM（与另两套生命周期测试同款桩） ---------------- */

class TokenList {
  constructor() { this._s = new Set(); }
  add(...names) { names.forEach((n) => n && this._s.add(n)); }
  remove(n) { this._s.delete(n); }
  contains(n) { return this._s.has(n); }
  [Symbol.iterator]() { return this._s[Symbol.iterator](); }
}

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.classList = new TokenList();
    this.dataset = {};
    this.id = "";
    this.value = "";
    this.checked = false;
    this.hidden = false;
    this._text = "";
    this._html = "";
    this._listeners = new Map();
    this.name = "";
    this.type = "";
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(html) {
    this._html = html;
    // 与真实 DOM 一致：写入 innerHTML 时解析为子节点，使 querySelector 能找到
    // 渲染出的按钮（同时保留原始 html 文本供字符串断言）。
    this.children = [];
    if (html) parseHtml(html).forEach((n) => this.appendChild(n));
  }
  get innerHTML() { return this._html; }
  appendChild(c) {
    if (c.parent) c.parent._remove(c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  _remove(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
  }
  remove() { if (this.parent) { this.parent._remove(this); this.parent = null; } }
  insertAdjacentHTML(_pos, html) { parseHtml(html).forEach((n) => this.appendChild(n)); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  dispatchEvent(evt) {
    let node = this;
    if (!evt.target) evt.target = this;
    if (!evt.preventDefault) evt.preventDefault = () => {};
    while (node) {
      const fns = node._listeners.get(evt.type) || [];
      for (const fn of fns) fn.call(node, evt);
      node = node.parent;
    }
  }
  _descendants(out = []) {
    for (const c of this.children) { out.push(c); c._descendants(out); }
    return out;
  }
  matches(sel) {
    let s = sel.trim();
    const checked = s.endsWith(":checked");
    if (checked) s = s.slice(0, -":checked".length);
    let m = s.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\])?$/);
    if (s.startsWith(".") || s.startsWith("#")) m = null;
    if (s.startsWith(".")) {
      if (checked && !this.checked) return false;
      return this.classList.contains(s.slice(1));
    }
    if (s.startsWith("#")) return this.id === s.slice(1);
    if (!m) return false;
    const [, tag, attr, val] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (attr) {
      const actual = attr === "class" ? [...this.classList].join(" ") : this.attrs[attr] ?? this[attr];
      if (val !== undefined && String(actual) !== val) return false;
      if (val === undefined && actual === undefined) return false;
    }
    if (checked && !this.checked) return false;
    return true;
  }
  querySelector(sel) { return this._descendants().find((n) => n.matches(sel)); }
  querySelectorAll(sel) { return this._descendants().filter((n) => n.matches(sel)); }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches(sel)) return n; n = n.parent; }
    return null;
  }
}

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);

function parseHtml(html) {
  const root = new El("#root");
  const stack = [root];
  const tokenRe = /<\/?[a-zA-Z][\w-]*(?:[^<>]*?)\/?>|[^<]+/g;
  let tok;
  while ((tok = tokenRe.exec(html))) {
    const t = tok[0];
    if (t[0] !== "<") continue;
    const closing = t[1] === "/";
    const selfClose = t.endsWith("/>");
    const nameM = t.match(/^<\/?([\w-]+)/);
    const tag = nameM[1].toLowerCase();
    if (closing) { stack.pop(); continue; }
    const el = new El(tag);
    const attrRe = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
    const raw = t.replace(/^<\/?[\w-]+/, "").replace(/\/?>$/, "");
    let am;
    while ((am = attrRe.exec(raw))) {
      const [, k, v] = am;
      if (!k || k === "/") continue;
      if (v === undefined) { el.attrs[k] = true; continue; }
      el.attrs[k] = v;
      if (k === "class") v.split(/\s+/).forEach((c) => c && el.classList.add(c));
      else if (k === "id") el.id = v;
      else if (k.startsWith("data-")) el.dataset[k.slice(5)] = v;
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = true;
      else if (k === "hidden") el.hidden = true;
      else if (k === "name") el.name = v;
      else if (k === "type") el.type = v;
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
  }
  return root.children;
}

/* ---------------- document stub ---------------- */

const byId = new Map();
function mk(id, tag = "div") { const e = new El(tag); e.id = id; byId.set(id, e); return e; }

const form = mk("judge-form", "form");
const runnerRows = mk("runner-rows");
const recordRows = mk("record-rows");
const addRunner = mk("add-runner", "button");
const addRecord = mk("add-record", "button");
mk("record-count", "span");
mk("error-box"); mk("pending-hint");
const results = mk("results");
const diagnosisBox = mk("diagnosis-box");
diagnosisBox.hidden = true; // 真实 HTML 中带 hidden 属性
for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) mk(id, "input");
const sampleBtn = mk("sample-btn", "button");
const clearBtn = mk("clear-btn", "button");

for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) form.appendChild(byId.get(id));
form.appendChild(runnerRows);
form.appendChild(recordRows);

global.document = { getElementById: (id) => byId.get(id) };

/* ---------------- fetch stub：按 URL 分流裁决/诊断，可挂起/报错 ---------------- */

function lap(s, m, f, st, mt, ft) {
  return {
    start: { id: s, time: st }, middle: { id: m, time: mt }, finish: { id: f, time: ft },
    smTime: mt - st, mfTime: ft - mt, totalTime: ft - st,
  };
}

const adjudicateResult = {
  runners: [
    {
      runner: 101, lapCount: 2, totalTime: 52,
      laps: [
        lap("a1", "b1", "c1", 0, 12, 25),
        lap("a2", "b2", "c2", 30, 45, 57),
      ],
      unused: [
        { id: "x2", gate: "S", time: 30 },
        { id: "mX", gate: "M", time: 35 },
        { id: "z1", gate: "F", time: 300 },
      ],
    },
  ],
};

// 诊断结果：x2 同优可替代（整套两趟方案）、mX 仅次优可用、z1 无法成趟。
const diagnoseResult = {
  runners: [
    {
      runner: 101, lapCount: 2, totalTime: 52,
      diagnoses: [
        {
          id: "x2", gate: "S", time: 30, classification: "equal",
          alternative: {
            lapCount: 2, totalTime: 52,
            recordIds: ["a1", "b1", "c1", "x2", "b2", "c2"],
          },
        },
        { id: "mX", gate: "M", time: 35, classification: "inferior" },
        { id: "z1", gate: "F", time: 300, classification: "unusable" },
      ],
    },
  ],
};

const server = {
  adjMode: "valid",       // valid | invalid | hold
  diagMode: "valid",      // valid | invalid | neterr | hold
  adjHold: null,
  diagHold: null,
  diagRaw: null,
};
const calls = { adjudicate: 0, diagnose: [] };

global.fetch = async (url, opts) => {
  const respond = (data, ok, status) => ({
    ok,
    status,
    json: async () => (typeof data === "string" ? JSON.parse(data) : data),
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  });
  if (url === "/api/adjudicate") {
    calls.adjudicate += 1;
    JSON.parse(opts.body);
    if (server.adjMode === "invalid") {
      return respond({ ok: false, error: "模拟非法输入" }, false, 422);
    }
    if (server.adjMode === "hold") return respond(await server.adjHold, true, 200);
    return respond({ ok: true, result: adjudicateResult }, true, 200);
  }
  if (url === "/api/diagnose") {
    calls.diagnose.push(JSON.parse(opts.body));
    if (server.diagMode === "neterr") throw new TypeError("模拟断网");
    if (server.diagMode === "invalid") {
      return respond({ ok: false, error: "模拟诊断拒绝" }, false, 422);
    }
    if (server.diagMode === "hold") {
      return respond(await server.diagHold, true, 200);
    }
    if (server.diagRaw !== null) return respond(server.diagRaw, true, 200);
    return respond({ ok: true, result: diagnoseResult }, true, 200);
  }
  throw new Error(`unexpected url ${url}`);
};

/* ---------------- 加载真实 app.js ---------------- */

new Function(fs.readFileSync(path.join(__dirname, "static", "app.js"), "utf8"))();

/* ---------------- 测试辅助 ---------------- */

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ✓", msg); }
  else { failures++; console.error("  ✗", msg); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (id) => byId.get(id);
function setVal(id, v) { $(id).value = v; }
function fire(el, type) { el.dispatchEvent({ type, preventDefault() {}, target: el }); }
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

function setRow(ids, runner, gate, time) {
  const rows = recordRows.querySelectorAll(".record-row");
  for (const row of rows) {
    if (row.querySelector(".rec-id").value === "") {
      row.querySelector(".rec-id").value = ids;
      row.querySelector(".rec-runner").value = runner;
      row.querySelector(".rec-gate").value = gate;
      row.querySelector(".rec-time").value = time;
      return row;
    }
  }
  throw new Error("no empty row");
}

const diagState = () => globalThis.__getDiagnosisStateForTest();
const diagHtml = () => diagnosisBox.innerHTML;
function clickDiag() {
  const btn = diagnosisBox.querySelector(".diagnose-run") ||
    diagnosisBox.querySelector(".diagnose-rerun");
  assert(btn, "诊断按钮存在");
  fire(btn, "click");
  return btn;
}
async function adjudicate() { fire(form, "submit"); await flush(); }

async function setupValid() {
  setVal("smMin", "10"); setVal("smMax", "60");
  setVal("mfMin", "10"); setVal("mfMax", "60");
  runnerRows.querySelector(".runner-number").value = "101";
  for (let i = 0; i < 7; i++) fire(addRecord, "click"); // 初始 2 空行 → 共 9 行
  const rows = [
    ["a1", "101", "S", "0"], ["b1", "101", "M", "12"], ["c1", "101", "F", "25"],
    ["a2", "101", "S", "30"], ["b2", "101", "M", "45"], ["c2", "101", "F", "57"],
    ["x2", "101", "S", "30"], ["mX", "101", "M", "35"], ["z1", "101", "F", "300"],
  ];
  for (const [i, r, g, t] of rows) setRow(i, r, g, t);
  await adjudicate();
}

async function main() {
  console.log("场景0：初始无结果时诊断卡隐藏，无按钮可点");
  assert(diagnosisBox.hidden, "无裁决结果时诊断卡隐藏");

  await setupValid();
  console.log("场景1：合法裁决后出现“检查替代性”按钮，且不自动发诊断请求");
  assert(!diagnosisBox.hidden, "合法结果后诊断卡显示");
  assert(diagHtml().includes("检查替代性"), "显示检查替代性按钮");
  assert(diagState().status === "idle", "状态为 idle");
  const diagCallsBefore = calls.diagnose.length;
  assert(diagCallsBefore === 0, "裁决不会自动调用诊断接口");
  // 采纳结果照常展示，不受诊断卡影响。
  assert(results.innerHTML.includes("a1") && results.innerHTML.includes("a2"), "采纳结果正常展示");

  console.log("场景2：点击后发 POST /api/diagnose，载荷为当前完整裁决输入");
  clickDiag();
  assert(diagState().status === "loading", "点击后立即进入 loading");
  assert(diagHtml().includes("诊断未采纳记录"), "loading 态渲染");
  await flush();
  assert(diagState().status === "done", "成功后 done");
  assert(calls.diagnose.length === 1, "恰好发出一次诊断请求");
  const body = calls.diagnose[0];
  assert(body.standards.smMin === "10" && body.runners[0].number === "101",
    "诊断请求体即当前完整裁决输入");
  assert(body.records.length === 9, "诊断请求包含全部记录行（无空行占位）");

  console.log("场景3：三档分类与整套同优方案均按录入顺序展示");
  const html = diagHtml();
  // 未采纳记录在 chip 文本中渲染为“门 · ID · 秒数”，按该呈现定位录入顺序。
  const chipPos = (id) => html.indexOf(`· ${id} ·`);
  const p1 = chipPos("x2"), p2 = chipPos("mX"), p3 = chipPos("z1");
  assert(p1 < p2 && p2 < p3, "诊断按录入顺序：x2 → mX → z1");
  assert(html.includes("同优可替代"), "渲染同优可替代标签");
  assert(html.includes("仅次优可用"), "渲染仅次优可用标签");
  assert(html.includes("无法成趟"), "渲染无法成趟标签");
  assert(html.includes("整套替代方案"), "同优给出整套方案说明");
  assert(html.includes("第 1 趟：a1 → b1 → c1"), "替代方案第 1 趟 ID 序列");
  assert(html.includes("第 2 趟："), "替代方案展示第 2 趟");
  const stripTags = (s) => s.replace(/<[^>]*>/g, "");
  const lap2 = stripTags(html.slice(html.indexOf("第 2 趟："))).slice(0, 40);
  assert(lap2.includes("x2 → b2 → c2"),
    `替代方案第 2 趟包含目标记录 x2（实际：${lap2}）`);
  assert(html.includes("<strong>2</strong> 次") && html.includes("<strong>52</strong> 秒"),
    "展示计次数 2 与原总用时 52");
  assert(html.includes('diag-target-id">x2</strong>'), "目标记录 x2 在方案序列中高亮");
  // 采纳结果、名次等结果区内容未被诊断改动。
  assert(results.innerHTML.includes("a2"), "采纳结果保持为 a2（未被替代方案替换）");
  assert(!results.innerHTML.includes("同优可替代"), "分类标签不出现在采纳结果区");

  console.log("场景4：诊断 done 后修改任意输入 → 立即清除，非法/重算期间不可检查");
  setVal("smMin", "");
  fire($("smMin"), "input");
  assert(diagnosisBox.hidden, "输入一改诊断卡立即隐藏");
  assert(diagState().status === "idle" && diagHtml() === "", "诊断状态与内容清除");
  server.adjMode = "invalid";
  await adjudicate();
  assert(diagnosisBox.hidden, "非法输入期间诊断卡保持隐藏（不可检查）");
  assert(diagnosisBox.querySelector(".diagnose-run") === undefined,
    "非法期间没有检查按钮");
  setVal("smMin", "10");
  fire($("smMin"), "input"); // 防抖重算在途：此刻结果已清空
  assert(diagnosisBox.hidden, "重算期间诊断卡隐藏");
  server.adjMode = "valid";
  await new Promise((r) => setTimeout(r, 450));
  await flush();
  assert(!diagnosisBox.hidden && diagState().status === "idle",
    "新合法结果到达后恢复 idle，需重新检查（旧诊断不恢复）");
  assert(!diagHtml().includes("同优可替代"), "旧诊断内容未随重算恢复");

  console.log("场景5：迟到的诊断成功不得覆盖新输入状态");
  let resolveHold;
  server.diagMode = "hold";
  server.diagHold = new Promise((res) => { resolveHold = res; });
  clickDiag();
  assert(diagState().status === "loading", "再次诊断进入 loading");
  // 在途再点：loading 时不应再发请求
  const inFlightCalls = calls.diagnose.length;
  const btnAgain = diagnosisBox.querySelector(".diagnose-run");
  assert(btnAgain === undefined, "loading 态没有可点按钮");
  // 输入改变：旧诊断作废
  $("smMax").value = "61";
  fire($("smMax"), "input");
  assert(diagnosisBox.hidden, "输入改变后诊断卡隐藏");
  resolveHold({ ok: true, result: diagnoseResult });
  await flush();
  assert(diagnosisBox.hidden, "迟到的成功响应没有让诊断卡重新出现");
  server.diagMode = "valid";

  console.log("场景6：重算后旧诊断（含在途迟到失败）不恢复；新结果可重新诊断");
  server.adjMode = "valid";
  $("smMax").value = "60";
  fire($("smMax"), "input");
  await new Promise((r) => setTimeout(r, 450));
  await flush();
  assert(diagState().status === "idle", "重算完成后回到 idle");
  clickDiag();
  await flush();
  assert(diagState().status === "done", "重新检查成功");

  console.log("场景7：诊断 422 只在诊断卡报错，采纳结果/错误框不受影响，可重试");
  server.diagMode = "invalid";
  globalThis.__runDiagnosisForTest();
  await flush();
  assert(diagState().status === "error", "诊断 422 → error 态");
  assert(diagHtml().includes("模拟诊断拒绝"), "诊断卡显示服务端原因");
  assert(results.innerHTML.includes("a2"), "采纳结果仍在（未被诊断失败清掉）");
  assert($("error-box").hidden, "主错误框不显示诊断错误");
  server.diagMode = "valid";
  clickDiag(); // 错误态的“重试诊断”按钮同样带 diagnose-run 类
  await flush();
  assert(diagState().status === "done" && diagHtml().includes("同优可替代"),
    "重试后恢复成功诊断");

  console.log("场景8：网络失败为迟到响应时不得覆盖更新状态");
  let resolveHold2;
  server.diagMode = "hold";
  server.diagHold = new Promise((res) => { resolveHold2 = res; });
  globalThis.__runDiagnosisForTest(); // done 态“重新诊断”
  // 在途期间输入改变（版本前进），随后以“断网”方式让旧请求失败
  $("mfMax").value = "59";
  fire($("mfMax"), "input");
  assert(diagnosisBox.hidden, "输入变更后诊断卡隐藏");
  resolveHold2(Promise.reject(new TypeError("模拟断网迟到")));
  await flush();
  assert(diagnosisBox.hidden, "迟到的失败响应没有覆盖新状态");
  server.diagMode = "valid";
  $("mfMax").value = "60";
  fire($("mfMax"), "input");
  await new Promise((r) => setTimeout(r, 450));
  await flush();
  assert(diagState().status === "idle", "新合法结果后恢复 idle");

  console.log("场景9：非迟到的网络失败可展示错误并重试");
  server.diagMode = "neterr";
  globalThis.__runDiagnosisForTest();
  await flush();
  assert(diagState().status === "error" && diagHtml().includes("无法连接诊断服务"),
    "非迟到网络失败显示在诊断卡");
  assert(results.innerHTML.includes("a2"), "采纳结果仍在");
  server.diagMode = "valid";
  globalThis.__runDiagnosisForTest(); // 错误态“重试诊断”
  await flush();
  assert(diagState().status === "done", "重试成功");

  console.log("场景10：清空 / 填入示例路径清除诊断且不残留");
  fire($("clear-btn"), "click");
  await flush();
  assert(diagnosisBox.hidden && diagHtml() === "", "清空后诊断卡隐藏并清空");
  const diagCallsAtClear = calls.diagnose.length;
  // 填入示例：示例裁决由 stub 返回 adjudicateResult（101 一趟），诊断应回到 idle
  fire(sampleBtn, "click");
  await new Promise((r) => setTimeout(r, 450));
  await flush();
  assert(!diagnosisBox.hidden && diagState().status === "idle",
    "填入示例重算后诊断为初始 idle（旧诊断清除）");
  assert(calls.diagnose.length === diagCallsAtClear, "示例/清空本身不发起诊断请求");

  console.log("场景11：超过 2^53 的编号与秒数：诊断卡精确渲染，不被 Number 截断");
  const BIG = "9007199254740993";
  fire($("clear-btn"), "click");
  await flush();
  setVal("smMin", "10"); setVal("smMax", "60"); setVal("mfMin", "10"); setVal("mfMax", "60");
  runnerRows.querySelector(".runner-number").value = BIG;
  fire(runnerRows, "input");
  for (let i = 0; i < 4; i++) fire(addRecord, "click"); // 共 5 行记录
  const TS = "9007199254740992", TM = "9007199254741003", TF = "9007199254741014";
  setRow("h1", BIG, "S", TS);
  setRow("h2", BIG, "M", TM);
  setRow("h3", BIG, "F", TF);
  server.diagRaw = `{"ok":true,"result":{"runners":[{"runner":${BIG},"lapCount":1,` +
    `"totalTime":22,"diagnoses":[{"id":"hx","gate":"S","time":${TS},` +
    `"classification":"equal","alternative":{"lapCount":1,"totalTime":22,` +
    `"recordIds":["h1","h2","h3"]}}]}]}}`;
  const prevAdjMode = server.adjMode;
  // 用 raw 通道临时模拟：诊断 raw 已设置；裁决仍走 valid（runner 101），
  // 为让编号一致，直接构造一次裁决原文：
  const adjRaw = `{"ok":true,"result":{"runners":[{"runner":${BIG},"lapCount":1,"totalTime":22,` +
    `"laps":[{"start":{"id":"h1","time":${TS}},"middle":{"id":"h2","time":${TM}},` +
    `"finish":{"id":"h3","time":${TF}},"smTime":11,"mfTime":11,"totalTime":22}],` +
    `"unused":[{"id":"hx","gate":"S","time":${TS}}]}]}}`;
  server.adjMode = "hold";
  server.adjHold = Promise.resolve(adjRaw);
  fire(form, "submit");
  await flush();
  server.adjMode = prevAdjMode;
  assert(diagHtml() === "" || diagState().status === "idle", "大编号合法裁决后 idle");
  globalThis.__runDiagnosisForTest();
  await flush();
  assert(diagHtml().includes(`选手 ${BIG}`), "诊断卡精确显示大编号");
  assert(diagHtml().includes(TS), "诊断卡精确显示超大秒数");
  assert(diagHtml().includes("<strong>22</strong> 秒"), "原总用时 22 精确展示");
  assert(calls.diagnose[calls.diagnose.length - 1].runners[0].number === BIG,
    "诊断请求中的大编号以十进制字符串原样发送");
  server.diagRaw = null;

  console.log(failures === 0 ? "\nALL DIAGNOSIS SCENARIOS PASSED" : `\n${failures} ASSERTION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
