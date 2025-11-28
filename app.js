/* ======================================================
   app.js - Smart Irrigation Dashboard (Firebase bridge)
   Works with:
     - index.html (dashboard)
     - logs.html  (logs viewer)
     - visual.html (ThingSpeak embeds — no JS needed)
   Expects Firebase DB structure:
     /data        (sensor1, sensor2, pump1, pump2, analytics...)
     /mode/auto   (true/false)
     /override    (pump1, pump2)  -> "ON"/"OFF"
     /threshold   (sensor1, sensor2)
     /logs        (timestamp -> { event, value })
   ====================================================== */

/* -------------------------------------------------------
   FIREBASE CONFIG (already provided by you earlier)
------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyATGKgMSYMWfU0afbY__osMqCaG-8EKv4Y",
  authDomain: "smart-irrigation-3826a.firebaseapp.com",
  databaseURL:
    "https://smart-irrigation-3826a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-irrigation-3826a",
  storageBucket: "smart-irrigation-3826a.firebasestorage.app",
  messagingSenderId: "299755599351",
  appId: "1:299755599351:web:20e0beac1738752128eaf2",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// References
const dataRef = db.ref("/data");
const modeRef = db.ref("/mode/auto");
const overrideRef = db.ref("/override");
const thresholdRef = db.ref("/threshold");
const logsRef = db.ref("/logs");

// small util to write logs with timestamp key (ISO millis string)
function writeLog(event, value) {
  try {
    const ts = Date.now().toString();
    logsRef.child(ts).set({ event, value });
  } catch (e) {
    console.warn("Log write failed:", e);
  }
}

/* ======================================================
   DASHBOARD (index.html)
   - reads /data for sensor/pump states
   - reads /mode/auto
   - allows toggle auto/manual
   - allows override pump1/pump2
   - updates UI gauges and pump status
   ====================================================== */
(function dashboardModule() {
  // check if dashboard elements exist
  const btnAuto = document.getElementById("btnAuto");
  const btnManual = document.getElementById("btnManual");
  const currentModeEl = document.getElementById("currentMode");
  const pump1StatusEl = document.getElementById("pump1Status") || document.getElementById("pumpAStatus");
  const pump2StatusEl = document.getElementById("pump2Status") || document.getElementById("pumpBStatus");
  const sensor1Gauge = document.getElementById("sensor1Gauge") || document.getElementById("gA") || document.getElementById("sensor1");
  const sensor2Gauge = document.getElementById("sensor2Gauge") || document.getElementById("gB") || document.getElementById("sensor2");

  // if common elements missing, this page probably isn't dashboard -> skip
  if (!currentModeEl || !(sensor1Gauge || sensor2Gauge)) return;

  // UI helpers
  function setGauge(el, pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    if (!el) return;
    el.style.width = p + "%";
    el.innerText = p + "%";
  }

  function setPumpStatus(el, val) {
    if (!el) return;
    el.innerText = val || "OFF";
  }

  // toggle mode (true = auto, false = manual)
  function setMode(auto) {
    modeRef.set(!!auto)
      .then(() => writeLog("mode_change", auto ? "AUTO" : "MANUAL"))
      .catch(err => console.warn("setMode error", err));
  }

  // override pump (pumpKey: 'pump1' or 'pump2', val: 'ON'|'OFF')
  function setOverride(pumpKey, val) {
    overrideRef.child(pumpKey).set(val)
      .then(() => writeLog("override", `${pumpKey}=${val}`))
      .catch(err => console.warn("setOverride error", err));
  }

  // wire buttons (if present)
  if (btnAuto) btnAuto.addEventListener("click", () => setMode(true));
  if (btnManual) btnManual.addEventListener("click", () => setMode(false));

  // pump buttons: in index.html we use elements with class 'pump-btn' and data attributes
  document.querySelectorAll(".pump-btn, button[data-pump]").forEach(btn => {
    btn.addEventListener("click", () => {
      const pump = btn.getAttribute("data-pump"); // expects 'pump1' or 'pump2'
      const val = btn.getAttribute("data-val");   // 'ON' or 'OFF' (case-insensitive allowed)
      if (!pump) return;
      const v = String(val || btn.dataset.val || btn.textContent || "").toUpperCase();
      setOverride(pump, v === "ON" ? "ON" : "OFF");
    });
  });

  // Listen for mode changes (boolean true/false)
  modeRef.on("value", snap => {
    const val = snap.val();
    // we expect boolean; if it's a string keep backwards-compat
    const isAuto = (val === true) || (String(val).toLowerCase() === "true") || (String(val).toLowerCase() === "auto");
    currentModeEl.innerText = isAuto ? "AUTO" : "MANUAL";
    // visual state on buttons
    if (btnAuto && btnManual) {
      if (isAuto) {
        btnAuto.classList.add("on");
        btnManual.classList.remove("on");
      } else {
        btnManual.classList.add("on");
        btnAuto.classList.remove("on");
      }
    }
  });

  // Track last pump states locally to avoid log spam
  let lastPump1 = null, lastPump2 = null;

  // Listen for data updates (sensor + pump states + analytics)
  dataRef.on("value", snap => {
    const d = snap.val() || {};

    // Sensors
    if (d.sensor1 !== undefined) setGauge(sensor1Gauge, d.sensor1);
    if (d.sensor2 !== undefined) setGauge(sensor2Gauge, d.sensor2);

    // Pump statuses (strings "ON"/"OFF" or booleans)
    const p1 = d.pump1 !== undefined ? d.pump1 : null;
    const p2 = d.pump2 !== undefined ? d.pump2 : null;

    if (p1 !== null) {
      setPumpStatus(pump1StatusEl, (typeof p1 === "boolean") ? (p1 ? "ON" : "OFF") : p1);
      if (lastPump1 === null) lastPump1 = p1;
      else if (String(lastPump1) !== String(p1)) {
        writeLog("pump_state", `pump1=${p1}`);
        lastPump1 = p1;
      }
    }

    if (p2 !== null) {
      setPumpStatus(pump2StatusEl, (typeof p2 === "boolean") ? (p2 ? "ON" : "OFF") : p2);
      if (lastPump2 === null) lastPump2 = p2;
      else if (String(lastPump2) !== String(p2)) {
        writeLog("pump_state", `pump2=${p2}`);
        lastPump2 = p2;
      }
    }

    // Optionally you can display analytics fields if present in /data
    // (zoneA_avg, zoneB_avg, dr_a_mm, irrig_a_mm, etc.)
    // We don't log these continuously to avoid spamming logs.
  });

  // Listen for overrides (so UI reflects current override values)
  overrideRef.on("value", snap => {
    const o = snap.val() || {};
    // override keys are pump1/pump2
    if (o.pump1 !== undefined) setPumpStatus(pump1StatusEl, o.pump1);
    if (o.pump2 !== undefined) setPumpStatus(pump2StatusEl, o.pump2);
  });

  // Optional: thresholds watcher (if you have sliders elsewhere)
  thresholdRef.on("value", snap => {
    const t = snap.val() || {};
    // If you have elements with ids t1Val/t2Val update them
    if (t.sensor1 !== undefined) {
      const el = document.getElementById("t1Val");
      if (el) el.innerText = t.sensor1 + "%";
    }
    if (t.sensor2 !== undefined) {
      const el = document.getElementById("t2Val");
      if (el) el.innerText = t.sensor2 + "%";
    }
  });

  // Log that dashboard initialized
  writeLog("dashboard", "loaded");
})();

