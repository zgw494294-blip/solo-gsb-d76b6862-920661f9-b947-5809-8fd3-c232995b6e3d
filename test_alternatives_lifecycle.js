/* 最小 DOM/事件 stub：加载真实 static/app.js，端到端验证“检查替代性”诊断生命周期。 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ---------------- mini DOM（与其余前端测试同一套最小桩） ---------------- */

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
    this.disabled = false;
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
    this.children = [];
    // 诊断实现会向卡片内的 .diag-output 槽位二次写入 innerHTML 并随后
    // querySelector 读取/依赖事件冒泡，这里与真实 DOM 一致解析非空 HTML，
    // 且把新节点的父级正确指向当前元素（不是解析时的临时根）。
    if (html) {
      parseHtml(html).forEach((n) => {
        n.parent = this;
        this.children.push(n);
      });
    }
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
    // 支持复合类选择器（如 .diag-tag.equal）：每一个类都必须存在。
    if (s.startsWith(".")) {
      if (checked && !this.checked) return false;
      return s.split(".").filter(Boolean).every((c) => this.classList.contains(c));
    }
    let m = s.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\])?$/);
    if (s.startsWith("#")) m = null;
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
    let raw = t.replace(/^<\/?[\w-]+/, "").replace(/\/?>$/, "");
    // 属性解析：先摘出所有 key="value"（引号内空格受保护），
    // 剩余的裸词只可能是无引号布尔属性（如 hidden）。
    const valAttrs = [];
    raw = raw.replace(/([\w:-]+)\s*=\s*"([^"]*)"/g, (_m, k, v) => {
      valAttrs.push([k, v]);
      return " ";
    });
    raw.trim().split(/\s+/).forEach((token) => {
      if (/^[\w:-]+$/.test(token)) {
        if (token === "hidden") el.hidden = true;
        else if (token === "disabled") el.disabled = true;
        else el.attrs[token] = true;
      }
    });
    for (const [k, v] of valAttrs) {
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
const diagnosis = mk("diagnosis");
for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) mk(id, "input");
mk("sample-btn", "button"); mk("clear-btn", "button");

for (const id of ["smMin", "smMax", "mfMin", "mfMax"]) form.appendChild(byId.get(id));
form.appendChild(runnerRows);
form.appendChild(recordRows);

global.document = { getElementById: (id) => byId.get(id) };

/* ---------------- fetch stub ---------------- */

function lap(runner, s, m, f, st, mt, ft) {
  return {
    start: { id: s, time: st }, middle: { id: m, time: mt }, finish: { id: f, time: ft },
    smTime: mt - st, mfTime: ft - mt, totalTime: ft - st,
  };
}

// 裁决响应：选手 101 一趟 a1-b1-c1（总 22），无未采纳；
// 载入多记录输入后由测试切换为含未采纳记录的 diagResult。
const validResult = {
  runners: [
    { runner: 101, lapCount: 1, totalTime: 22, laps: [lap(101, "a1", "b1", "c1", 0, 12, 22)], unused: [] },
  ],
};

const server = {
  mode: "valid",
  result: validResult,
  diagnosis: null,
  hold: null,
  adjHold: null,
  urlLog: [],
};
global.fetch = async (url, opts) => {
  server.urlLog.push(url);
  JSON.parse(opts.body);
  const respond = (data, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => (typeof data === "string" ? JSON.parse(data) : data),
    text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
  });
  if (url === "/api/diagnose") {
    if (server.mode === "diag-invalid") return respond({ ok: false, error: "模拟诊断非法" }, false, 422);
    if (server.mode === "diag-netfail") throw new Error("模拟诊断断网");
    if (server.hold) return respond(await server.hold);
    return respond({ ok: true, diagnosis: server.diagnosis });
  }
  if (server.mode === "invalid") return respond({ ok: false, error: "模拟非法输入" }, false, 422);
  if (server.adjHold) return respond(await server.adjHold);
  return respond({ ok: true, result: server.result });
};

/* ---------------- 加载真实 app.js ---------------- */

new Function(fs.readFileSync(path.join(__dirname, "static", "app.js"), "utf8"))();

