"""替代性诊断测试：固定用例 + 独立暴力枚举对拍 + HTTP 合同。"""

import functools
import json
import random
import sys

sys.path.insert(0, ".")
from app.adjudication import AdjudicationError, Record, adjudicate, _build_trips
from app.alternatives import diagnose

RANGES = {"SM": (10, 60), "MF": (10, 60)}


def recs(spec, runner=1):
    return [Record(id=i, runner=runner, gate=g, time=t) for i, g, t in spec]


def payload_from(runner, records, ranges=RANGES):
    return {
        "standards": {
            "smMin": ranges["SM"][0], "smMax": ranges["SM"][1],
            "mfMin": ranges["MF"][0], "mfMax": ranges["MF"][1],
        },
        "runners": [{"number": runner}],
        "records": [
            {"id": r.id, "runner": r.runner, "gate": r.gate, "time": r.time}
            for r in records
        ],
    }


def adopted_ids(adj_runner):
    return {
        rid
        for lap in adj_runner["laps"]
        for rid in (lap["start"]["id"], lap["middle"]["id"], lap["finish"]["id"])
    }


def brute_plans_for_record(runner_records, ranges, target_id):
    """独立参考实现：枚举包含 target_id 的所有合法完整方案，返回最优 (趟数, 总用时)。

    方案 = 合法趟的集合，两两时间严格分离；时间分离已隐含“记录不共用”
    （一趟内 s<m<f，相邻趟后 s > 前 f，不可能跨趟共用同一时刻记录），
    这里仍显式校验不共用，作为对生产算法假设的独立核对。
    """
    trips = _build_trips(runner_records, ranges)

    @functools.lru_cache(maxsize=None)
    def search(remaining, bound, used_fs, need):
        """返回 (remaining/bound/used/need 这一子问题下的最优 (趟数, 总用时))；
        need=True 表示所选趟中还必须出现一条含 target_id 的趟。

        趟按终点时间升序：合法链中下标更小的趟终点更早，故按“下标递增”的
        选/不选展开即可覆盖全部合法方案。bound 为已选趟终点的最大值。
        """
        rem = tuple(remaining)
        if not rem:
            return (0, 0) if not need else None
        head, rest = rem[0], rem[1:]
        best = search(rest, bound, used_fs, need)  # 不选 head
        t = trips[head]
        if t.s.time > bound and not (set(t.ids) & used_fs):
            sub = search(
                rest,
                max(bound, t.f.time),
                frozenset(used_fs | set(t.ids)),
                need and target_id not in t.ids,
            )
            if sub is not None:
                cand = (sub[0] + 1, sub[1] + t.total)
                # 计次数越多越好；计次数相同时总用时越短越好（不是元组字典序！）
                if best is None or (cand[0] > best[0]) or (
                    cand[0] == best[0] and cand[1] < best[1]
                ):
                    best = cand
        return best

    return search(tuple(range(len(trips))), -1, frozenset(), True)


def expected_category(runner, records, ranges=RANGES):
    """逐条未采纳记录的期望分类，完全独立于生产诊断实现。"""
    adj = adjudicate(payload_from(runner, records, ranges))["runners"][0]
    used = adopted_ids(adj)
    g_cnt, g_tot = adj["lapCount"], adj["totalTime"]
    trips = _build_trips(records, ranges)
    trip_ids = {rid for t in trips for rid in t.ids}
    out = []
    for r in records:
        if r.id in used:
            continue
        if r.id not in trip_ids:
            out.append((r.id, "no_lap", None))
            continue
        best = brute_plans_for_record(records, ranges, r.id)
        assert best is not None, r.id
        if best == (g_cnt, g_tot):
            out.append((r.id, "equal", best))
        else:
            out.append((r.id, "suboptimal", best))
    return adj, out


