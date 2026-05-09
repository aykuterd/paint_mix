// ============================================================
// CFD UI CONTROLLER — Event Handlers + Main Loop
// ============================================================

let cfdGeometry = 'cylindrical'; // 'cylindrical' | 'square'
let cfdWorker   = null;          // Web Worker instance (null = sync fallback)
let cfdLastP    = null;          // Son kullanılan params (worker result handler'da render için)
let cfdLastStepInfo = { Re: 0, D_eff: 0, vtip: 0 };

function cfdGetParams() {
  const geometry = cfdGeometry;
  const Htank = parseFloat(document.getElementById('cfd_Htank').value);
  const rho   = parseFloat(document.getElementById('cfd_rho').value);
  const kg    = parseFloat(document.getElementById('cfd_kg').value);

  let T, W, L, V_bombe, h_bombe, A_section, Vtotal, V_liq, H_liq;

  if (geometry === 'square') {
    W = parseFloat(document.getElementById('cfd_W').value) || 1.2;
    L = parseFloat(document.getElementById('cfd_L').value) || 1.5;
    T = (2 / Math.sqrt(Math.PI)) * Math.sqrt(W * L); // T_eq
    V_bombe   = 0;
    h_bombe   = 0;
    A_section = W * L;
    Vtotal    = A_section * Htank;
    V_liq     = (kg > 0 && rho > 0) ? kg / rho : 0;
    H_liq     = A_section > 1e-9 ? V_liq / A_section : 0;
    H_liq     = Math.max(0, Math.min(H_liq, Htank));
  } else {
    // Silindirik — torispherical bombe (DIN 28011 Klöpperboden)
    T         = parseFloat(document.getElementById('cfd_T').value);
    W         = null;
    L         = null;
    V_bombe   = 0.0847 * T * T * T;
    h_bombe   = T * (1 - Math.sqrt(0.65));
    A_section = Math.PI / 4 * T * T;
    Vtotal    = A_section * Htank + V_bombe;
    V_liq     = (kg > 0 && rho > 0) ? kg / rho : 0;
    const V_cyl_local = Math.max(0, V_liq - V_bombe);
    H_liq     = A_section > 1e-9 ? V_cyl_local / A_section : 0;
    H_liq     = Math.max(0, Math.min(H_liq, Htank));
  }

  return {
    geometry,
    T,       // T_eq for square, actual T for cylindrical — CFD engine always uses this
    W,
    L,
    H:      H_liq,
    Htank,
    Vliq:   V_liq,
    Vtotal,
    V_bombe,
    h_bombe,
    kg,
    D:    parseFloat(document.getElementById('cfd_D').value),
    impH: parseFloat(document.getElementById('cfd_impH').value),
    rpm:  parseFloat(document.getElementById('cfd_rpm').value),
    visc: parseFloat(document.getElementById('cfd_visc').value) / 1000,
    rho,
    baffle:  document.getElementById('cfd_baffle').checked,
    nonNewt: document.getElementById('cfd_nonNewt').checked,
    nn_K: parseFloat(document.getElementById('cfd_nnK').value) || 10,
    nn_n: parseFloat(document.getElementById('cfd_nnN').value) || 0.5,
    impeller: document.getElementById('cfd_impeller').value,
  };
}

