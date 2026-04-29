// ============================================================
// CFD UI CONTROLLER — Event Handlers + Main Loop
// ============================================================

function cfdGetParams() {
  return {
    impeller: document.getElementById('cfd_impeller').value,
    T: parseFloat(document.getElementById('cfd_T').value),
    H: parseFloat(document.getElementById('cfd_H').value),
    D: parseFloat(document.getElementById('cfd_D').value),
    impH: parseFloat(document.getElementById('cfd_impH').value),
    rpm: parseFloat(document.getElementById('cfd_rpm').value),
    visc: parseFloat(document.getElementById('cfd_visc').value),
    rho: parseFloat(document.getElementById('cfd_rho').value),
    baffle: document.getElementById('cfd_baffle').checked,
    nonNewt: document.getElementById('cfd_nonNewt').checked,
    nn_K: parseFloat(document.getElementById('cfd_nnK').value) || 10,
    nn_n: parseFloat(document.getElementById('cfd_nnN').value) || 0.5,
  };
}

function cfdUpdateMetricsUI(p, stepInfo, metrics) {
  const { Re, D_eff, vtip } = stepInfo;
  const { cov, homo, deadPct, t95_grenville } = metrics;

  document.getElementById('cfd_re').innerText = Math.round(Re).toLocaleString('tr-TR');
  const reEl = document.getElementById('cfd_reStatus');
  if (Re < 10) { reEl.innerText = 'Lamineer'; reEl.style.color = '#60a5fa'; }
  else if (Re < 10000) { reEl.innerText = 'Geçiş'; reEl.style.color = '#fbbf24'; }
  else { reEl.innerText = 'Türbülanslı'; reEl.style.color = '#4ade80'; }

  document.getElementById('cfd_deff').innerText = D_eff.toExponential(2) + ' m²/s';
  document.getElementById('cfd_vtip').innerText = vtip.toFixed(2) + ' m/s';

  const Nq = _getNq(p.impeller);
  const N = p.rpm / 60;
  const Q = Nq * N * Math.pow(p.D, 3) * 1000;
  const Vl = Math.PI / 4 * p.T * p.T * p.H * 1000;
  document.getElementById('cfd_Q').innerText = Q.toFixed(2) + ' L/s';
  document.getElementById('cfd_circ').innerText = Q > 0.001 ? (Vl / Q).toFixed(0) + ' s/tur' : '∞';

  document.getElementById('cfd_cov').innerText = cov.toFixed(3);
  document.getElementById('cfd_cov').style.color = cov < 0.05 ? '#4ade80' : cov < 0.2 ? '#fbbf24' : '#f87171';
  document.getElementById('cfd_homo').innerText = homo.toFixed(0) + '%';
  document.getElementById('cfd_dead').innerText = deadPct.toFixed(1) + '%';
  document.getElementById('cfd_dead').style.color = deadPct < 5 ? '#4ade80' : deadPct < 20 ? '#fbbf24' : '#f87171';
  document.getElementById('cfd_simtime').innerText = CFD.time.toFixed(1) + ' s';
  document.getElementById('cfd_timeDisplay').innerText = CFD.time.toFixed(1);
  document.getElementById('cfd_stepLabel').innerText = 'adım: ' + CFD.step;

  // Homogeneity bar
  document.getElementById('cfd_homoBar').style.width = homo.toFixed(0) + '%';
  document.getElementById('cfd_homoBar_val').innerText = homo.toFixed(0) + '%';

  // Dead zone + t95 panel
  const deadEl = document.getElementById('cfd_deadZoneInfo');
  const Np = _getNp(p.impeller);
  const power = Np * p.rho * Math.pow(N, 3) * Math.pow(p.D, 5);
  const PV = power / (Math.PI / 4 * p.T * p.T * p.H);

  // ── 45 dk Kural Kontrolü ─────────────────────────────────────
  const KURAL_DK = 45;
  let yeterlilik_html = '';
  if (t95_grenville !== null) {
    const t95_dk = t95_grenville / 60;
    let renk, ikon, mesaj;
    if (t95_dk <= KURAL_DK * 0.60) {
      renk = '#22d3ee'; ikon = '⚡';
      mesaj = `Bu setup fazla güçlü — ${t95_dk.toFixed(0)} dk'da homojen olur. Daha küçük tank veya düşük RPM düşünün.`;
    } else if (t95_dk <= KURAL_DK * 0.90) {
      renk = '#4ade80'; ikon = '✅';
      mesaj = `45 dk yeterli, ${Math.round(KURAL_DK - t95_dk)} dk güvenlik payı var.`;
    } else if (t95_dk <= KURAL_DK * 1.10) {
      renk = '#4ade80'; ikon = '✅';
      mesaj = `45 dk ile homojen olur (t₉₅ ≈ ${t95_dk.toFixed(0)} dk).`;
    } else if (t95_dk <= KURAL_DK * 1.35) {
      renk = '#fbbf24'; ikon = '⚠';
      mesaj = `Sınırda — 45 dk yetmeyebilir. Numune alt/orta/üstten alın.`;
    } else {
      renk = '#f87171'; ikon = '❌';
      mesaj = `45 dk YETMİYOR (t₉₅ = ${t95_dk.toFixed(0)} dk). Bu boya bu setup'ta homojen olmaz.`;
    }
    const barPct = Math.min(100, (KURAL_DK / t95_dk) * 100).toFixed(0);
    yeterlilik_html = `
    <div class="p-3 rounded-xl mb-2" style="background:rgba(0,0,0,0.35);border:1px solid ${renk}35">
      <div class="flex justify-between items-center mb-1.5">
        <span class="text-[9px] font-black uppercase tracking-wider" style="color:${renk}">Homojenlik Kontrolü ${ikon}</span>
        <span class="mono font-black text-xl" style="color:${renk}">${t95_dk.toFixed(0)} dk</span>
      </div>
      <p class="text-[9px] leading-relaxed mb-2" style="color:#94a3b8">${mesaj}</p>
      <div class="h-1.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.08)">
        <div style="width:${barPct}%;height:100%;background:${renk};border-radius:99px;transition:width 0.5s"></div>
      </div>
      <div class="flex justify-between text-[8px] mt-0.5 mono" style="color:#94a3b8">
        <span>0 dk</span><span style="color:${renk}60">45 dk kural</span><span>t₉₅</span>
      </div>
    </div>
    <p class="text-[8px] italic mb-2" style="color:#94a3b8">Nienow (1997) Turnover Modeli · Re_eff bazlı · viskoz boya için kalibre</p>
    <div class="p-2 rounded-lg mb-2" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)">
      <p class="text-[8px] font-black mb-1" style="color:#fbbf24">ℹ t₉₅ Fizik Formülü vs Simülasyon CoV</p>
      <p class="text-[8px] leading-relaxed" style="color:#94a3b8"><span style="color:#4ade80">t₉₅ (dk)</span> → Nienow turnover modeli. Viskozite, RPM, D, tank geometrisinden hesaplanır. Gerçek karışma süresini tahmin eder.</p>
      <p class="text-[8px] leading-relaxed mt-1" style="color:#94a3b8"><span style="color:#22d3ee">CoV / Homojenlik (%)</span> → Tracer enjekte edildikten sonra simülasyonda izlenir. Konsantrasyonun ne kadar eşitlendiğini gösterir. Simülasyon zamanı (s) gerçek dakikayla birebir örtüşmez.</p>
    </div>`;
  }

  deadEl.innerHTML = `
    ${yeterlilik_html}
    <div class="grid grid-cols-2 gap-1.5">
      <div class="rounded-lg p-2" style="background:rgba(0,0,0,0.3)">
        <div class="text-[8px] mono" style="color:#94a3b8">Ölü Bölge</div>
        <div class="font-bold mono text-sm" style="color:${deadPct < 10 ? '#4ade80' : deadPct < 25 ? '#fbbf24' : '#f87171'}">${deadPct.toFixed(1)}%</div>
      </div>
      <div class="rounded-lg p-2" style="background:rgba(0,0,0,0.3)">
        <div class="text-[8px] mono" style="color:#94a3b8">Re_eff</div>
        <div class="font-bold mono text-sm" style="color:${Re<100?'#60a5fa':Re<1000?'#fbbf24':'#4ade80'}">${Math.round(Re).toLocaleString('tr-TR')}</div>
      </div>
      <div class="rounded-lg p-2" style="background:rgba(0,0,0,0.3)">
        <div class="text-[8px] mono" style="color:#94a3b8">Motor</div>
        <div class="font-bold mono text-sm text-orange-400">${power < 1000 ? power.toFixed(0)+' W' : (power/1000).toFixed(2)+' kW'}</div>
      </div>
      <div class="rounded-lg p-2" style="background:rgba(0,0,0,0.3)">
        <div class="text-[8px] mono" style="color:#94a3b8">P/V</div>
        <div class="font-bold mono text-sm text-slate-200">${PV.toFixed(0)} W/m³</div>
      </div>
    </div>
    <p class="text-[9px] leading-relaxed mt-2" style="color:${deadPct < 10 ? '#4ade80' : deadPct < 25 ? '#94a3b8' : '#f87171'}">
      ${deadPct < 10 ? '✅ Ölü bölge minimal' :
        deadPct < 20 ? '⚠ Düşük hızlı bölgeler — numune çoklu noktadan alın' :
        deadPct < 35 ? '⚠ Belirgin ölü bölgeler — baffle ekleyin veya RPM artırın' :
        '❌ Geniş ölü bölgeler — geometri bu boya için uygunsuz'}
    </p>`;
}