def test_sample_categories():
    spec = [
        ("a1", "S", 0), ("b1", "M", 12), ("c1", "F", 25),
        ("a2", "S", 30), ("b2", "M", 45), ("c2", "F", 58),
        ("x1", "M", 200), ("x2", "S", 31),
    ]
    dg = diagnose(payload_from(101, recs(spec, 101)))["runners"][0]
    assert [u["id"] for u in dg["unused"]] == ["a2", "x1"], dg
    assert dg["unused"][0]["category"] == "suboptimal"
    assert dg["unused"][1]["category"] == "no_lap"
    # 次优/无法成趟不带替代方案
    assert "alternative" not in dg["unused"][0]
    assert "alternative" not in dg["unused"][1]
    print("test_sample_categories OK")


def test_equal_single():
    spec = [("za", "S", 0), ("aa", "S", 0), ("m0", "M", 10), ("f0", "F", 20)]
    dg = diagnose(payload_from(1, recs(spec)))["runners"][0]
    assert len(dg["unused"]) == 1 and dg["unused"][0]["id"] == "za"
    u = dg["unused"][0]
    assert u["category"] == "equal", u
    alt = u["alternative"]
    assert alt["lapCount"] == 1 and alt["totalTime"] == 20
    assert alt["recordIds"] == ["za", "m0", "f0"], alt
    assert alt["laps"] == [{"start": "za", "middle": "m0", "finish": "f0"}]
    # 采纳结果未被诊断改变
    adj = adjudicate(payload_from(1, recs(spec)))["runners"][0]
    assert adj["laps"][0]["start"]["id"] == "aa"
    print("test_equal_single OK")


def test_equal_multilap_full_plan():
    # 不能只判单趟合格：za 所在的必须是整套 2 趟方案，且与现方案 (2, 40) 同优。
    spec = [
        ("zS", "S", 0), ("aS", "S", 0), ("M1", "M", 10), ("F1", "F", 20),
        ("S2", "S", 30), ("M2", "M", 40), ("F2", "F", 50),
    ]
    u = diagnose(payload_from(1, recs(spec)))["runners"][0]["unused"][0]
    assert u["category"] == "equal"
    alt = u["alternative"]
    assert (alt["lapCount"], alt["totalTime"]) == (2, 40)
    assert alt["recordIds"] == ["zS", "M1", "F1", "S2", "M2", "F2"], alt
    assert [tuple(x.values()) for x in alt["laps"]] == [
        ("zS", "M1", "F1"), ("S2", "M2", "F2")
    ]
    print("test_equal_multilap_full_plan OK")


def test_suboptimal_count_loss():
    # 跨两趟的重叠趟 xS/xM/xF：选它最多只能成 1 趟，现方案为 2 趟 -> 仅次优。
    spec = [
        ("S1", "S", 0), ("M1", "M", 10), ("F1", "F", 20),
        ("S2", "S", 30), ("M2", "M", 40), ("F2", "F", 50),
        ("xS", "S", 5), ("xM", "M", 22), ("xF", "F", 35),
    ]
    dg = diagnose(payload_from(1, recs(spec)))["runners"][0]
    cats = {u["id"]: u["category"] for u in dg["unused"]}
    assert cats == {"xS": "suboptimal", "xM": "suboptimal", "xF": "suboptimal"}, cats
    print("test_suboptimal_count_loss OK")


def test_suboptimal_time_loss():
    # 现方案 1 趟总用时 20；F3 只出现在总用时更高的趟里 -> 仅次优。
    spec = [
        ("S1", "S", 0), ("S2", "S", 5),
        ("M1", "M", 10), ("M2", "M", 15),
        ("F1", "F", 20), ("F3", "F", 28),
    ]
    dg = diagnose(payload_from(1, recs(spec)))["runners"][0]
    assert {u["id"]: u["category"] for u in dg["unused"]} == {
        "S2": "suboptimal", "M2": "suboptimal", "F3": "suboptimal"
    }
    print("test_suboptimal_time_loss OK")


def test_zero_lap_all_no_lap():
    spec = [("s1", "S", 0), ("m1", "M", 5), ("f1", "F", 9)]
    dg = diagnose(payload_from(7, recs(spec, 7)))["runners"][0]
    assert [u["id"] for u in dg["unused"]] == ["s1", "m1", "f1"]  # 按录入顺序
    assert all(u["category"] == "no_lap" for u in dg["unused"])
    print("test_zero_lap_all_no_lap OK")


