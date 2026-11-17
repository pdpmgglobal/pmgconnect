/*
 * PMG ระบบจัดการงาน — Supabase adapter
 * ทำหน้าที่แทน claude.use("db") และ claude.use("user") ที่ระบบเดิมเรียกใช้
 * จึงไม่ต้องแก้โค้ดส่วนแผนกต่างๆ ของระบบ
 *
 * db   : H.doc("coll/id").set/delete/onSnapshot , H.collection("coll").add/onSnapshot
 * user : U.id() U.isOwner() U.me() U.profiles(ids) U.search(q)
 */
(function () {
  "use strict";

  var cfg = window.PMG_CONFIG || {};
  var sb = null, session = null, profile = null, myId = "";
  var cols = {}, chan = null, everSub = false, hadAccess = false, recovering = false;

  /* ---------- helpers ---------- */
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  function clean(o) { return JSON.parse(JSON.stringify(o || {})); }

  function init() {
    if (sb) return;
    var bad = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
      /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
    if (bad) throw new Error("ยังไม่ได้ตั้งค่า config.js (SUPABASE_URL / SUPABASE_ANON_KEY)");
    if (!window.supabase || !window.supabase.createClient) throw new Error("โหลดไลบรารี Supabase ไม่สำเร็จ");
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === "PASSWORD_RECOVERY") recovering = true;
    });
  }

  /* ---------- หน้าเข้าสู่ระบบ / สมัคร / ตั้งรหัสผ่านใหม่ ---------- */
  function heroHtml() {
    var lg = (typeof LG === "function") ? LG() : "";
    return '<div class="hero">' + (lg ? '<img src="' + lg + '" alt="PMG">' : "") +
      '<div class="t1">ยินดีต้อนรับเข้าสู่</div><h1>บริษัท พีเอ็มจี โกลบอล จำกัด</h1>' +
      '<div class="t2">PMG Global Co., Ltd. · ระบบจัดการงานตามแผนก</div></div>';
  }
  function thErr(e) {
    var m = (e && e.message) || String(e);
    if (/Invalid login credentials/i.test(m)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    if (/Email not confirmed/i.test(m)) return "ยังไม่ได้ยืนยันอีเมล กรุณาตรวจสอบกล่องจดหมายของคุณ";
    if (/already registered|already been registered/i.test(m)) return "อีเมลนี้สมัครไว้แล้ว ให้เข้าสู่ระบบแทน";
    if (/Password should be at least/i.test(m)) return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
    if (/rate limit|too many/i.test(m)) return "ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
    if (/Failed to fetch|NetworkError/i.test(m)) return "เชื่อมต่ออินเทอร์เน็ตหรือ Supabase ไม่ได้";
    return m;
  }

  function showAuth(done) {
    var mode = "in", v = { n: "", e: "", p: "" }, busy = false;
    var a = document.getElementById("app");
    document.body.classList.add("lg");

    function draw(msg, isErr) {
      var title = mode === "in" ? "เข้าสู่ระบบ" : mode === "up" ? "สมัครใช้งาน" : "ลืมรหัสผ่าน";
      var btn = mode === "in" ? "เข้าสู่ระบบ" : mode === "up" ? "สมัครใช้งาน" : "ส่งลิงก์ตั้งรหัสผ่านใหม่";
      var f = '<div style="display:flex;flex-direction:column;gap:10px;max-width:380px;margin:0 auto">' +
        '<h2 style="font-size:16px;margin:0">' + title + "</h2>" +
        (mode === "up" ? '<div><label>ชื่อ-นามสกุล</label><input id="pa_n" autocomplete="name" value="' + esc(v.n) + '"></div>' : "") +
        '<div><label>อีเมล</label><input id="pa_e" type="email" autocomplete="email" value="' + esc(v.e) + '"></div>' +
        (mode !== "fg" ? '<div><label>รหัสผ่าน</label><input id="pa_p" type="password" autocomplete="' +
          (mode === "up" ? "new-password" : "current-password") + '" value="' + esc(v.p) + '"></div>' : "") +
        (msg ? '<div style="padding:9px 12px;border-radius:10px;font-size:13.5px;' +
          (isErr ? "background:rgba(179,57,47,.12);color:var(--neg)" : "background:var(--pri2);color:var(--pri)") +
          '">' + esc(msg) + "</div>" : "") +
        '<button class="add lgbtn" id="pa_go" style="margin-top:2px">' + btn + "</button>" +
        '<div class="leg" style="text-align:center;line-height:2">' +
        (mode !== "in" ? '<a href="#" data-m="in">← กลับไปเข้าสู่ระบบ</a>' : '<a href="#" data-m="up">สมัครใช้งานใหม่</a> · <a href="#" data-m="fg">ลืมรหัสผ่าน</a>') +
        '</div><div class="leg" style="text-align:center">ผู้ใช้ใหม่: หลังสมัครและเข้าสู่ระบบแล้ว ให้ส่งคำขอสิทธิ์ ผู้ดูแลระบบจะกำหนดแผนกให้</div></div>';
      a.innerHTML = '<div class="wlc">' + heroHtml() + '<div class="bd">' + f + "</div></div>";
      bind();
    }
    function grab() {
      var n = document.getElementById("pa_n"), e = document.getElementById("pa_e"), p = document.getElementById("pa_p");
      if (n) v.n = n.value; if (e) v.e = e.value.trim(); if (p) v.p = p.value;
    }
    function bind() {
      var go = document.getElementById("pa_go");
      go.onclick = submit;
      a.querySelectorAll("input").forEach(function (i) {
        i.onkeydown = function (ev) { if (ev.key === "Enter") submit(); };
      });
      a.querySelectorAll("a[data-m]").forEach(function (l) {
        l.onclick = function (ev) { ev.preventDefault(); grab(); mode = l.getAttribute("data-m"); draw(); };
      });
    }
    async function submit() {
      if (busy) return;
      grab();
      if (!v.e) return draw("กรุณากรอกอีเมล", true);
      if (mode !== "fg" && !v.p) return draw("กรุณากรอกรหัสผ่าน", true);
      if (mode === "up" && !v.n.trim()) return draw("กรุณากรอกชื่อ-นามสกุล", true);
      if (mode === "up" && v.p.length < 6) return draw("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", true);
      busy = true;
      var go = document.getElementById("pa_go"); if (go) { go.disabled = true; go.textContent = "กำลังดำเนินการ..."; }
      try {
        if (mode === "in") {
          var r = await sb.auth.signInWithPassword({ email: v.e, password: v.p });
          if (r.error) throw r.error;
          document.body.classList.remove("lg"); done(r.data.session); return;
        }
        if (mode === "up") {
          var s = await sb.auth.signUp({ email: v.e, password: v.p, options: { data: { name: v.n.trim() } } });
          if (s.error) throw s.error;
          if (s.data.session) { document.body.classList.remove("lg"); done(s.data.session); return; }
          mode = "in"; v.p = "";
          busy = false; return draw("สมัครสำเร็จ กรุณายืนยันอีเมลตามลิงก์ที่ส่งให้ แล้วกลับมาเข้าสู่ระบบ", false);
        }
        var f = await sb.auth.resetPasswordForEmail(v.e, { redirectTo: location.origin + location.pathname });
        if (f.error) throw f.error;
        mode = "in"; busy = false; return draw("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว", false);
      } catch (e) { busy = false; draw(thErr(e), true); return; }
      busy = false;
    }
    draw();
  }

  function showNewPassword(done) {
    var a = document.getElementById("app");
    document.body.classList.add("lg");
    function draw(msg) {
      a.innerHTML = '<div class="wlc">' + heroHtml() + '<div class="bd"><div style="display:flex;flex-direction:column;gap:10px;max-width:380px;margin:0 auto">' +
        '<h2 style="font-size:16px;margin:0">ตั้งรหัสผ่านใหม่</h2>' +
        '<div><label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label><input id="np1" type="password" autocomplete="new-password"></div>' +
        (msg ? '<div style="padding:9px 12px;border-radius:10px;background:rgba(179,57,47,.12);color:var(--neg);font-size:13.5px">' + esc(msg) + "</div>" : "") +
        '<button class="add lgbtn" id="npb">บันทึกรหัสผ่านใหม่</button></div></div></div>';
      var go = async function () {
        var p = document.getElementById("np1").value;
        if (p.length < 6) return draw("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
        var r = await sb.auth.updateUser({ password: p });
        if (r.error) return draw(thErr(r.error));
        recovering = false;
        try { history.replaceState(null, "", location.pathname); } catch (e) {}
        document.body.classList.remove("lg"); done();
      };
      document.getElementById("npb").onclick = go;
      document.getElementById("np1").onkeydown = function (ev) { if (ev.key === "Enter") go(); };
    }
    draw();
  }

  async function ensureSession() {
    var r = await sb.auth.getSession();
    session = r.data.session;
    if (session && recovering) await new Promise(function (res) { showNewPassword(res); });
    if (!session) session = await new Promise(function (res) { showAuth(res); });
    myId = session.user.id;
  }

  /* ---------- ชั้นข้อมูล (cache + realtime + เขียนแบบ optimistic) ---------- */
  function C(n) {
    return cols[n] || (cols[n] = { name: n, map: new Map(), subs: [], loaded: false, loading: null, timer: 0 });
  }
  function emit(c) {
    if (c.timer) return;
    c.timer = setTimeout(function () {
      c.timer = 0;
      c.subs.slice().forEach(function (s) { try { s.fn(); } catch (e) { console.error(e); } });
    }, 0);
  }
  function loadCol(name) {
    var c = C(name);
    if (c.loading) return c.loading;
    c.loading = (async function () {
      var rows = [], from = 0, page = 500;
      for (;;) {
        var r = await sb.from("docs").select("id,data").eq("collection", name)
          .order("created_at", { ascending: true }).order("id", { ascending: true })
          .range(from, from + page - 1);
        if (r.error) throw r.error;
        rows = rows.concat(r.data);
        if (r.data.length < page) break;
        from += page;
      }
      var m = new Map();
      rows.forEach(function (x) { m.set(x.id, x.data); });
      c.map = m; c.loaded = true; emit(c);
    })().catch(function (e) { c.loading = null; throw e; });
    return c.loading;
  }
  function refetchAll() {
    Object.keys(cols).forEach(function (n) {
      var c = cols[n]; c.loading = null; c.loaded = false;
      loadCol(n).catch(function (e) { console.error("โหลด " + n + " ไม่สำเร็จ", e); });
    });
  }
  async function fetchRow(col, id) {
    var r = await sb.from("docs").select("data").eq("collection", col).eq("id", id).maybeSingle();
    if (r.error || !r.data) return;
    var c = cols[col]; if (!c || !c.loaded) return;
    c.map.set(id, r.data.data); emit(c);
  }
  function onChange(p) {
    var t = p.eventType, row = (t === "DELETE" ? p.old : p.new) || {};
    var col = row.collection, id = row.id;
    if (!col || id == null) return;
    if (col === "config" && id === "roles" && t !== "DELETE" && !hadAccess) {
      var mp = row.data && row.data.map;
      if (mp && mp[myId]) { hadAccess = true; refetchAll(); return; }
    }
    var c = cols[col];
    if (!c || !c.loaded) return;
    if (t === "DELETE") { if (c.map.delete(id)) emit(c); return; }
    if (row.data == null) { fetchRow(col, id); return; }
    var old = c.map.get(id);
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(row.data)) return;
    c.map.set(id, row.data); emit(c);
  }
  function subscribe() {
    return new Promise(function (res) {
      var first = true;
      chan = sb.channel("pmg-docs").on("postgres_changes",
        { event: "*", schema: "public", table: "docs" }, onChange)
        .subscribe(function (st) {
          if (st === "SUBSCRIBED") {
            if (everSub) refetchAll();
            everSub = true;
          }
          if (first && (st === "SUBSCRIBED" || st === "CHANNEL_ERROR" || st === "TIMED_OUT")) { first = false; res(st); }
        });
    });
  }

  async function write(col, id, data) {
    var d = clean(data), c = C(col), prev = c.map.get(id);
    c.map.set(id, d); emit(c);
    var r = await sb.from("docs").upsert({ collection: col, id: id, data: d }, { onConflict: "collection,id" });
    if (r.error) {
      if (prev === undefined) c.map.delete(id); else c.map.set(id, prev);
      emit(c);
      throw r.error;
    }
  }
  async function remove(col, id) {
    var c = C(col), prev = c.map.get(id);
    c.map.delete(id); emit(c);
    var r = await sb.from("docs").delete().eq("collection", col).eq("id", id);
    if (r.error) { if (prev !== undefined) c.map.set(id, prev); emit(c); throw r.error; }
  }

  function colSnap(c) {
    var docs = [];
    c.map.forEach(function (d, id) { docs.push({ id: id, exists: true, data: function () { return d; } }); });
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
  }
  function watch(name, render, onErr) {
    var c = C(name), sub = { fn: function () { if (c.loaded) render(c); } };
    c.subs.push(sub);
    if (c.loaded) emit(c); else loadCol(name).catch(function (e) { console.error("โหลด " + name + " ไม่สำเร็จ", e); if (onErr) onErr(e); });
    return function () { var i = c.subs.indexOf(sub); if (i >= 0) c.subs.splice(i, 1); };
  }

  var DB = {
    collection: function (name) {
      return {
        add: function (data) { var id = uuid(); return write(name, id, data).then(function () { return { id: id }; }); },
        onSnapshot: function (cb, onErr) { return watch(name, function (c) { cb(colSnap(c)); }, onErr); }
      };
    },
    doc: function (path) {
      var i = path.indexOf("/"), col = path.slice(0, i), id = path.slice(i + 1);
      return {
        id: id,
        set: function (data) { return write(col, id, data); },
        delete: function () { return remove(col, id); },
        get: async function () {
          await loadCol(col);
          var d = C(col).map.get(id);
          return { id: id, exists: d !== undefined, data: function () { return d; } };
        },
        onSnapshot: function (cb, onErr) {
          return watch(col, function (c) {
            var d = c.map.get(id);
            cb({ id: id, exists: d !== undefined, data: function () { return d; } });
          }, onErr);
        }
      };
    }
  };

  /* ---------- user ---------- */
  var USER = {
    id: async function () { return myId; },
    isOwner: async function () { return !!(profile && profile.is_owner); },
    me: async function () {
      var u = session && session.user || {};
      return {
        email: (profile && profile.email) || u.email || "",
        name: (profile && profile.name) || (u.user_metadata && u.user_metadata.name) || ""
      };
    },
    profiles: async function (ids) {
      var out = {}; ids = (ids || []).filter(Boolean);
      for (var i = 0; i < ids.length; i += 100) {
        var r = await sb.from("profiles").select("id,name,email").in("id", ids.slice(i, i + 100));
        if (r.error) throw r.error;
        r.data.forEach(function (p) { out[p.id] = { name: p.name || "", email: p.email || "" }; });
      }
      return out;
    },
    search: async function (q) {
      q = String(q || "").trim().replace(/[%,()*\\]/g, " ").trim();
      var qq = sb.from("profiles").select("id,name,email").order("email").limit(30);
      if (q) qq = qq.or("email.ilike.%" + q + "%,name.ilike.%" + q + "%");
      var r = await qq;
      if (r.error) throw r.error;
      return r.data.map(function (p) { return { id: p.id, name: p.name || "", email: p.email || "" }; });
    }
  };

  var started = null;
  function start() {
    if (started) return started;
    started = (async function () {
      var r = await sb.from("profiles").select("id,email,name,is_owner").eq("id", myId).maybeSingle();
      profile = r.data || null;
      var rl = await sb.from("docs").select("data").eq("collection", "config").eq("id", "roles").maybeSingle();
      var mp = rl.data && rl.data.data && rl.data.data.map;
      hadAccess = !!((profile && profile.is_owner) || (mp && mp[myId]));
      await subscribe();
    })();
    return started;
  }

  /* ---------- จุดเชื่อมกับระบบเดิม ---------- */
  window.claude = {
    use: async function (name) {
      init();
      if (name === "db") return DB;
      if (name === "user") { await ensureSession(); await start(); return USER; }
      throw new Error("unknown service: " + name);
    }
  };
  window.PMG_signOut = function () {
    try { return sb ? sb.auth.signOut() : Promise.resolve(); } catch (e) { return Promise.resolve(); }
  };
})();
