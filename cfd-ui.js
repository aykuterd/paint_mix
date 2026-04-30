// ============================================================
// CFD UI CONTROLLER — Event Handlers + Main Loop
// ============================================================

function cfdGetParams() {
  const T    = parseFloat(document.getElementById('cfd_T').value);
  const Htank= parseFloat(document.getElementById('cfd_Htank').value);
  const rho  = parseFloat(document.getElementById('cfd_rho').value);
  const kg   = parseFloat(document.getElementById('cfd_kg').value);

  // Sıvı hacmi (m³) = kg / yoğunluk; sıvı yüksekliği = V / (π·T²/4)
  const A_section = Math.PI / 4 * T * T;             // m²
  const V_liq     = (kg > 0 && rho > 0) ? kg / rho : 0; // m³
  let   H_liq     = A_section > 1e-9 ? V_liq / A_section : 0;
  // Sıvı taşmasın, minimum altı sıfır olmasın
  H_liq = Math.max(0.05, Math.min(H_liq, Htank));

  return {
    impeller: document.getElementById('cfd_impeller').value,
    T,
    H:     H_liq,    // Fizik için kullanılan değer = gerçek sıvı yüksekliği
    Htank,           // Çizim için tankın toplam yüksekliği
    Vliq:  V_liq,
    kg,
    D:    parseFloat(document.getElementById('cfd_D').value),
    impH: parseFloat(document.getElementById('cfd_impH').value),
    rpm:  parseFloat(document.getElementById('cfd_rpm').value),
    visc: parseFloat(document.getElementById('cfd_visc').value),
    rho,
    baffle: document.getElementById('cfd_baffle').checked,
    nonNewt: document.getElementById('cfd_nonNewt').checked,
    nn_K: parseFloat(document.getElementById('cfd_nnK').value) || 10,
    nn_n: parseFloat(document.getElementById('cfd_nnN').value) || 0.5,
  };
}

