"""未采纳记录的替代性诊断（只读，不参与裁决）。

对每名选手的每一条**未采纳**感应记录回答一个问题：该记录能否进入某套
合法完整方案？分类（按录入顺序返回）：

- ``equal``（同优可替代）：存在一套包含该记录的合法完整方案，其计次数与
  原总用时都与现采纳方案相同。同优比较**只看 (计次数, 总用时)**，不考虑
  ID 字典序决胜，也不考虑仅作用于名次表的罚秒。
- ``suboptimal``（仅次优可用）：不存在这样的同优方案，但该记录至少能出现
  在某一条合法趟中（无论能否与其他趟串成最多趟的链）。
- ``no_lap``（无法成趟）：该记录不属于任何合法趟。

注意“同优”判定针对的是**整套方案**而不是单趟合格：必须真的构造出一套
计次数、原总用时与现方案相同的完整合法方案，并随结果返回该方案按计次
时间顺序串接的完整 ID 序列、计次数与原总用时。

算法（与裁决 DP 相互独立，不改变任何裁决行为）：

1. 前向 DP：``end[i]`` 为以 trips[i] 结尾的最优链键（与裁决同一比较规则）；
2. 反向 DP：``start[i]`` 为以 trips[i] 开头的最优链键；
3. 包含 trips[i] 的最优完整方案键 = 前向链与反向链在 i 处拼接
   （两链除 i 外不可能共用记录：前向任一记录时间 ≤ 前一趟终点 < i 的起点，
   后向任一记录时间 ≥ 后一趟起点 > i 的终点）。

趟按终点时间排序（沿用 adjudication._build_trips 的确定序），因此反向
DP 中合法后继（起点严格晚于本趟终点）的下标必然更大，倒序枚举即可。
"""

from __future__ import annotations

from bisect import bisect_right
from typing import Any

from .adjudication import (
    Record,
    Trip,
    _adjudicate_one,
    _build_trips,
    _key_better,
    parse_payload,
)

# 一条链的比较键：(趟数, 总用时, ID 串接元组)，与裁决 DP 同构。
Key = tuple[int, int, tuple[str, ...]]


def _forward_dp(trips: list[Trip]) -> tuple[list[Key], list[int]]:
    """前向 DP：每条趟“结尾”的最优链。

    返回 (每条趟结尾的最优键, 前驱下标(-1 为首趟))。
    与裁决所用的前缀最优 + 二分前驱写法保持一致（另存每个下标的自身最优）。
    """
    finish_times = [t.f.time for t in trips]
    end_keys: list[Key] = []
    prev: list[int] = []
    prefix_best: list[Key] = []
    prefix_idx: list[int] = []

    for i, trip in enumerate(trips):
        best: Key = (1, trip.total, trip.ids)
        best_prev = -1

        j = bisect_right(finish_times, trip.s.time - 1, 0, i) - 1
        if j >= 0:
            pk = prefix_best[j]
            cand: Key = (pk[0] + 1, pk[1] + trip.total, pk[2] + trip.ids)
            if _key_better(cand, best):
                best = cand
                best_prev = prefix_idx[j]

        end_keys.append(best)
        prev.append(best_prev)

        if i == 0:
            prefix_best.append(best)
            prefix_idx.append(i)
        else:
            pb = prefix_best[-1]
            if _key_better(best, pb):
                prefix_best.append(best)
                prefix_idx.append(i)
            else:
                prefix_best.append(pb)
                prefix_idx.append(prefix_idx[-1])

    return end_keys, prev


def _backward_dp(trips: list[Trip]) -> tuple[list[Key], list[int]]:
    """反向 DP：每条趟“开头”的最优链（合法后继的起点须严格晚于本趟终点）。"""
    n = len(trips)
    start_keys: list[Key] = [(0, 0, ())] * n
    nxt: list[int] = [-1] * n
    starts = [t.s.time for t in trips]

    for i in range(n - 1, -1, -1):
        trip = trips[i]
        best: Key = (1, trip.total, trip.ids)
        best_j = -1
        # 趟按终点升序；起点严格晚于本趟终点的后继下标必然 > i，其 start 键已算好。
        for j in range(i + 1, n):
            if starts[j] > trip.f.time:
                sk = start_keys[j]
                cand = (1 + sk[0], trip.total + sk[1], trip.ids + sk[2])
                if _key_better(cand, best):
                    best = cand
                    best_j = j
        start_keys[i] = best
        nxt[i] = best_j

    return start_keys, nxt