// ─── Main Loop ───────────────────────────────────────────────
let cfdLastStepInfo = { Re: 0, D_eff: 0, vtip: 0 };

function cfdLoop() {
  if (!CFD.running) return;
  const p = cfdGetParams();

  // Sub-stepping for stability
  for (let s = 0; s < CFD.substeps; s++) {
    const si = cfdSolveStep(p);
    cfdLastStepInfo = si;
    CFD.time += si.dt;
    CFD.step++;
  }

  // Record CoV history every 5 frames
  if (CFD.step % 5 === 0) {
    const metrics = cfdComputeMetrics(p);
    if (metrics.mean > 0.001) {
      CFD.covHistory.push({ t: CFD.time, cov: metrics.cov });
      // Probe sampling
      const probeVals = cfdSampleProbes(p);
      probeVals.forEach((v, i) => {
        CFD.probeData[i].push({ t: CFD.time, v });
      });
      // Check t95
      if (CFD.t95 === null && metrics.cov < 0.05) {
        CFD.t95 = CFD.time;
      }
    }
  }

  // Draw every 2 animation frames
  if (CFD.step % (CFD.substeps * 2) === 0) {
    const sideCanvas = document.getElementById('cfd_canvas');
    const topCanvas = document.getElementById('cfd_topCanvas');
    const covCanvas = document.getElementById('cfd_covGraph');
    const velCanvas = document.getElementById('cfd_velProfile');

    cfdDrawSideView(sideCanvas, p);
    cfdDrawTopView(topCanvas, p);
    cfdDrawCovGraph(covCanvas);
    cfdDrawVelProfile(velCanvas, p);

    const metrics = cfdComputeMetrics(p);
    cfdUpdateMetricsUI(p, cfdLastStepInfo, metrics);
  }

  CFD.animId = requestAnimationFrame(cfdLoop);
}