def test_all_adopted():
    spec = [("d1", "S", 5), ("e1", "M", 15), ("f1", "F", 25)]
    dg = diagnose(payload_from(102, recs(spec, 102)))["runners"][0]
    assert dg["runner"] == 102 and dg["unused"] == []
    print("test_all_adopted OK")


def test_multi_runner_order():
    records = []
    for i, g, t in [
        ("a1", "S", 0), ("b1", "M", 12), ("c1", "F", 25), ("z1", "S", 0),
        ("d1", "S", 5), ("e1", "M", 15), ("f1", "F", 25),
    ]:
        records.append({"id": i, "runner": 101 if i[0] in "abcz" else 102,
                        "gate": g, "time": t})
    payload = {
        "standards": {"smMin": 10, "smMax": 60, "mfMin": 10, "mfMax": 60},
        "runners": [{"number": 101}, {"number": 102}],
        "records": records,
    }
    out = diagnose(payload)
    assert [r["runner"] for r in out["runners"]] == [101, 102]
    r1 = out["runners"][0]
    assert len(r1["unused"]) == 1 and r1["unused"][0]["id"] == "z1"
    assert r1["unused"][0]["category"] == "equal"
    assert out["runners"][1]["unused"] == []
    print("test_multi_runner_order OK")


def test_big_integers_lossless():
    big = "9007199254740992"
    payload = {
        "standards": {"smMin": 10, "smMax": 60, "mfMin": 10, "mfMax": 60},
        "runners": [{"number": big}],
        "records": [
            {"id": "za", "runner": big, "gate": "S", "time": "9007199254740992"},
            {"id": "aa", "runner": big, "gate": "S", "time": "9007199254740992"},
            {"id": "m0", "runner": big, "gate": "M", "time": "9007199254741003"},
            {"id": "f0", "runner": big, "gate": "F", "time": "9007199254741014"},
        ],
    }
    out = diagnose(payload)
    r = out["runners"][0]
    assert r["runner"] == 9007199254740992
    u = r["unused"][0]
    assert u["id"] == "za" and u["time"] == 9007199254740992 and u["category"] == "equal"
    # 原总用时 22 秒：差值在任意精度整数上精确，不经浮点。
    assert u["alternative"]["totalTime"] == 22
    text = json.dumps(out)
    assert f'"runner": {big}' in text
    print("test_big_integers_lossless OK")


def test_validation_shared():
    # 诊断与裁决共用校验：非法输入抛同一个 AdjudicationError。
    bad = {
        "standards": {"smMin": 99, "smMax": 1, "mfMin": 10, "mfMax": 60},
        "runners": [{"number": 1}],
        "records": [],
    }
    try:
        diagnose(bad)
        raise AssertionError("非法输入应抛错")
    except AdjudicationError as e:
        assert "下限不能大于上限" in str(e)
    print("test_validation_shared OK")


def test_alternative_plan_is_valid():
    # 所有 equal 替代方案都必须真的合法：趟内两段在区间内、相邻趟严格分离、
    # 记录不共用，且包含目标记录。
    spec = [
        ("S1", "S", 0), ("zS1", "S", 1), ("M1", "M", 10), ("F1", "F", 20),
        ("S2", "S", 30), ("M2", "M", 40), ("zF2", "F", 49), ("F2", "F", 50),
        ("xS", "S", 5), ("xM", "M", 22), ("xF", "F", 35),
    ]
    records = recs(spec)
    by_id = {r.id: r for r in records}
    dg = diagnose(payload_from(1, records))["runners"][0]
    adj = adjudicate(payload_from(1, records))["runners"][0]
    for u in dg["unused"]:
        if u["category"] != "equal":
            continue
        alt = u["alternative"]
        ids = alt["recordIds"]
        assert u["id"] in ids, (u["id"], ids)
        assert len(ids) == len(set(ids)) == 3 * alt["lapCount"]
        assert alt["totalTime"] == adj["totalTime"] and alt["lapCount"] == adj["lapCount"]
        prev_f = None
        for lap in alt["laps"]:
            s, m, f = by_id[lap.start], by_id[lap.middle], by_id[lap.finish]
            assert 10 <= m.time - s.time <= 60
            assert 10 <= f.time - m.time <= 60
            if prev_f is not None:
                assert s.time > prev_f
            prev_f = f.time
    print("test_alternative_plan_is_valid OK")