def _chain_indices(i: int, prev: list[int], nxt: list[int]) -> list[int]:
    """还原包含 trips[i] 的最优完整方案的趟下标（按计次时间顺序）。"""
    end_part: list[int] = []
    cur = i
    while cur != -1:
        end_part.append(cur)
        cur = prev[cur]
    end_part.reverse()

    tail: list[int] = []
    cur = nxt[i]
    while cur != -1:
        tail.append(cur)
        cur = nxt[cur]
    return end_part + tail


def _alternative_payload(trips: list[Trip], indices: list[int], key: Key) -> dict:
    chain = [trips[i] for i in indices]
    return {
        "lapCount": key[0],
        "totalTime": key[1],
        "recordIds": list(key[2]),
        "laps": [
            {"start": t.s.id, "middle": t.m.id, "finish": t.f.id} for t in chain
        ],
    }


def _diagnose_one(
    runner: int,
    records: list[Record],
    ranges: dict[str, tuple[int, int]],
    adopted_result: dict,
) -> dict:
    mine = [r for r in records if r.runner == runner]
    trips = _build_trips(mine, ranges)

    end_keys, prev = _forward_dp(trips)
    start_keys, nxt = _backward_dp(trips)

    # 采纳集合与现方案的 (计次数, 原总用时) 直接取自真实裁决输出，
    # 保证“同优”对照的就是页面当前展示的现方案，不依赖诊断侧重算结果。
    adopted: set[str] = {
        rid
        for lap in adopted_result["laps"]
        for rid in (lap["start"]["id"], lap["middle"]["id"], lap["finish"]["id"])
    }
    global_count = adopted_result["lapCount"]
    global_total = adopted_result["totalTime"]

    # 记录 ID -> 包含该记录的最优完整方案 (键, 方案趟下标)。
    # 趟数至多 40、每选手至多 40 条记录，直接逐趟扫描即可。
    best_for_id: dict[str, tuple[Key, list[int]]] = {}
    for i, trip in enumerate(trips):
        ek = end_keys[i]
        sk = start_keys[i]
        key: Key = (
            ek[0] + sk[0] - 1,
            ek[1] + sk[1] - trip.total,
            ek[2] + sk[2][3:],
        )
        plan = _chain_indices(i, prev, nxt)
        for rid in trip.ids:
            old = best_for_id.get(rid)
            if old is None or _key_better(key, old[0]):
                best_for_id[rid] = (key, plan)

    unused_out: list[dict] = []
    # 严格按录入顺序（mine 保留 parse_payload 的输入次序）输出未采纳记录。
    for rec in mine:
        if rec.id in adopted:
            continue
        entry: dict[str, Any] = {"id": rec.id, "gate": rec.gate, "time": rec.time}
        found = best_for_id.get(rec.id)
        if found is None:
            entry["category"] = "no_lap"
        else:
            key, plan = found
            # 同优只比较 (计次数, 原总用时)：不看 ID 决胜，也不看罚秒。
            if key[0] == global_count and key[1] == global_total:
                entry["category"] = "equal"
                entry["alternative"] = _alternative_payload(trips, plan, key)
            else:
                entry["category"] = "suboptimal"
        unused_out.append(entry)

    return {"runner": runner, "unused": unused_out}


def diagnose(payload: Any) -> dict:
    """诊断入口：与裁决共用同一套输入校验，非法时抛出 AdjudicationError。"""
    runner_ids, ranges, records = parse_payload(payload)
    runners_out: list[dict] = []
    for rid in runner_ids:
        # 现方案直接走真实裁决函数：诊断只读对照，不改任何裁决行为。
        adopted_result = _adjudicate_one(rid, records, ranges)
        runners_out.append(_diagnose_one(rid, records, ranges, adopted_result))
    return {"runners": runners_out}