/* ---------------- 测试辅助 ---------------- */

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓", msg);
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
async function adjudicate() { fire(form, "submit"); await flush(); }
const renderedAdj = () => results.innerHTML;
const renderedDiag = () => diagnosis.innerHTML;
function diagButton() { return diagnosis.querySelector(".diag-check-btn"); }
function diagStatus() { return diagnosis.querySelector(".diag-status"); }
async function clickDiagnose() { fire(diagButton(), "click"); await flush(); }

/* ---------------- 场景 ---------------- */

async function main() {
  // 初始合法输入：区间 10~60，选手 101，一趟 a1-b1-c1。
  setVal("smMin", "10"); setVal("smMax", "60"); setVal("mfMin", "10"); setVal("mfMax", "60");
  runnerRows.querySelector(".runner-number").value = "101";
  for (let i = 0; i < 6; i++) fire(addRecord, "click");
  setRow("a1", "101", "S", "0");
  setRow("b1", "101", "M", "12");
  setRow("c1", "101", "F", "22");
  await adjudicate();
  assert(renderedAdj().includes("a1"), "初始合法裁决已渲染");

  console.log("场景1：合法结果出现检查卡片与按钮，走 /api/diagnose");
  const card = diagnosis.querySelector(".diagnosis-card");
  assert(!!card, "结果区底部展示“检查替代性”卡片");
  assert(!!diagButton() && !diagButton().disabled, "检查按钮可见且可用");
  assert(diagStatus().hidden, "初始无诊断状态文案");
  // 含 za（同优可替代）、x1（无法成趟）、a2（仅次优）的诊断载荷（按录入顺序）。
  server.diagnosis = {
    runners: [
      {
        runner: 101,
        unused: [
          {
            id: "za", gate: "S", time: 0, category: "equal",
            alternative: {
              lapCount: 1, totalTime: 22,
              recordIds: ["za", "b1", "c1"],
              laps: [{ start: "za", middle: "b1", finish: "c1" }],
            },
          },
          { id: "a2", gate: "S", time: 30, category: "suboptimal" },
          { id: "x1", gate: "M", time: 200, category: "no_lap" },
        ],
      },
    ],
  };
  const beforeAdj = renderedAdj();
  const urlCount = server.urlLog.length;
  await clickDiagnose();
  assert(server.urlLog[server.urlLog.length - 1] === "/api/diagnose", "点击经 HTTP POST /api/diagnose");
  assert(server.urlLog.length === urlCount + 1, "一次点击只发一次诊断请求");

  console.log("场景2：诊断只读展示——采纳结果、复核/名次不变");
  assert(renderedAdj() === beforeAdj, "采纳结果 HTML 原样保留，诊断不替换采纳");
  assert(renderedDiag().includes("同优可替代"), "展示“同优可替代”");
  assert(renderedDiag().includes("仅次优可用"), "展示“仅次优可用”");
  assert(renderedDiag().includes("无法成趟"), "展示“无法成趟”");
  assert(
    renderedDiag().indexOf("za") < renderedDiag().indexOf("a2") &&
      renderedDiag().indexOf("a2") < renderedDiag().indexOf("x1"),
    "未采纳记录按录入顺序返回与展示"
  );
  assert(renderedDiag().includes("za → b1 → c1"), "同优展示整套方案 ID 序列");
  assert(/计次 <strong>1<\/strong> 次/.test(renderedDiag()), "展示替代方案计次数");
  assert(/原总用时 <strong>22<\/strong> 秒/.test(renderedDiag()), "展示替代方案原总用时");
  assert(!diagButton().disabled, "诊断完成后按钮恢复可点（可再次检查）");

  console.log("场景3：输入一改即清除诊断，且迟到的诊断响应不得覆盖新状态");
  let resolveHold;
  server.hold = new Promise((r) => { resolveHold = r; });
  fire(diagButton(), "click"); // 请求在途（监听器为 async，先让一个微程渲染 loading）
  await tick();
  assert(diagButton() && diagButton().disabled, "诊断在途按钮禁用");
  // 在途期间改动输入：诊断区立即清空，裁决防抖重算
  setRow; // no-op，保持行引用
  const rowA1 = [...recordRows.querySelectorAll(".record-row")].find(
    (r) => r.querySelector(".rec-id").value === "a1"
  );
  rowA1.querySelector(".rec-time").value = "1";
  fire(rowA1.querySelector(".rec-time"), "input");
  assert(renderedDiag() === "", "输入一改诊断区立即清空（不等响应）");
  assert(!diagButton(), "清空后诊断按钮也不存在（不可检查）");
  resolveHold({ ok: true, diagnosis: server.diagnosis }); // 迟到的成功
  await flush();
  assert(renderedDiag() === "", "迟到的成功响应未恢复/覆盖诊断");
  server.hold = null;
  rowA1.querySelector(".rec-time").value = "0";
  fire(rowA1.querySelector(".rec-time"), "input");
  await new Promise((r) => setTimeout(r, 420));
  await flush();
  assert(
    !!diagButton() && !renderedDiag().includes("同优可替代"),
    "重算回合法后诊断卡片是全新空白初始态（按钮在、旧结果不在）"
  );
  assert(!renderedDiag().includes("同优可替代"), "旧诊断内容未被重算带回");

  console.log("场景4：非法输入期间没有卡片、不可检查");
  server.mode = "invalid";
  setVal("smMin", "");
  fire($("smMin"), "input");
  await adjudicate();
  assert(renderedAdj() === "" && $("error-box").hidden === false, "非法：只显示错误");
  assert(renderedDiag() === "" && !diagButton(), "非法期间诊断卡片消失、无法点击检查");
  setVal("smMin", "10");
  fire($("smMin"), "input");
  server.mode = "valid";
  await adjudicate();
  assert(!!diagButton() && renderedDiag() !== "", "恢复合法后检查卡片重新出现（初始空白）");
  assert(!renderedDiag().includes("同优可替代"), "恢复后不自动带旧诊断，需重新点击");

  console.log("场景5：诊断失败只在诊断区报错，采纳结果与按钮状态安全");
  server.mode = "diag-invalid";
  const adjBeforeFail = renderedAdj();
  await clickDiagnose();
  assert(renderedAdj() === adjBeforeFail, "诊断失败不影响采纳结果");
  assert(
    renderedDiag().includes("模拟诊断非法") && renderedDiag().includes("diag-status err"),
    "诊断区显示失败原因（错误态，不影响采纳结果）"
  );
  assert(!diagButton().disabled, "失败后按钮恢复可点");
  server.mode = "valid";

  console.log("场景6：诊断网络失败（迟到失败不得覆盖新状态）");
  let resolveHold2;
  server.hold = new Promise((r) => { resolveHold2 = r; });
  fire(diagButton(), "click");
  const rowB1 = [...recordRows.querySelectorAll(".record-row")].find(
    (r) => r.querySelector(".rec-id").value === "b1"
  );
  rowB1.querySelector(".rec-time").value = "13";
  fire(rowB1.querySelector(".rec-time"), "input"); // 输入变更：诊断区清空
  rowB1.querySelector(".rec-time").value = "12";
  fire(rowB1.querySelector(".rec-time"), "input");
  resolveHold2({ ok: true, diagnosis: server.diagnosis }); // 旧请求若成功也过期
  await flush();
  server.hold = null;
  await new Promise((r) => setTimeout(r, 420));
  await flush();
  assert(!renderedDiag().includes("同优可替代"), "在途诊断被输入变更作废，旧成功未落地");

  console.log("场景7：诊断在途时重复点击不发第二个请求");
  server.hold = new Promise(() => {}); // 永不返回
  const n0 = server.urlLog.length;
  fire(diagButton(), "click");
  await flush();
  fire(diagButton(), "click"); // 按钮已禁用，监听器内部也有在途守卫
  fire(diagButton(), "click");
  await flush();
  const diagCalls = server.urlLog.slice(n0).filter((u) => u === "/api/diagnose").length;
  assert(diagCalls === 1, `在途期间仅 1 个诊断请求（实际 ${diagCalls}）`);
  server.hold = null;
  // 清掉在途：改动一次输入让旧请求作废并重新裁决
  rowB1.querySelector(".rec-time").value = "12";
  fire(rowB1.querySelector(".rec-time"), "input");
  await new Promise((r) => setTimeout(r, 420));
  await flush();

  console.log("场景8：请求体即当前完整裁决输入（standards/runners/records 全量）");
  let captured = null;
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (url === "/api/diagnose") {
      captured = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, diagnosis: server.diagnosis }),
        json: async () => ({ ok: true, diagnosis: server.diagnosis }),
      };
    }
    return origFetch(url, opts); // 裁决请求照常走桩，保证采纳结果仍在
  };
  await clickDiagnose();
  global.fetch = origFetch;
  assert(captured && captured.standards.smMin === "10", "诊断携带当前区间");
  assert(captured.runners.map((r) => r.number).includes("101"), "诊断携带选手列表");
  assert(captured.records.some((r) => r.id === "a1"), "诊断携带完整感应记录");
  assert(renderedDiag().includes("za → b1 → c1"), "成功诊断照常展示");

  console.log("场景9：所有记录都被采纳时诊断列表为空提示");
  server.diagnosis = { runners: [{ runner: 101, unused: [] }] };
  await clickDiagnose();
  assert(renderedDiag().includes("没有未采纳记录"), "无未采纳记录给出空态提示");

  console.log("场景10：填入示例 / 清空 会清除诊断卡片");
  server.diagnosis = {
    runners: [
      { runner: 101, unused: [{ id: "zz", gate: "S", time: 1, category: "no_lap" }] },
    ],
  };
  fire($("sample-btn"), "click");
  await new Promise((r) => setTimeout(r, 420));
  await flush();
  assert(!renderedDiag().includes("zz"), "填入示例后旧诊断消失，等待新结果的新卡片");
  assert(!!diagButton(), "示例重算合法后卡片重建（空白）");
  fire($("clear-btn"), "click");
  await flush();
  assert(renderedDiag() === "" && !diagButton(), "清空后诊断卡片与按钮一并消失");

  console.log("场景11：大整数编号/秒数无损展示诊断结果");
  const BIG = "9007199254740992";
  setVal("smMin", "10"); setVal("smMax", "60"); setVal("mfMin", "10"); setVal("mfMax", "60");
  runnerRows.querySelector(".runner-number").value = BIG;
  fire(runnerRows, "input");
  fire(addRecord, "click");
  setRow("ba1", BIG, "S", "9007199254740992");
  // 大编号裁决结果与诊断结果都走原文响应（数字字面量超出安全整数，走无损解析器）
  const prevFetch2 = global.fetch;
  global.fetch = async (url, opts) => {
    if (url === "/api/diagnose") {
      const raw = `{"ok":true,"diagnosis":{"runners":[{"runner":${BIG},"unused":[` +
        `{"id":"za","gate":"S","time":9007199254740992,"category":"equal","alternative":{` +
        `"lapCount":1,"totalTime":22,"recordIds":["za","bb1","bc1"],` +
        `"laps":[{"start":"za","middle":"bb1","finish":"bc1"}]}}]}]}}`;
      return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
    }
    const adjRaw = `{"ok":true,"result":{"runners":[{"runner":${BIG},"lapCount":1,"totalTime":22,"laps":[` +
      `{"start":{"id":"aa1","time":${BIG}},"middle":{"id":"bb1","time":9007199254741003},` +
      `"finish":{"id":"bc1","time":9007199254741014},"smTime":11,"mfTime":11,"totalTime":22}],` +
      `"unused":[{"id":"za","gate":"S","time":${BIG}}]}]}}`;
    return { ok: true, status: 200, text: async () => adjRaw, json: async () => JSON.parse(adjRaw) };
  };
  await adjudicate();
  assert(renderedAdj().includes(BIG), "大编号采纳结果无损渲染");
  await clickDiagnose();
  assert(renderedDiag().includes(BIG), "诊断中目标记录大秒数无损展示");
  assert(renderedDiag().includes("同优可替代"), "大整数场景分类仍正确");
  global.fetch = prevFetch2;

  console.log(failures === 0 ? "\nALL DIAGNOSIS LIFECYCLE SCENARIOS PASSED" : `\n${failures} ASSERTION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