function cfdUpdateLiqInfo(p) {
  const volEl      = document.getElementById('cfd_liqVol');
  const hEl        = document.getElementById('cfd_liqH');
  const gapEl      = document.getElementById('cfd_liqGap');
  const fillEl     = document.getElementById('cfd_liqFill');
  const bombeVolEl = document.getElementById('cfd_bombeVol');
  const bombeHEl   = document.getElementById('cfd_bombeH');
  const teqEl      = document.getElementById('cfd_Teq');
  const liqInfoEl  = document.getElementById('cfd_liqInfo');
  if (!volEl) return;

  const gap     = Math.max(0, p.Htank - p.H);
  const fillPct = p.Vtotal > 0 ? (p.Vliq / p.Vtotal) * 100 : 0;

  volEl.innerText  = (p.Vliq * 1000).toFixed(0) + ' L  (' + p.Vliq.toFixed(3) + ' m³)';
  hEl.innerText    = p.H.toFixed(2) + ' m';
  gapEl.innerText  = gap.toFixed(2) + ' m';
  fillEl.innerText = Math.min(100, fillPct).toFixed(0) + '%';

  if (p.geometry === 'square') {
    if (teqEl) teqEl.innerText = p.T.toFixed(3) + ' m';
  } else {
    if (bombeVolEl) bombeVolEl.innerText = (p.V_bombe * 1000).toFixed(0) + ' L  (' + p.V_bombe.toFixed(3) + ' m³)';
    if (bombeHEl)   bombeHEl.innerText   = p.h_bombe.toFixed(3) + ' m';
  }

  if (p.impH > p.H) {
    hEl.style.color = '#f87171';
    hEl.innerText += ' ⚠ Pervane sıvı dışında!';
  } else {
    hEl.style.color = '#67e8f9';
  }

  // D/T geçerlilik sınırı — Hayward Gordon "Optimum D/T vs. Viscosity" grafiği
  // Düşük viskozite (<100 cP): alt sınır ~0.20, üst sınır ~0.40
  // Yüksek viskozite (>1000 cP): D/T 0.40–0.70 kabul edilebilir
  const DT = p.T > 0 ? p.D / p.T : 0;
  const viscCp = (p.visc || 0.001) * 1000;
  const dtLow  = viscCp > 1000 ? 0.20 : 0.25;
  const dtHigh = viscCp > 1000 ? 0.60 : 0.40;
  let dtWarnEl = document.getElementById('cfd_dtWarn');
  if (!dtWarnEl) {
    dtWarnEl = document.createElement('p');
    dtWarnEl.id = 'cfd_dtWarn';
    dtWarnEl.className = 'text-[9px] mt-1';
    liqInfoEl && liqInfoEl.appendChild(dtWarnEl);
  }
  if (DT < dtLow) {
    dtWarnEl.style.color = '#fca5a5';
    dtWarnEl.innerText = `⚠ D/T = ${DT.toFixed(2)} — geçerli aralık altında (min ${dtLow.toFixed(2)}). t99 tahmini güvenilir değil. [Kaynak: Hayward Gordon]`;
  } else if (DT > dtHigh) {
    dtWarnEl.style.color = '#fcd34d';
    dtWarnEl.innerText = `⚠ D/T = ${DT.toFixed(2)} — tipik aralık üstünde (max ${dtHigh.toFixed(2)}). Güç tüketimi artar. [Kaynak: Hayward Gordon]`;
  } else {
    dtWarnEl.innerText = '';
  }

  // C/D pervane alt boşluk kontrolü — Hayward Gordon Impeller Positioning tablosu
  const CD = p.D > 0 ? p.impH / p.D : 0;
  // Hayward Gordon (2019) minimum C1/D aralığı: Radial 0.16, PBT 0.30, HP 0.50, Hydrofoil 0.70
  const _cdMin = { rushton: 0.16, cowles: 0.16, paddle: 0.16,
                   pbtd: 0.30, pbtu: 0.30,
                   propeller: 0.50, hydrofoil: 0.70,
                   anchor: 0.10 };
  const _cdOpt = { rushton: 0.30, cowles: 0.30, paddle: 0.30,
                   pbtd: 0.67, pbtu: 0.67,
                   propeller: 0.90, hydrofoil: 1.00,
                   anchor: 0.20 };
  const cdMin = _cdMin[p.impeller] ?? 0.25;
  const cdOpt = _cdOpt[p.impeller] ?? 0.50;
  let cdWarnEl = document.getElementById('cfd_cdWarn');
  if (!cdWarnEl) {
    cdWarnEl = document.createElement('p');
    cdWarnEl.id = 'cfd_cdWarn';
    cdWarnEl.className = 'text-[9px] mt-1';
    liqInfoEl && liqInfoEl.appendChild(cdWarnEl);
  }
  if (p.impH > 0 && CD < cdMin) {
    cdWarnEl.style.color = '#fca5a5';
    cdWarnEl.innerText = `⚠ C/D = ${CD.toFixed(2)} — geçerli aralık altında (min ${cdMin.toFixed(2)}). Ciddi alt ölü bölge. [Kaynak: Hayward Gordon]`;
  } else if (p.impH > 0 && CD < cdOpt * 0.7) {
    cdWarnEl.style.color = '#fcd34d';
    cdWarnEl.innerText = `⚠ C/D = ${CD.toFixed(2)} — optimumun altında (önerilen ~${cdOpt.toFixed(2)}). Alt karışım zayıf olabilir. [Kaynak: Hayward Gordon]`;
  } else {
    cdWarnEl.innerText = '';
  }

  // H/T (Z/T) — tek pervane maksimum yükseklik kontrolü — Hayward Gordon Impeller Positioning
  const HT = p.T > 0 ? p.H / p.T : 0;
  // Kaynak: Hayward Gordon (2019) — Maximum Z/T for single impeller
  const _maxZT = { rushton: 1.0, cowles: 1.0, paddle: 1.0,
                   pbtd: 1.2, pbtu: 1.2,
                   propeller: 1.25, hydrofoil: 1.3,
                   anchor: 1.0 };
  const maxZT = _maxZT[p.impeller] ?? 1.2;
  let htWarnEl = document.getElementById('cfd_htWarn');
  if (!htWarnEl) {
    htWarnEl = document.createElement('p');
    htWarnEl.id = 'cfd_htWarn';
    htWarnEl.className = 'text-[9px] mt-1';
    liqInfoEl && liqInfoEl.appendChild(htWarnEl);
  }
  if (HT > maxZT) {
    htWarnEl.style.color = '#fca5a5';
    htWarnEl.innerText = `⚠ H/T = ${HT.toFixed(2)} — tek pervane sınırı aşıldı (max ${maxZT.toFixed(2)}). Çift pervane gerekli! [Kaynak: Hayward Gordon]`;
  } else if (HT > maxZT * 0.85) {
    htWarnEl.style.color = '#fcd34d';
    htWarnEl.innerText = `⚠ H/T = ${HT.toFixed(2)} — tek pervane limitine yakın (max ${maxZT.toFixed(2)}). Homojenite azalabilir.`;
  } else {
    htWarnEl.innerText = '';
  }
}