function cfdStartSim() {
  const p = cfdGetParams();
  cfdBuildStreamFunction(p);

  if (CFD.step === 0) {
    CFD.C.fill(0);
    CFD.C2.fill(0);
  }

  CFD.running = true;
  document.getElementById('cfd_statusDot').style.background = '#22c55e';
  document.getElementById('cfd_statusDot').classList.add('animate-pulse');
  document.getElementById('cfd_startBtn').innerHTML = '<i class="fas fa-stop"></i> DURDUR';
  document.getElementById('cfd_startBtn').style.background = '#7f1d1d';

  cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  cfdLoop();
}

function cfdStopSim() {
  CFD.running = false;
  if (CFD.animId) cancelAnimationFrame(CFD.animId);
  document.getElementById('cfd_statusDot').style.background = '#64748b';
  document.getElementById('cfd_statusDot').classList.remove('animate-pulse');
  document.getElementById('cfd_startBtn').innerHTML = '<i class="fas fa-play"></i> BAŞLAT';
  document.getElementById('cfd_startBtn').style.background = '#0e7490';
}

function cfdResetSim() {
  cfdStopSim();
  cfdReset();
  // Tank seçiciyi ve bilgiyi temizle
  const secEl = document.getElementById('cfd_tankSec');
  if (secEl) secEl.value = '';
  const bilgiEl = document.getElementById('cfd_tankSecBilgi');
  if (bilgiEl) bilgiEl.classList.add('hidden');
  // Default değerlere dön
  cfdSetInputs(CFD_DEFAULTS);
  const p = cfdGetParams();
  cfdBuildStreamFunction(p);
  cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  cfdDrawTopView(document.getElementById('cfd_topCanvas'), p);
  cfdDrawCovGraph(document.getElementById('cfd_covGraph'));
  cfdDrawVelProfile(document.getElementById('cfd_velProfile'), p);
  ['cfd_cov', 'cfd_homo', 'cfd_dead', 'cfd_simtime'].forEach(id => {
    document.getElementById(id).innerText = '--';
  });
  document.getElementById('cfd_homoBar').style.width = '0%';
  document.getElementById('cfd_homoBar_val').innerText = '0%';
}