def random_fuzz(seed, n_records):
    rng = random.Random(seed)
    pool = ["S", "M", "F"]
    spec = [(f"r{i:03d}", rng.choice(pool), rng.randint(0, 120)) for i in range(n_records)]
    records = recs(spec)
    _, expected = expected_category(1, records)
    dg = diagnose(payload_from(1, records))["runners"][0]
    got = [(u["id"], u["category"]) for u in dg["unused"]]
    exp = [(rid, cat) for rid, cat, _ in expected]
    assert got == exp, f"seed={seed}: got={got} expected={exp}"
    # equal 必须携带与现方案同计次、同总用时的合法整套方案
    adj = adjudicate(payload_from(1, records))["runners"][0]
    by_id = {r.id: r for r in records}
    for u, (_, cat, best) in zip(dg["unused"], expected):
        if cat != "equal":
            assert "alternative" not in u
            continue
        alt = u["alternative"]
        assert (alt["lapCount"], alt["totalTime"]) == (adj["lapCount"], adj["totalTime"])
        assert alt["recordIds"] and u["id"] in alt["recordIds"]
        assert len(set(alt["recordIds"])) == len(alt["recordIds"])
        prev_f = None
        for lap in alt["laps"]:
            s, m, f = by_id[lap["start"]], by_id[lap["middle"]], by_id[lap["finish"]]
            assert 10 <= m.time - s.time <= 60 and 10 <= f.time - m.time <= 60
            if prev_f is not None:
                assert s.time > prev_f
            prev_f = f.time


def test_http_contract():
    from starlette.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    body = {
        "standards": {"smMin": 10, "smMax": 60, "mfMin": 10, "mfMax": 60},
        "runners": [{"number": 1}],
        "records": [
            {"id": "za", "runner": 1, "gate": "S", "time": 0},
            {"id": "aa", "runner": 1, "gate": "S", "time": 0},
            {"id": "m0", "runner": 1, "gate": "M", "time": 10},
            {"id": "f0", "runner": 1, "gate": "F", "time": 20},
        ],
    }
    r = client.post("/api/diagnose", json=body)
    assert r.status_code == 200 and r.json()["ok"] is True
    u = r.json()["diagnosis"]["runners"][0]["unused"][0]
    assert u["category"] == "equal" and u["alternative"]["recordIds"][0] == "za"

    bad = dict(body)
    bad["standards"] = {"smMin": 99, "smMax": 1, "mfMin": 10, "mfMax": 60}
    r2 = client.post("/api/diagnose", json=bad)
    assert r2.status_code == 422 and r2.json()["ok"] is False and "下限" in r2.json()["error"]

    r3 = client.post("/api/diagnose", content=b"xxx", headers={"content-type": "application/json"})
    assert r3.status_code == 400 and r3.json()["ok"] is False

    # POST /api/adjudicate 合同与行为保持不变
    r4 = client.post("/api/adjudicate", json=body)
    assert r4.status_code == 200
    assert r4.json()["result"]["runners"][0]["laps"][0]["start"]["id"] == "aa"
    print("test_http_contract OK")


if __name__ == "__main__":
    test_sample_categories()
    test_equal_single()
    test_equal_multilap_full_plan()
    test_suboptimal_count_loss()
    test_suboptimal_time_loss()
    test_zero_lap_all_no_lap()
    test_all_adopted()
    test_multi_runner_order()
    test_big_integers_lossless()
    test_validation_shared()
    test_alternative_plan_is_valid()
    test_http_contract()
    for seed in range(300):
        random_fuzz(seed, 5 + seed % 12)
    print("fuzz x300 OK")
    print("ALL DIAGNOSIS TESTS PASSED")