function cfdUpdateMetricsUI(p, stepInfo, metrics) {
  console.log('[metricsUI]', !!p, !!stepInfo, !!metrics, 'cache=', JSON.stringify(CFD._deadZoneCache));
  const { Re, D_eff, vtip } = stepInfo;
  const { cov, homo, deadPct, t99_model } = metrics;

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
  const Vl = p.geometry === 'square'
    ? (p.W * p.L * p.H * 1000)
    : (Math.PI / 4 * p.T * p.T * p.H * 1000);
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
  const liqVol = p.geometry === 'square'
    ? (p.W * p.L * p.H)
    : (Math.PI / 4 * p.T * p.T * p.H);
  const PV = liqVol > 1e-9 ? power / liqVol : 0;

  // ── 45 dk Kural Kontrolü ─────────────────────────────────────
  const KURAL_DK = 45;
  let yeterlilik_html = '';
  if (t99_model !== null) {
    const t99_dk = t99_model / 60; // artık t99 değeri
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

    <div class="flex items-start gap-3 p-3 rounded-xl mb-3" style="background:rgba(251,191,36,0.10);border:2px solid rgba(251,191,36,0.45)">
      <span style="font-size:1.2rem;line-height:1;flex-shrink:0">⚠</span>
      <div>
        <p class="text-sm font-black mb-1" style="color:#fbbf24">Teorik alt sınır — gerçek üretim süresi farklı olabilir</p>
        <p class="text-xs leading-relaxed" style="color:#e2e8f0">
          Bu değer <b style="color:#fbbf24">sıvı-sıvı karışma için teorik alt sınırdır</b> (Nienow 1997, Grenville & Nienow 2004). Boyada renk homojenliğini belirleyen yalnızca sıvı karışması değildir; pigment topaklarının mekanik parçalanması, yüzey ıslanması ve rezinle etkileşim ek süre gerektirir.
        </p>
        <p class="text-xs leading-relaxed mt-1.5" style="color:#e2e8f0">
          İyi geometrili tanklarda (D/T ≥ 0.35) sıvı çok daha kısa sürede karışır; bu değer düşük çıkabilir. Kötü geometride (D/T &lt; 0.25) sıvı karışması zaten yavaş olduğundan değer pratiğe daha yakın gelir.
          <b style="color:#fbbf24">Üretim süresini belirlemek için kendi fabrika verinizi referans alın.</b>
        </p>
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
    </p>
    ${(() => {
      const mk = CFD._deadZoneCache && CFD._deadZoneCache.markov;
      console.log('[Markov debug]', JSON.stringify(CFD._deadZoneCache));
      if (!mk) return '<p style="color:#f87171;font-size:9px">Markov: cache yok</p>';
      const pct = v => (v * 100).toFixed(0);
      const exchCol = mk.exchRate > 0.5 ? '#4ade80' : mk.exchRate > 0.1 ? '#fbbf24' : '#f87171';
      return `<div class="mt-2 rounded-lg p-2" style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2)">
        <div class="text-[8px] mono mb-1" style="color:#a5b4fc">3-Bölge Markov Analizi</div>
        <div class="grid grid-cols-3 gap-1 text-center mb-1.5">
          <div><div class="text-[7px]" style="color:#94a3b8">Aktif</div><div class="text-[9px] font-bold mono" style="color:#4ade80">${pct(mk.zoneVols[0])}%</div></div>
          <div><div class="text-[7px]" style="color:#94a3b8">Bulk</div><div class="text-[9px] font-bold mono" style="color:#fbbf24">${pct(mk.zoneVols[1])}%</div></div>
          <div><div class="text-[7px]" style="color:#94a3b8">Ölü</div><div class="text-[9px] font-bold mono" style="color:#f87171">${pct(mk.zoneVols[2])}%</div></div>
        </div>
        <div class="flex justify-between text-[8px]">
          <span style="color:#94a3b8">λ₂ = <span class="mono" style="color:${exchCol}">${mk.lambda2.toExponential(2)}</span></span>
          <span style="color:#94a3b8">Karışım hızı: <span class="mono" style="color:${exchCol}">${mk.exchRate.toExponential(2)}</span></span>
        </div>
        <p class="text-[7px] italic mt-1" style="color:#475569">Fakheri & Moghaddas (IJCHE 2012) kompartman modeli</p>
      </div>`;
    })()}`;
}

// ─── Worker Setup ────────────────────────────────────────────
let _cfdWorkerTested = false; // Worker init bir kez denendi mi

function cfdEnsureWorker() {
  if (_cfdWorkerTested) return;
  _cfdWorkerTested = true;

  // file:// protokolünde Worker CORS kısıtlaması nedeniyle çalışmaz — sync mod
  if (location.protocol === 'file:') {
    cfdWorker = null;
    return;
  }

  try {
    const w = new Worker('cfd-engine.js');
    w.onmessage = _cfdOnWorkerMsg;
    w.onerror = (err) => {
      console.warn('CFD Worker hatası, senkron moda geçildi:', err.message || err);
      cfdWorker = null;
      if (CFD.running && cfdLastP) {
        cfdBuildStreamFunction(cfdLastP);
        cfdDrawSideView(document.getElementById('cfd_canvas'), cfdLastP);
        cfdLoop();
      }
    };
    cfdWorker = w;
  } catch (e) {
    console.warn('Web Worker başlatılamadı, senkron mod aktif:', e);
    cfdWorker = null;
  }
}

function _cfdDrawAll(p) {
  if (!p) return;
  cfdDrawSideView(document.getElementById('cfd_canvas'), p);
  cfdDrawTopView(document.getElementById('cfd_topCanvas'), p);
  cfdDrawCovGraph(document.getElementById('cfd_covGraph'));
  cfdDrawVelProfile(document.getElementById('cfd_velProfile'), p);
}

function _cfdOnWorkerMsg(e) {
  const d = e.data;

  console.log('[worker msg]', d.type, d.type === 'built' ? 'deadZone=' + JSON.stringify(d.deadZone) : '');
  if (d.type === 'built') {
    CFD.psi           = d.psi;
    CFD.ur            = d.ur;
    CFD.uz            = d.uz;
    CFD.vmag          = d.vmag;
    CFD.shearRate     = d.shearRate;
    if (d.deadZone) CFD._deadZoneCache = d.deadZone;
    _cfdDrawAll(cfdLastP);
    if (CFD.running) cfdWorker.postMessage({ type: 'step', p: cfdLastP, substeps: CFD.substeps });

  } else if (d.type === 'result') {
    CFD.C    = d.C;
    CFD.time = d.time;
    CFD.step = d.step;
    CFD.t95  = d.t95;
    cfdLastStepInfo = d.stepInfo;
    if (d.corrections) CFD._lastCorrections = d.corrections;

    if (d.covEntry) {
      CFD.covHistory.push(d.covEntry);
      d.probeVals.forEach((v, i) => CFD.probeData[i].push({ t: d.time, v }));
    }

    _cfdDrawAll(cfdLastP);
    cfdUpdateMetricsUI(cfdLastP, cfdLastStepInfo, d.metrics);

    if (CFD.running) cfdWorker.postMessage({ type: 'step', p: cfdLastP, substeps: CFD.substeps });

  } else if (d.type === 'injected') {
    CFD.C = d.C;
    if (!CFD.running && cfdLastP) cfdDrawSideView(document.getElementById('cfd_canvas'), cfdLastP);

  } else if (d.type === 'reset_done') {
    // State already reset in worker; local CFD arrays cleared separately
  }
}

// ─── Main Loop (senkron fallback) ────────────────────────────

function cfdLoop() {
  if (!CFD.running) return;
  console.log('[cfdLoop] step=', CFD.step);
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
  cfdLastP = p;

  if (CFD.step === 0) {
    CFD.C.fill(0);
    CFD.C2.fill(0);
    // Worker state'i de temizle (reset mesajı build'dan önce sıralı işlenir)
    if (cfdWorker) cfdWorker.postMessage({ type: 'reset' });
  }

  CFD.running = true;
  document.getElementById('cfd_statusDot').style.background = '#22c55e';
  document.getElementById('cfd_statusDot').classList.add('animate-pulse');
  document.getElementById('cfd_startBtn').innerHTML = '<i class="fas fa-stop"></i> DURDUR';
  document.getElementById('cfd_startBtn').style.background = '#7f1d1d';

  cfdEnsureWorker();
  if (cfdWorker) {
    // Worker modu: build → built → step → result → step → ...
    cfdWorker.postMessage({ type: 'build', p });
  } else {
    // Senkron fallback (file:// veya Worker desteği yoksa)
    cfdBuildStreamFunction(p);
    cfdDrawSideView(document.getElementById('cfd_canvas'), p);
    cfdLoop();
  }
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
  // Worker state'i de sıfırla
  if (cfdWorker) cfdWorker.postMessage({ type: 'reset' });
  cfdReset();
  cfdLastP = null;
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
    if (cfdWorker) {
      cfdWorker.postMessage({ type: 'inject', mode });
    } else {
      cfdInjectTracer(mode);
      const p = cfdGetParams();
      if (!CFD.running) cfdDrawSideView(document.getElementById('cfd_canvas'), p);
    }
  };

  document.getElementById('cfd_rpm').oninput = function () {
    document.getElementById('cfd_rpmLabel').innerText = this.value + ' RPM';
    cfdRebuildOnChange();
  };

  ['cfd_impeller', 'cfd_T', 'cfd_Htank', 'cfd_kg', 'cfd_D', 'cfd_impH', 'cfd_visc', 'cfd_rho', 'cfd_baffle', 'cfd_nonNewt', 'cfd_nnK', 'cfd_nnN', 'cfd_W', 'cfd_L'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', cfdRebuildOnChange);
  });
  // Sıvı yüksekliği etkileyen alanları "input" eventiyle de canlı hesapla
  ['cfd_T', 'cfd_Htank', 'cfd_kg', 'cfd_rho', 'cfd_W', 'cfd_L'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => cfdUpdateLiqInfo(cfdGetParams()));
  });

  // Non-Newtonian toggle
  document.getElementById('cfd_nonNewt').addEventListener('change', function () {
    document.getElementById('cfd_nnParams').style.display = this.checked ? '' : 'none';
    // Uyarı: hız alanı Newtonian yaklaşım, amplitüd scale edilir
    let nnWarnEl = document.getElementById('cfd_nnWarn');
    if (!nnWarnEl) {
      nnWarnEl = document.createElement('p');
      nnWarnEl.id = 'cfd_nnWarn';
      nnWarnEl.className = 'text-[9px] mt-1 italic';
      nnWarnEl.style.color = '#fcd34d';
      document.getElementById('cfd_nnParams')?.parentElement?.appendChild(nnWarnEl);
    }
    nnWarnEl.innerText = this.checked
      ? '⚠ Non-Newtonian mod: hız alanı Newtonian yaklaşımı, amplitüd Re_eff/Re ile ölçekleniyor. Kavern geometrisi ve yield stress tam modellenmemiştir.'
      : '';
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
    window._activePageTab = 'cfd';
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

  // ── Geometri Toggle ──────────────────────────────────────────
  const geoCylBtn = document.getElementById('cfd_geoCyl');
  const geoSqBtn  = document.getElementById('cfd_geoSq');
  if (geoCylBtn) geoCylBtn.onclick = () => {
    cfdGeometry = 'cylindrical';
    document.getElementById('cfd_geoCyl').classList.add('active');
    document.getElementById('cfd_geoSq').classList.remove('active');
    document.getElementById('cfd_T_row').classList.remove('hidden');
    document.getElementById('cfd_W_row').classList.add('hidden');
    document.getElementById('cfd_L_row').classList.add('hidden');
    document.getElementById('cfd_bombe_row1').classList.remove('hidden');
    document.getElementById('cfd_bombe_row2').classList.remove('hidden');
    document.getElementById('cfd_Teq_row').style.display = 'none';
    cfdRebuildOnChange();
  };
  if (geoSqBtn) geoSqBtn.onclick = () => {
    cfdGeometry = 'square';
    document.getElementById('cfd_geoSq').classList.add('active');
    document.getElementById('cfd_geoCyl').classList.remove('active');
    document.getElementById('cfd_T_row').classList.add('hidden');
    document.getElementById('cfd_W_row').classList.remove('hidden');
    document.getElementById('cfd_L_row').classList.remove('hidden');
    document.getElementById('cfd_bombe_row1').classList.add('hidden');
    document.getElementById('cfd_bombe_row2').classList.add('hidden');
    document.getElementById('cfd_Teq_row').style.display = 'flex';
    cfdRebuildOnChange();
  };

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

  // Varsayılan sipariş miktarı: silindir + bombe hacmini dolduran kg
  const rho_def = 1200;
  const V_bombe_tank = 0.0847 * T * T * T;
  const V_cyl_tank   = (tank.kullanilabilir_lt || 1500) / 1000; // m³

  // Kw varsa motoru da göster (sadece bilgi amaçlı)
  const kw = tank.kw ? `${tank.kw} kW` : '?';

  // Tank kesit geometrisi
  const tipi = (tank.tip || 'silindirik').toLowerCase();
  const isKare = tipi === 'kare' || tipi === 'dikdörtgen';
  const desteklenir = tipi === 'silindirik' || isKare;

  // Geometri toggle'ı tankın tipine göre ayarla
  if (isKare) {
    cfdGeometry = 'square';
    document.getElementById('cfd_geoSq')?.classList.add('active');
    document.getElementById('cfd_geoCyl')?.classList.remove('active');
    document.getElementById('cfd_T_row')?.classList.add('hidden');
    document.getElementById('cfd_W_row')?.classList.remove('hidden');
    document.getElementById('cfd_L_row')?.classList.remove('hidden');
    document.getElementById('cfd_bombe_row1')?.classList.add('hidden');
    document.getElementById('cfd_bombe_row2')?.classList.add('hidden');
    const teqRowEl = document.getElementById('cfd_Teq_row');
    if (teqRowEl) teqRowEl.style.display = 'flex';
  } else {
    cfdGeometry = 'cylindrical';
    document.getElementById('cfd_geoCyl')?.classList.add('active');
    document.getElementById('cfd_geoSq')?.classList.remove('active');
    document.getElementById('cfd_T_row')?.classList.remove('hidden');
    document.getElementById('cfd_W_row')?.classList.add('hidden');
    document.getElementById('cfd_L_row')?.classList.add('hidden');
    document.getElementById('cfd_bombe_row1')?.classList.remove('hidden');
    document.getElementById('cfd_bombe_row2')?.classList.remove('hidden');
    const teqRowEl = document.getElementById('cfd_Teq_row');
    if (teqRowEl) teqRowEl.style.display = 'none';
  }

  const W_val = isKare ? (tank.W || tank.L || T) : T;
  const L_val = isKare ? (tank.L || T) : T;
  const kg_def_final = isKare
    ? Math.round((tank.kullanilabilir_lt || 1500) / 1000 * rho_def)
    : Math.round((V_cyl_tank + V_bombe_tank) * rho_def);
  cfdSetInputs({ impeller: imp, T, W: W_val, L: L_val, Htank, D: d_imp, impH, rpm, visc: 0.5, rho: rho_def, kg: kg_def_final, baffle: false });

  // Bilgi kutusu
  bilgiEl.classList.remove('hidden');
  const uyariDesteksiz = desteklenir ? '' : `
    <div class="mt-2 p-2 rounded-lg" style="background:rgba(248,113,113,0.10);border:1px solid rgba(248,113,113,0.35)">
      <p class="text-[9px] font-black" style="color:#fca5a5">⚠ Tank kesit geometrisi: ${tank.tip}</p>
      <p class="text-[9px] mt-1" style="color:#fecaca">CFD motoru bu geometriyi desteklemiyor.</p>
    </div>`;
  // Kare/dikdörtgen tank: aksisimetrik motor uyarısı — köşe ölü bölgeleri gösterilemez
  const uyariKare = isKare ? `
    <div class="mt-2 p-2 rounded-lg" style="background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.40)">
      <p class="text-[9px] font-black" style="color:#fcd34d">⚠ Aksisimetrik Model Yaklaşımı</p>
      <p class="text-[9px] mt-1" style="color:#fef3c7">CFD motoru aksisimetriktir. Kare tank için T<sub>eq</sub>=(2/√π)·√(W·L) eşdeğer çap kullanılmaktadır. Köşe ölü bölgeleri simüle edilememekte; t99 ve karışım homojenliği sonuçları gerçek değerden %15–30 iyimser olabilir.</p>
    </div>` : '';
  bilgiEl.innerHTML = `
    <div class="grid grid-cols-2 gap-1">
      <span class="text-slate-500">Tesis:</span><span class="text-slate-200 font-bold">${tank.tesis || tank.yer || '-'}</span>
      <span class="text-slate-500">Tank:</span><span class="${desteklenir ? 'text-slate-200' : 'text-red-300 font-bold'}">${tank.tip || 'silindirik'}</span>
      <span class="text-slate-500">Hacim:</span><span class="text-slate-200">${tank.kullanilabilir_lt || '-'} L</span>
      <span class="text-slate-500">Motor:</span><span class="text-slate-200">${kw}</span>
      <span class="text-slate-500">Pervane:</span><span class="text-cyan-400">${tank.imp_tip?.replace(/_/g,' ') || '-'}</span>
    </div>
    <p class="text-[8px] text-slate-500 mt-1 italic">Viskozite ve yoğunluğu üretilen boyaya göre girin.</p>
    ${uyariKare}${uyariDesteksiz}`;

  // Başlat butonunu desteklenmeyen geometride devre dışı bırak
  cfdSetStartEnabled(desteklenir, desteklenir ? '' : `Bu tank ${tank.tip} kesitli — CFD desteği yok`);

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
    cfd_visc: vals.visc, cfd_rho: vals.rho, cfd_kg: vals.kg,
    cfd_W: vals.W, cfd_L: vals.L
  };
  Object.entries(fields).forEach(([id, val]) => {
    if (val === undefined || val === null) return;
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
  cfdEnsureWorker(); // Worker'ı önceden test et; başarısız olursa sync fallback hazır
  const p = cfdGetParams();
  cfdBuildStreamFunction(p);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cfdBootstrap);
} else {
  cfdBootstrap();
}