function cfdRebuildOnChange() {
  const p = cfdGetParams();
  cfdBuildStreamFunction(p);
  if (!CFD.running) {
    cfdDrawSideView(document.getElementById('cfd_canvas'), p);
    cfdDrawTopView(document.getElementById('cfd_topCanvas'), p);
    cfdDrawVelProfile(document.getElementById('cfd_velProfile'), p);
    const N = p.rpm / 60;
    const Re = p.rho * N * p.D * p.D / p.visc;
    const vtip = Math.PI * p.D * N;
    cfdUpdateMetricsUI(p, { Re, D_eff: 0, vtip }, { cov: 1, homo: 0, deadPct: 50 });
  }
}

// ─── Event Binding ──────────────────────────────────────────
function cfdBindEvents() {
  document.getElementById('cfd_startBtn').onclick = () => {
    if (CFD.running) cfdStopSim(); else cfdStartSim();
  };
  document.getElementById('cfd_resetBtn').onclick = cfdResetSim;

  document.getElementById('cfd_injectBtn').onclick = () => {
    const mode = document.getElementById('cfd_tracerPos').value;
    cfdInjectTracer(mode);
    const p = cfdGetParams();
    if (!CFD.running) cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  };

  document.getElementById('cfd_rpm').oninput = function () {
    document.getElementById('cfd_rpmLabel').innerText = this.value + ' RPM';
    cfdRebuildOnChange();
  };

  ['cfd_impeller', 'cfd_T', 'cfd_H', 'cfd_D', 'cfd_impH', 'cfd_visc', 'cfd_rho', 'cfd_baffle', 'cfd_nonNewt', 'cfd_nnK', 'cfd_nnN'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', cfdRebuildOnChange);
  });

  // Non-Newtonian toggle
  document.getElementById('cfd_nonNewt').addEventListener('change', function () {
    document.getElementById('cfd_nnParams').style.display = this.checked ? '' : 'none';
  });

  // View mode buttons
  document.querySelectorAll('.cfd-view-btn').forEach(btn => {
    btn.onclick = function () {
      document.querySelectorAll('.cfd-view-btn').forEach(b => b.classList.remove('active-view'));
      this.classList.add('active-view');
      CFD.viewMode = this.dataset.view;
      const labels = {
        concentration: 'Konsantrasyon (normalize)',
        velocity: 'Hız büyüklüğü (normalize)',
        deadzone: 'Ölü bölge (kırmızı = düşük hız)',
        viscosity: 'Kesme hızı / Viskozite'
      };
      document.getElementById('cfd_scaleLabel').innerText = labels[CFD.viewMode] || '';
      const p = cfdGetParams();
      if (!CFD.running) cfdDrawSideView(document.getElementById('cfd_canvas'), p);
    };
  });

  // Color map selector
  document.getElementById('cfd_colorMapSel').addEventListener('change', function () {
    CFD.colorMap = this.value;
    const p = cfdGetParams();
    if (!CFD.running) cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  });

  // Streamline toggle
  document.getElementById('cfd_streamlines').addEventListener('change', function () {
    CFD.showStreamlines = this.checked;
    const p = cfdGetParams();
    if (!CFD.running) cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  });

  // Substeps slider
  document.getElementById('cfd_substeps').addEventListener('input', function () {
    CFD.substeps = parseInt(this.value);
    document.getElementById('cfd_substepsLabel').innerText = this.value + 'x';
  });

  // Tab switching — CFD tab
  document.getElementById('tabCFD').onclick = () => {
    document.getElementById('pageMixing').style.display = 'none';
    document.getElementById('pageDispersion').style.display = 'none';
    document.getElementById('pageUygunluk').style.display = 'none';
    document.getElementById('pageCFD').style.display = '';
    document.querySelectorAll('.page-tab').forEach(t => t.classList.remove('active-page-tab'));
    document.getElementById('tabCFD').classList.add('active-page-tab');
    const p = cfdGetParams();
    cfdBuildStreamFunction(p);
    cfdDrawSideView(document.getElementById('cfd_canvas'), p);
    cfdDrawTopView(document.getElementById('cfd_topCanvas'), p);
    cfdDrawVelProfile(document.getElementById('cfd_velProfile'), p);
    cfdRebuildOnChange();
  };

  // Stop CFD when switching away
  ['tabMixing', 'tabDispersion', 'tabUygunluk'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => { if (CFD.running) cfdStopSim(); });
  });

  // ── Tank Seçici ──────────────────────────────────────────────
  cfdBuildTankSelector();
  document.getElementById('cfd_tankSec').addEventListener('change', function () {
    cfdApplyTankSelection(this.value);
  });
}