/* ======================================================
   LOGS PAGE SUPPORT (logs.html)
   - If the dedicated logs page exists, this will populate
     it using the /logs node. (We provided a standalone
     logs.html earlier; this is optional redundancy.)
   ====================================================== */
(function logsModule() {
  const logTableBody = document.querySelector("#logTable tbody");
  const logStatus = document.getElementById("logStatus");
  if (!logTableBody) return;

  // update status text
  if (logStatus) logStatus.innerText = "Loading logs...";

  // Read logs once and also subscribe
  logsRef.orderByKey().limitToLast(1000).on("value", snap => {
    const val = snap.val() || {};
    // transform to array and sort descending by key (timestamp)
    const rows = Object.keys(val).map(k => ({ ts: k, ...val[k] }));
    rows.sort((a,b) => (b.ts > a.ts ? 1 : -1));

    // clear table
    logTableBody.innerHTML = "";
    for (const r of rows) {
      const tr = document.createElement("tr");
      const tdTime = document.createElement("td");
      const tdEvent = document.createElement("td");
      const tdValue = document.createElement("td");

      let timeText = r.ts;
      // if key is numeric timestamp, format it
      if (!isNaN(Number(r.ts))) {
        timeText = new Date(Number(r.ts)).toLocaleString();
      }
      tdTime.innerText = timeText;
      tdEvent.innerText = r.event || "";
      tdValue.innerText = typeof r.value === "object" ? JSON.stringify(r.value) : (r.value || "");

      tr.appendChild(tdTime);
      tr.appendChild(tdEvent);
      tr.appendChild(tdValue);
      logTableBody.appendChild(tr);
    }

    if (logStatus) logStatus.innerText = rows.length ? `Showing ${rows.length} logs` : "No logs available";
  });
})();

/* ======================================================
   OPTIONAL: Add a small utility for CSV download if a
   button with id="downloadCSV" exists on the page.
   (logs.html already contains such a button)
   ====================================================== */
(function csvDownloadModule() {
  const btn = document.getElementById("downloadCSV");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      const snap = await logsRef.orderByKey().limitToLast(2000).once("value");
      const val = snap.val() || {};
      const rows = Object.keys(val).map(k => ({ ts: k, ...val[k] }));
      rows.sort((a,b) => (b.ts > a.ts ? 1 : -1));

      const header = ["timestamp","event","value"];
      const lines = [header.join(",")];

      for (const r of rows) {
        const ts = isNaN(Number(r.ts)) ? `"${r.ts}"` : `"${new Date(Number(r.ts)).toLocaleString()}"`;
        const event = `"${String(r.event || "").replace(/"/g,'""')}"`;
        const value = `"${(typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value || "")).replace(/"/g,'""')}"`;
        lines.push([ts,event,value].join(","));
      }

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "irrigation_logs.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to export logs: " + e.message);
    }
  });
})();