function cfdUpdateLiqInfo(p) {
  const volEl  = document.getElementById('cfd_liqVol');
  const hEl    = document.getElementById('cfd_liqH');
  const gapEl  = document.getElementById('cfd_liqGap');
  const fillEl = document.getElementById('cfd_liqFill');
  if (!volEl) return;
  const gap = Math.max(0, p.Htank - p.H);
  const fillPct = p.Htank > 0 ? (p.H / p.Htank) * 100 : 0;
  volEl.innerText  = (p.Vliq * 1000).toFixed(0) + ' L  (' + p.Vliq.toFixed(3) + ' m³)';
  hEl.innerText    = p.H.toFixed(2) + ' m';
  gapEl.innerText  = gap.toFixed(2) + ' m';
  fillEl.innerText = fillPct.toFixed(0) + '%';

  // Pervane sıvı altında mı?
  if (p.impH > p.H) {
    hEl.style.color = '#f87171';
    hEl.innerText += ' ⚠ Pervane sıvı dışında!';
  } else {
    hEl.style.color = '#67e8f9';
  }
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
  document.getElementById('cfd_cov').style.color = cov < 0.01 ? '#4ade80' : cov < 0.05 ? '#fbbf24' : '#f87171';
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
    const t99_dk = t95_grenville / 60; // artık t99 değeri
    let renk, ikon, mesaj;
    if (t99_dk <= KURAL_DK * 0.60) {
      renk = '#22d3ee'; ikon = '⚡';
      mesaj = `Bu setup güçlü — ${t99_dk.toFixed(0)} dk'da renk homojenliği sağlanır. Daha düşük RPM denenebilir.`;
    } else if (t99_dk <= KURAL_DK * 0.90) {
      renk = '#4ade80'; ikon = '✅';
      mesaj = `45 dk yeterli, ${Math.round(KURAL_DK - t99_dk)} dk güvenlik payı var.`;
    } else if (t99_dk <= KURAL_DK * 1.10) {
      renk = '#4ade80'; ikon = '✅';
      mesaj = `45 dk ile renk homojenliği sağlanır (t₉₉ ≈ ${t99_dk.toFixed(0)} dk).`;
    } else if (t99_dk <= KURAL_DK * 1.35) {
      renk = '#fbbf24'; ikon = '⚠';
      mesaj = `Sınırda — 45 dk yetmeyebilir. Alt/orta/üst numune alınmasını öneririz.`;
    } else {
      renk = '#f87171'; ikon = '❌';
      mesaj = `45 dk YETMİYOR (t₉₉ = ${t99_dk.toFixed(0)} dk). RPM artırın veya daha büyük pervane kullanın.`;
    }
    const barPct = Math.min(100, (KURAL_DK / t99_dk) * 100).toFixed(0);

    // Düzeltme faktörleri
    const cor = CFD._lastCorrections || {};
    let factors_html = '';
    if (cor.N_tur !== undefined) {
      // 1) t99 eşiği — her zaman göster
      factors_html += `
        <div class="flex items-start gap-2 p-2 rounded-lg" style="background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.18)">
          <span class="text-sm font-black mono flex-shrink-0" style="color:#22d3ee">×${cor.t99_mult.toFixed(2)}</span>
          <div>
            <p class="text-xs font-black" style="color:#22d3ee">t₉₉ Eşiği (CoV &lt; 0.01)</p>
            <p class="text-xs leading-relaxed" style="color:#94a3b8">Renk kontrolü için t₉₅ yetersiz; %99 homojenlik gerekir. <b style="color:#cbd5e1">t₉₉ = ln(100)/ln(20) × t₉₅</b> — Grenville &amp; Nienow (2004)</p>
          </div>
        </div>`;
      // 2) Devirdaim sayısı (Re_eff bazlı) — her zaman göster
      factors_html += `
        <div class="flex items-start gap-2 p-2 rounded-lg" style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.18)">
          <span class="text-sm font-black mono flex-shrink-0" style="color:#fbbf24">×${cor.N_tur}</span>
          <div>
            <p class="text-xs font-black" style="color:#fbbf24">Devirdaim Sayısı (Re_eff = ${cor.Re_eff})</p>
            <p class="text-xs leading-relaxed" style="color:#94a3b8">Metzner-Otto efektif viskozite ile hesaplanan Re_eff'e göre %99 homojenlik için kaç tam sirkülasyon gerektiğini belirtir. <b style="color:#cbd5e1">Nienow (1997) Tablo 2.</b></p>
          </div>
        </div>`;
      // 3) H/T geometri — sadece H/T > 1.2'de göster
      if (cor.HT_factor > 1.01) {
        factors_html += `
        <div class="flex items-start gap-2 p-2 rounded-lg" style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.18)">
          <span class="text-sm font-black mono flex-shrink-0" style="color:#c084fc">×${cor.HT_factor.toFixed(2)}</span>
          <div>
            <p class="text-xs font-black" style="color:#c084fc">H/T Geometri Düzeltmesi (H/T = ${cor.HT.toFixed(2)})</p>
            <p class="text-xs leading-relaxed" style="color:#94a3b8">Derin tanklarda (H/T &gt; 1.2) karışma süresi uzar; pervane daha az hacmi dolaşıma katıyor. <b style="color:#cbd5e1">Rodgers et al. (2011), Chem. Eng. Sci.</b></p>
          </div>
        </div>`;
      }
      // 4) D_eff geçiş rejimi — Re < 10000 ise göster
      if (cor.Re_bulk < 10000) {
        const f_label = cor.turb_factor_deff < 0.5 ? (cor.turb_factor_deff * 100).toFixed(0) + '% türbülans' : (cor.turb_factor_deff).toFixed(2);
        factors_html += `
        <div class="flex items-start gap-2 p-2 rounded-lg" style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.18)">
          <span class="text-sm font-black mono flex-shrink-0" style="color:#f97316">${f_label}</span>
          <div>
            <p class="text-xs font-black" style="color:#f97316">Simülasyon: Geçiş Rejimi D_eff (Re = ${cor.Re_bulk})</p>
            <p class="text-xs leading-relaxed" style="color:#94a3b8">Re &lt; 10,000'de türbülanslı difüzyon sönümlenir; simülasyondaki D_eff <b style="color:#cbd5e1">D_turb / (1 + 6000/Re)</b> formülüyle düşürüldü. Bu sayede PDE'nin kendisi daha yavaş karışım hesaplar. <b style="color:#cbd5e1">Grenville &amp; Nienow (2004).</b></p>
          </div>
        </div>`;
      }
    }

    yeterlilik_html = `
    <div class="p-3 rounded-xl mb-3" style="background:rgba(0,0,0,0.35);border:1px solid ${renk}40">
      <div class="flex justify-between items-center mb-1.5">
        <span class="text-xs font-black uppercase tracking-wider" style="color:${renk}">Renk Homojenliği (t₉₉) ${ikon}</span>
        <span class="mono font-black text-2xl" style="color:${renk}">${t99_dk.toFixed(0)} dk</span>
      </div>
      <p class="text-xs leading-relaxed mb-2" style="color:#94a3b8">${mesaj}</p>
      <div class="h-2 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.08)">
        <div style="width:${barPct}%;height:100%;background:${renk};border-radius:99px;transition:width 0.5s"></div>
      </div>
      <div class="flex justify-between text-xs mt-1 mono" style="color:#64748b">
        <span>0 dk</span><span style="color:${renk}80">45 dk kural</span><span>t₉₉</span>
      </div>
    </div>
    ${factors_html ? `
    <div class="mb-2">
      <p class="text-xs font-black uppercase tracking-wider mb-2" style="color:#64748b">Uygulanan Düzeltmeler</p>
      <div class="space-y-1.5">${factors_html}</div>
    </div>` : ''}
    <div class="p-2 rounded-lg mt-2" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07)">
      <p class="text-xs font-black mb-1" style="color:#fbbf24">t₉₉ Formülü vs Simülasyon CoV</p>
      <p class="text-xs leading-relaxed" style="color:#94a3b8"><span style="color:#4ade80">t₉₉ (dk)</span> → Nienow (1997) turnover modeli; viskozite, RPM, D ve geometriden hesaplanır. Gerçek süreye yakın tahmin.</p>
      <p class="text-xs leading-relaxed mt-1" style="color:#94a3b8"><span style="color:#22d3ee">CoV / Homojenlik (%)</span> → Tracer enjekte edilince simülasyonda izlenir. CoV &lt; 0.01 = t₉₉ anı. Simülasyon saniyesi gerçek dakikayla birebir örtüşmez.</p>
    </div>`;
  }

  // ── Vorteks / Taşma kontrolü ─────────────────────────────────
  const vx = cfdOverflowStatus(p);
  const vxColor = vx.level === 'critical' ? '#f87171'
                : vx.level === 'warn'     ? '#fbbf24' : '#4ade80';
  const vxIcon  = vx.level === 'critical' ? '❌' : vx.level === 'warn' ? '⚠' : '✅';
  const vxBarPct = Math.min(100, (vx.h_v / Math.max(vx.gap, 1e-3)) * 100).toFixed(0);
  const vortex_html = `
    <div class="p-3 rounded-xl mb-2" style="background:rgba(0,0,0,0.35);border:1px solid ${vxColor}40">
      <div class="flex justify-between items-center mb-1">
        <span class="text-[9px] font-black uppercase tracking-wider" style="color:${vxColor}">Yüzey Vorteksi & Taşma ${vxIcon}</span>
        <span class="mono font-black text-base" style="color:${vxColor}">${(vx.h_v*100).toFixed(0)} cm</span>
      </div>
      <p class="text-[9px] leading-relaxed mb-1.5" style="color:#cbd5e1">${vx.msg}</p>
      <div class="h-1.5 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.08)">
        <div style="width:${vxBarPct}%;height:100%;background:${vxColor};border-radius:99px;transition:width 0.4s"></div>
      </div>
      <div class="flex justify-between text-[8px] mt-0.5 mono" style="color:#94a3b8">
        <span>Vortex ${(vx.h_v*100).toFixed(1)} cm</span>
        <span>Üst boşluk ${(vx.gap*100).toFixed(1)} cm</span>
      </div>
      <p class="text-[8px] italic mt-1" style="color:#64748b">Nagata (1975) · Rieger et al. (1979): h_v ≈ π²N²D⁴/(2gT²)·k_imp·f_turb</p>
    </div>`;

  deadEl.innerHTML = `
    ${vortex_html}
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
      // Check t99 (renk kontrolü standardı — CoV < 0.01)
      if (CFD.t95 === null && metrics.cov < 0.01) {
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
  cfdUpdateLiqInfo(p);
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

  ['cfd_impeller', 'cfd_T', 'cfd_Htank', 'cfd_kg', 'cfd_D', 'cfd_impH', 'cfd_visc', 'cfd_rho', 'cfd_baffle', 'cfd_nonNewt', 'cfd_nnK', 'cfd_nnN'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', cfdRebuildOnChange);
  });
  // Sıvı yüksekliği etkileyen alanları "input" eventiyle de canlı hesapla
  ['cfd_T', 'cfd_Htank', 'cfd_kg', 'cfd_rho'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => cfdUpdateLiqInfo(cfdGetParams()));
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
        concentration: 'C / Cmax (anlık) — dağılım arttıkça her yer kırmızıya yaklaşır',
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
  impeller: 'propeller', T: 1.3, Htank: 2.27, D: 0.3,
  impH: 0.4, rpm: 100, visc: 0.5, rho: 1200, kg: 2400, baffle: false
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
    cfdSetStartEnabled(true);
    cfdRebuildOnChange();
    return;
  }

  const tank = TANK_DB.find(t => t.kod === kod);
  if (!tank) return;

  // Tank geometrisini çıkar
  const T = tank.D || tank.W || 1.3;
  const Htank = tank.H || 2.27;
  const d_imp = tank.d_imp || 0.3;
  const rpm = tank.rpm_max || tank.rpm_min || 200;
  const imp = CFD_IMP_MAP[tank.imp_tip] || 'propeller';

  // Pervane yüksekliği: tipik olarak tank yüksekliğinin %20-25'i
  const impH = Math.round(Htank * 0.22 * 100) / 100;

  // Varsayılan sipariş miktarı: tankın "kullanilabilir_lt" hacmini varsayılan
  // yoğunluk (1200) ile dolduran kg miktarı.
  const rho_def = 1200;
  const kg_def = Math.round((tank.kullanilabilir_lt || 1500) * rho_def / 1000);

  // Kw varsa motoru da göster (sadece bilgi amaçlı)
  const kw = tank.kw ? `${tank.kw} kW` : '?';

  cfdSetInputs({ impeller: imp, T, Htank, D: d_imp, impH, rpm, visc: 0.5, rho: rho_def, kg: kg_def, baffle: false });

  // Tank kesit geometrisi: silindirik dışı tipler için CFD desteklenmiyor
  const tipi = (tank.tip || 'silindirik').toLowerCase();
  const desteklenir = tipi === 'silindirik';

  // Bilgi kutusu
  bilgiEl.classList.remove('hidden');
  const uyari = desteklenir ? '' : `
    <div class="mt-2 p-2 rounded-lg" style="background:rgba(248,113,113,0.10);border:1px solid rgba(248,113,113,0.35)">
      <p class="text-[9px] font-black" style="color:#fca5a5">⚠ Tank kesit geometrisi: ${tank.tip}</p>
      <p class="text-[9px] mt-1" style="color:#fecaca">CFD motoru şu an yalnızca silindirik (axisymmetric) tankları doğru hesaplıyor. Kare/dikdörtgen kesit için 3D model entegrasyonu eklenecek. Şimdilik simülasyon devre dışı.</p>
    </div>`;
  bilgiEl.innerHTML = `
    <div class="grid grid-cols-2 gap-1">
      <span class="text-slate-500">Tesis:</span><span class="text-slate-200 font-bold">${tank.tesis || tank.yer || '-'}</span>
      <span class="text-slate-500">Tank:</span><span class="${desteklenir ? 'text-slate-200' : 'text-red-300 font-bold'}">${tank.tip || 'silindirik'}</span>
      <span class="text-slate-500">Hacim:</span><span class="text-slate-200">${tank.kullanilabilir_lt || '-'} L</span>
      <span class="text-slate-500">Motor:</span><span class="text-slate-200">${kw}</span>
      <span class="text-slate-500">Pervane:</span><span class="text-cyan-400">${tank.imp_tip?.replace(/_/g,' ') || '-'}</span>
    </div>
    <p class="text-[8px] text-slate-500 mt-1 italic">Viskozite ve yoğunluğu üretilen boyaya göre girin.</p>
    ${uyari}`;

  // Başlat butonunu desteklenmeyen geometride devre dışı bırak
  cfdSetStartEnabled(desteklenir, desteklenir ? '' : `Bu tank ${tank.tip} kesitli — CFD desteği henüz eklenmedi`);

  cfdRebuildOnChange();
}

// ─── Başlat butonu durumunu değiştir ─────────────────────────
function cfdSetStartEnabled(enabled, reason) {
  const btn = document.getElementById('cfd_startBtn');
  if (!btn) return;
  if (enabled) {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.title = '';
    btn.dataset.disabledReason = '';
  } else {
    // Çalışıyorsa durdur
    if (typeof CFD !== 'undefined' && CFD.running && typeof cfdStopSim === 'function') cfdStopSim();
    btn.disabled = true;
    btn.style.opacity = '0.45';
    btn.style.cursor = 'not-allowed';
    btn.title = reason || '';
    btn.dataset.disabledReason = reason || 'devre dışı';
  }
}

function cfdSetInputs(vals) {
  // Pervane
  const impEl = document.getElementById('cfd_impeller');
  if (impEl) impEl.value = vals.impeller;

  // Sayısal alanlar
  const fields = {
    cfd_T: vals.T, cfd_Htank: vals.Htank, cfd_D: vals.D, cfd_impH: vals.impH,
    cfd_visc: vals.visc, cfd_rho: vals.rho, cfd_kg: vals.kg
  };
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