// ─── Tank Seçici: TANK_DB'den combobox doldur ────────────────
const CFD_IMP_MAP = {
  'marine_propeller': 'propeller',
  'lenart_dishli':    'paddle',    // Lenart dişli → radyal akışa benzer davranış
  'lenart_dishsiz':   'pbtd',      // Lenart dişsiz → pitched blade benzeri
  'cowles':           'cowles',
  'hydrofoil':        'hydrofoil',
  'paddle':           'paddle',
};

// Default değerler (Custom / sıfırla)
const CFD_DEFAULTS = {
  impeller: 'propeller', T: 1.3, H: 2.0, D: 0.3,
  impH: 0.4, rpm: 100, visc: 0.5, rho: 1200, baffle: false
};

function cfdBuildTankSelector() {
  const sel = document.getElementById('cfd_tankSec');
  if (!sel || typeof TANK_DB === 'undefined') return;

  // Tesise göre grupla
  const gruplar = {};
  TANK_DB.forEach(t => {
    const tesis = t.tesis || t.yer || 'Diğer';
    if (!gruplar[tesis]) gruplar[tesis] = [];
    gruplar[tesis].push(t);
  });

  // Optgroup olarak ekle
  Object.keys(gruplar).sort().forEach(tesis => {
    const grp = document.createElement('optgroup');
    grp.label = tesis;
    gruplar[tesis].forEach(t => {
      if (!t.kullanilabilir_lt || !t.d_imp || !t.rpm_max) return;
      const opt = document.createElement('option');
      opt.value = t.kod;
      opt.textContent = `${t.kod} · ${(t.kullanilabilir_lt/1000).toFixed(1)}m³ · ${t.rpm_max} RPM`;
      grp.appendChild(opt);
    });
    if (grp.children.length > 0) sel.appendChild(grp);
  });
}

function cfdApplyTankSelection(kod) {
  const bilgiEl = document.getElementById('cfd_tankSecBilgi');

  if (!kod) {
    // Custom — default değerlere dön
    cfdSetInputs(CFD_DEFAULTS);
    bilgiEl.classList.add('hidden');
    cfdRebuildOnChange();
    return;
  }

  const tank = TANK_DB.find(t => t.kod === kod);
  if (!tank) return;

  // Tank geometrisini çıkar
  const T = tank.D || tank.W || 1.3;
  const H = tank.H || 2.0;
  const d_imp = tank.d_imp || 0.3;
  const rpm = tank.rpm_max || tank.rpm_min || 200;
  const imp = CFD_IMP_MAP[tank.imp_tip] || 'propeller';

  // Pervane yüksekliği: tipik olarak tank yüksekliğinin %20-25'i
  const impH = Math.round(H * 0.22 * 100) / 100;

  // Kw varsa motoru da göster (sadece bilgi amaçlı)
  const kw = tank.kw ? `${tank.kw} kW` : '?';

  cfdSetInputs({ impeller: imp, T, H, D: d_imp, impH, rpm, visc: 0.5, rho: 1200, baffle: false });

  // Bilgi kutusu
  bilgiEl.classList.remove('hidden');
  bilgiEl.innerHTML = `
    <div class="grid grid-cols-2 gap-1">
      <span class="text-slate-500">Tesis:</span><span class="text-slate-200 font-bold">${tank.tesis || tank.yer || '-'}</span>
      <span class="text-slate-500">Tank:</span><span class="text-slate-200">${tank.tip || 'silindirik'}</span>
      <span class="text-slate-500">Hacim:</span><span class="text-slate-200">${tank.kullanilabilir_lt || '-'} L</span>
      <span class="text-slate-500">Motor:</span><span class="text-slate-200">${kw}</span>
      <span class="text-slate-500">Pervane:</span><span class="text-cyan-400">${tank.imp_tip?.replace(/_/g,' ') || '-'}</span>
    </div>
    <p class="text-[8px] text-slate-500 mt-1 italic">Viskozite ve yoğunluğu üretilen boyaya göre girin.</p>`;

  cfdRebuildOnChange();
}

function cfdSetInputs(vals) {
  // Pervane
  const impEl = document.getElementById('cfd_impeller');
  if (impEl) impEl.value = vals.impeller;

  // Sayısal alanlar
  const fields = { cfd_T: vals.T, cfd_H: vals.H, cfd_D: vals.D, cfd_impH: vals.impH, cfd_visc: vals.visc, cfd_rho: vals.rho };
  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });

  // RPM slider
  const rpmEl = document.getElementById('cfd_rpm');
  const rpmLabel = document.getElementById('cfd_rpmLabel');
  if (rpmEl) { rpmEl.value = vals.rpm; }
  if (rpmLabel) rpmLabel.innerText = vals.rpm + ' RPM';

  // Baffle
  const baffleEl = document.getElementById('cfd_baffle');
  if (baffleEl) baffleEl.checked = vals.baffle;
}

// ─── Initialization ─────────────────────────────────────────
function cfdBootstrap() {
  cfdInit();
  cfdBindEvents();
  const p = cfdGetParams();
  cfdBuildStreamFunction(p);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cfdBootstrap);
} else {
  cfdBootstrap();
}
