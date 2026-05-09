// ============================================================
// CFD ENGINE v2 — Stream Function Axisymmetric Model
// Patankar (1980), Grenville & Nienow (2004)
// ============================================================

const CFD = {
  NR: 50, NZ: 80,
  psi: null, C: null, C2: null,
  ur: null, uz: null, vmag: null, shearRate: null,
  running: false, animId: null, step: 0, time: 0,
  viewMode: 'concentration', colorMap: 'jet',
  showStreamlines: true, substeps: 6,
  covHistory: [], probeData: [[], [], [], []],
  probes: [
    { rn: 0.15, zn: 0.75, label: 'Üst Merkez' },
    { rn: 0.85, zn: 0.25, label: 'Alt Duvar' },
    { rn: 0.50, zn: 0.50, label: 'Orta' },
    { rn: 0.15, zn: 0.25, label: 'Alt Merkez' },
  ],
  t95: null,
};

function cfdIdx(ir, iz) { return iz * CFD.NR + ir; }

function cfdInit() {
  const n = CFD.NR * CFD.NZ;
  CFD.psi = new Float64Array(n);
  CFD.C = new Float64Array(n);
  CFD.C2 = new Float64Array(n);
  CFD.ur = new Float64Array(n);
  CFD.uz = new Float64Array(n);
  CFD.vmag = new Float64Array(n);
  CFD.shearRate = new Float64Array(n);
}

// ─── Stream Function Definitions ──────────────────────────────
// ψ automatically satisfies ∇·u = 0
// ur = (1/r)·∂ψ/∂z,  uz = -(1/r)·∂ψ/∂r

function cfdBuildStreamFunction(p) {
  const { NR, NZ } = CFD;
  const R = p.T / 2;
  const H = p.H;
  const N = p.rpm / 60;
  const vtip = Math.PI * p.D * N;
  const Nq = _getNq(p.impeller);
  const Q = Nq * N * Math.pow(p.D, 3); // m³/s gerçek pompalama debisi

  // Non-Newtonian kavern yaklaşımı: Re_eff << Re_Newt → akış daha lokalize
  // Stream function hâlâ aksisimetrik/Newtonian formu koruyor (kavern geometrisi
  // tam 3D gerektirir), ancak amplitüdü Re_eff/Re oranıyla scale ederek
  // zayıflamış dolaşımı yaklaşık yansıtıyoruz. Forschner et al. (1996).
  let A_scale = 1.0;
  if (p.nonNewt && p.nn_n < 1.0 && p.nn_K > 0) {
    const gamma_av = 10.5 * N; // Metzner-Otto ortalama kesme hızı
    const mu_eff_loc = p.nn_K * Math.pow(Math.max(gamma_av, 0.01), p.nn_n - 1);
    const Re_eff_loc = p.rho * N * p.D * p.D / Math.max(mu_eff_loc, 1e-6);
    const Re_newt   = p.rho * N * p.D * p.D / Math.max(p.visc, 1e-6);
    A_scale = Math.min(1.0, Math.max(0.15, Re_eff_loc / Math.max(Re_newt, 1)));
  }
  const A = Q * A_scale;

  const dr = R / NR;
  const dz = H / NZ;
  const z_imp = p.impH;

  // Hayward Gordon (2019): tek pervane için maksimum Z/T erişim sınırı
  const _maxZT = { rushton: 1.0, cowles: 1.0, paddle: 1.0,
                   pbtd: 1.2, pbtu: 1.2,
                   propeller: 1.25, hydrofoil: 1.3,
                   anchor: 1.5 };
  const maxZT  = _maxZT[p.impeller] ?? 1.2;
  const T_ref  = p.geometry === 'square' ? Math.sqrt(p.W * p.L) : p.T;
  const H_reach = Math.min(H, maxZT * T_ref); // pervane akışının ulaşabildiği maks yükseklik

  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const r = (ir + 0.5) * dr;
      const z = (iz + 0.5) * dz;
      const rn = r / R;
      const idx = cfdIdx(ir, iz);

      // Erişim zayıflaması: H_reach üzerinde psi üstel olarak söner → ölü bölge
      const reach_att = z <= H_reach
        ? 1.0
        : Math.exp(-Math.pow((z - H_reach) / (H * 0.12), 2));

      // Radial shape: zero at axis and wall
      const fr = rn * (1 - rn * rn);

      let psi = 0;

      if (p.impeller === 'rushton' || p.impeller === 'paddle') {
        // Dual counter-rotating vortices
        const strength = p.impeller === 'rushton' ? 1.4 : 1.0;
        if (z >= z_imp) {
          const zn = (z - z_imp) / (H - z_imp + 1e-10);
          psi = A * strength * fr * Math.sin(Math.PI * zn);
        } else {
          const zn = z / (z_imp + 1e-10);
          psi = -A * strength * fr * Math.sin(Math.PI * zn);
        }
        // Enhance radial jet at impeller level
        const dz_n = Math.abs(z - z_imp) / H;
        const jet = Math.exp(-Math.pow(dz_n / 0.08, 2));
        psi += A * strength * 0.3 * rn * rn * (1 - rn) * jet * (z >= z_imp ? 1 : -1);

      } else if (p.impeller === 'propeller' || p.impeller === 'hydrofoil' || p.impeller === 'pbtd') {
        // Single loop: down center, up wall (axial down-pumping)
        const strength = p.impeller === 'hydrofoil' ? 1.3 : 1.0;
        const zn = z / H;
        psi = A * strength * fr * Math.sin(Math.PI * zn);
        // Strengthen near impeller
        const dz_n = Math.abs(z - z_imp) / H;
        const focus = 1.0 + 0.5 * Math.exp(-Math.pow(dz_n / 0.15, 2));
        psi *= focus;

      } else if (p.impeller === 'pbtu') {
        // Single loop: up center, down wall (axial up-pumping)
        const zn = z / H;
        psi = -A * fr * Math.sin(Math.PI * zn);

      } else if (p.impeller === 'anchor') {
        // Anchor: duvar boyunca sürükleme akışı, zayıf aksiyel pompalama.
        // Teğetsel bileşen aksisimetrik psi'de temsil edilemez; aksiyel döngü
        // için wall_fr profili r²·(1-r)^0.5 — daha dar duvar piki, merkez sıfır.
        // Nq = 0.05 zaten çok düşük aksiyel pompayı yansıtıyor.
        const wall_fr = Math.pow(rn, 2.5) * Math.pow(1 - rn, 0.5);
        const zn = z / H;
        psi = A * 0.35 * wall_fr * Math.sin(Math.PI * zn);

      } else if (p.impeller === 'cowles') {
        // High-shear disk: strong radial + dual vortex, narrow
        if (z >= z_imp) {
          const zn = (z - z_imp) / (H - z_imp + 1e-10);
          psi = A * 0.8 * fr * Math.sin(Math.PI * zn);
        } else {
          const zn = z / (z_imp + 1e-10);
          psi = -A * 0.8 * fr * Math.sin(Math.PI * zn);
        }
        // Very strong narrow radial jet
        const dz_n = Math.abs(z - z_imp) / H;
        const jet = Math.exp(-Math.pow(dz_n / 0.04, 2));
        psi += A * 0.6 * rn * rn * (1 - rn) * jet * (z >= z_imp ? 1 : -1);
      }

      // Baffle effect: strengthens axial, weakens tangential
      if (p.baffle && p.impeller !== 'anchor') {
        psi *= 1.15;
      }

      // Yüksek H/T'de üst ölü bölge: pervane erişimi dışındaki alanlarda psi söner
      psi *= reach_att;

      CFD.psi[idx] = psi;
    }
  }

  // Derive velocities from stream function
  _cfdDeriveVelocities(p);
}

function _cfdDeriveVelocities(p) {
  const { NR, NZ, psi, ur, uz, vmag } = CFD;
  const R = p.T / 2;
  const dr = R / NR;
  const dz = p.H / NZ;

  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const idx = cfdIdx(ir, iz);
      const r = (ir + 0.5) * dr;

      // ∂ψ/∂z by central differences
      const psi_zp = iz < NZ - 1 ? psi[cfdIdx(ir, iz + 1)] : psi[idx];
      const psi_zm = iz > 0 ? psi[cfdIdx(ir, iz - 1)] : psi[idx];
      const dpsi_dz = (psi_zp - psi_zm) / (2 * dz);

      // ∂ψ/∂r by central differences
      const psi_rp = ir < NR - 1 ? psi[cfdIdx(ir + 1, iz)] : psi[idx];
      const psi_rm = ir > 0 ? psi[cfdIdx(ir - 1, iz)] : psi[idx];
      const dpsi_dr = (psi_rp - psi_rm) / (2 * dr);

      // Pole treatment: at r→0, use L'Hôpital
      if (ir === 0) {
        ur[idx] = (psi[cfdIdx(1, iz + Math.min(1, NZ - 1 - iz))] - psi[cfdIdx(1, iz - Math.min(1, iz))]) / (2 * dz * dr);
        uz[idx] = -(psi[cfdIdx(1, iz)] - psi[cfdIdx(0, iz)]) / (dr * dr) * 2;
      } else {
        ur[idx] = dpsi_dz / r;
        uz[idx] = -dpsi_dr / r;
      }

      vmag[idx] = Math.sqrt(ur[idx] * ur[idx] + uz[idx] * uz[idx]);
    }
  }

  // Compute shear rate field
  _cfdComputeShearRate(p);

  // Hız alanı hazır — fizik tabanlı ölü bölge & Markov cache'i güncelle
  CFD._deadZoneCache = {
    deadPct: cfdDeadZoneFraction(p),
    markov:  cfdMarkovAnalysis(p),
  };
}

function _cfdComputeShearRate(p) {
  const { NR, NZ, ur, uz, shearRate } = CFD;
  const R = p.T / 2;
  const dr = R / NR;
  const dz = p.H / NZ;

  for (let iz = 1; iz < NZ - 1; iz++) {
    for (let ir = 1; ir < NR - 1; ir++) {
      const idx = cfdIdx(ir, iz);
      const dur_dr = (ur[cfdIdx(ir + 1, iz)] - ur[cfdIdx(ir - 1, iz)]) / (2 * dr);
      const dur_dz = (ur[cfdIdx(ir, iz + 1)] - ur[cfdIdx(ir, iz - 1)]) / (2 * dz);
      const duz_dr = (uz[cfdIdx(ir + 1, iz)] - uz[cfdIdx(ir - 1, iz)]) / (2 * dr);
      const duz_dz = (uz[cfdIdx(ir, iz + 1)] - uz[cfdIdx(ir, iz - 1)]) / (2 * dz);

      shearRate[idx] = Math.sqrt(
        2 * (dur_dr * dur_dr + duz_dz * duz_dz) +
        (dur_dz + duz_dr) * (dur_dz + duz_dr)
      );
    }
  }
}

function _getNq(imp) {
  const map = {
    // Kaynak: Hayward Gordon Mastering Mixing Fundamentals (2019)
    // Radial Flow (Rushton): Nq=0.95–1.23 → orta 1.09
    // Pitched Blade: Nq=0.68–0.86 → orta 0.77
    // Hydrofoil: Nq=0.60–0.70 → orta 0.65
    propeller: 0.55, hydrofoil: 0.65, paddle: 0.77,
    rushton: 1.09, anchor: 0.05, pbtu: 0.77,
    pbtd: 0.77, cowles: 0.35,
  };
  return map[imp] || 0.40;
}

function _getNp(imp) {
  const map = {
    propeller: 0.35, hydrofoil: 0.30, paddle: 2.10,
    rushton: 5.50, anchor: 3.00, pbtu: 1.30,
    pbtd: 1.30, cowles: 0.30,
  };
  return map[imp] || 1.0;
}

// ─── Advection-Diffusion Solver (Operator Splitting) ──────────
function cfdSolveStep(p) {
  const { NR, NZ, C, C2, ur, uz, vmag, shearRate } = CFD;
  const R = p.T / 2;
  const dr = R / NR;
  const dz = p.H / NZ;
  const N = p.rpm / 60;

  // Effective diffusion — Nienow & Miles (1978), Grenville & Nienow (2004)
  const Re = p.rho * N * p.D * p.D / p.visc;
  const vtip = Math.PI * p.D * N;
  // Geçiş rejimi düzeltmesi: Re < 10.000'de türbülanslı difüzyon sönümlenir.
  // turb_factor = 1/(1 + Re_t/Re), Re_t = 6000 — Grenville & Nienow (2004)
  // (Eski: Re/1000 → 0.5 at Re=500; Yeni: 1/(1+6000/500) = 0.077 at Re=500)
  const turb_factor = 1.0 / (1.0 + 6000.0 / Math.max(Re, 1.0));
  const nu_t = 0.01 * vtip * p.D * turb_factor;
  const D_turb = nu_t / 0.7;
  // Moleküler difüzyon ihmal edilebilir (pigment ~1e-11 m²/s)
  const D_base = D_turb + 1e-11;

  // CFL stability
  let vmax = 0;
  for (let i = 0; i < NR * NZ; i++) if (vmag[i] > vmax) vmax = vmag[i];
  vmax = Math.max(vmax, 1e-8);

  const dt_adv = 0.3 * Math.min(dr, dz) / vmax;
  const dt_diff = 0.2 * Math.min(dr, dz) * Math.min(dr, dz) / (2 * (D_base + 1e-12));
  const dt = Math.min(dt_adv, dt_diff, 0.5);

  // Non-Newtonian local diffusion scaling
  const useNN = p.nonNewt && p.nn_n < 1.0;

  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const idx = cfdIdx(ir, iz);
      const r = (ir + 0.5) * dr;

      const Cij = C[idx];
      const Ci1j = ir > 0 ? C[cfdIdx(ir - 1, iz)] : Cij;
      const Ci2j = ir < NR - 1 ? C[cfdIdx(ir + 1, iz)] : Cij;
      const Cij1 = iz > 0 ? C[cfdIdx(ir, iz - 1)] : Cij;
      const Cij2 = iz < NZ - 1 ? C[cfdIdx(ir, iz + 1)] : Cij;

      // Local effective diffusion (non-Newtonian: higher shear → lower visc → higher diff)
      let D_eff = D_base;
      if (useNN) {
        const gamma = Math.max(shearRate[idx], 0.01);
        const eta_local = p.nn_K * Math.pow(gamma, p.nn_n - 1);
        const eta_ratio = p.visc / Math.max(eta_local, 0.001);
        D_eff = D_base * Math.max(0.1, Math.min(5.0, eta_ratio));
      }

      // Diffusion: cylindrical Laplacian
      const d2Cdr2 = (Ci2j - 2 * Cij + Ci1j) / (dr * dr);
      const dCdr = (Ci2j - Ci1j) / (2 * dr);
      const d2Cdz2 = (Cij2 - 2 * Cij + Cij1) / (dz * dz);
      const laplacian = ir === 0
        ? 4 * (Ci2j - Cij) / (dr * dr) + d2Cdz2  // pole: L'Hôpital 1/r·∂/∂r(r·∂C/∂r) → 2·∂²C/∂r²
        : d2Cdr2 + (1 / r) * dCdr + d2Cdz2;

      // Advection: 1st order upwind
      const u = ur[idx];
      const w = uz[idx];
      const adv_r = u > 0 ? u * (Cij - Ci1j) / dr : u * (Ci2j - Cij) / dr;
      const adv_z = w > 0 ? w * (Cij - Cij1) / dz : w * (Cij2 - Cij) / dz;

      C2[idx] = Cij + dt * (D_eff * laplacian - adv_r - adv_z);
      C2[idx] = Math.max(0, Math.min(1, C2[idx]));
    }
  }

  // Swap
  const tmp = CFD.C;
  CFD.C = CFD.C2;
  CFD.C2 = tmp;

  return { dt, D_eff: D_base, vtip, Re };
}

// ─── Tracer Injection ────────────────────────────────────────
function cfdInjectTracer(mode) {
  const { NR, NZ, C } = CFD;
  const cr = mode === 'center' ? NR * 0.2 : mode === 'wall' ? NR * 0.8 : NR * 0.25;
  const cz = mode === 'bottom' ? NZ * 0.1 : NZ * 0.85;
  const sigma_r = NR * 0.08;
  const sigma_z = NZ * 0.06;

  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const dr2 = Math.pow((ir - cr) / sigma_r, 2);
      const dz2 = Math.pow((iz - cz) / sigma_z, 2);
      if (dr2 + dz2 < 16) {
        const val = Math.exp(-0.5 * (dr2 + dz2));
        C[cfdIdx(ir, iz)] = Math.min(1, C[cfdIdx(ir, iz)] + val);
      }
    }
  }
}

// ─── Metrics ─────────────────────────────────────────────────
function cfdComputeMetrics(p) {
  const { NR, NZ, C } = CFD;
  // Silindirik koordinat: her hücrenin hacmi r ile orantılı (A_cell ∝ r·dr·dz)
  // Merkez hücreleri (küçük r) daha az hacme sahip — r-ağırlıklı istatistik
  let sumW = 0, sumCW = 0, sumC2W = 0;
  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const r_weight = ir + 0.5; // r/dr → boyutsuz, ağırlık olarak yeterli
      const val = C[iz * NR + ir];
      sumW   += r_weight;
      sumCW  += r_weight * val;
      sumC2W += r_weight * val * val;
    }
  }
  const mean = sumW > 0 ? sumCW / sumW : 0;
  const variance = sumW > 0 ? sumC2W / sumW - mean * mean : 0;
  const cov = mean > 0.001 ? Math.sqrt(Math.max(0, variance)) / mean : (sumCW > 0.001 ? 1.0 : 0);
  const homo = mean > 0.001 ? Math.max(0, Math.min(100, (1 - Math.min(cov, 1)) * 100)) : 0;
  const deadPct = p
    ? (CFD._deadZoneCache ? CFD._deadZoneCache.deadPct : cfdDeadZoneFraction(p))
    : 50;

  // ── Gerçekçi t95 — Turnover Modeli (Nienow 1997) ─────────────
  // Boya gibi viskoz sıvılar için. Grenville t95=5.2/ε^(1/3) sadece
  // Re>10000 (su/solvent) için geçerlidir — boya için hatalı sonuç verir.
  //
  // t95 = N_tur × t_devridaim
  // t_devridaim = V_tank / Q_eff
  // Q_eff = 0.32 × Nq × N × D³   (ölü bölge + kısa devre düzeltmesi)
  // N_tur: Metzner-Otto Re_eff bazlı (Nienow 1997 Tablo 2)
  //
  // Kalibrasyon: T=1.3, H=2.27, D=0.3, 725RPM, visc=0.5 Pa·s → ~45 dk ✓
  let t99_model = null;
  if (p) {
    const N = p.rpm / 60;
    const Nq = _getNq(p.impeller);
    // Metzner-Otto sabitleri pervane tipine göre
    const ks_map = {
      propeller: 10.5, hydrofoil: 10.0, pbtd: 8.7, pbtu: 8.7,
      rushton: 11.5, paddle: 11.0, anchor: 23.0, cowles: 11.5,
    };
    const ks = ks_map[p.impeller] || 10.5;
    const n_flow = p.nonNewt ? (p.nn_n || 0.65) : 0.65; // güç yasası akış endeksi

    // Metzner-Otto efektif viskozite: μ_eff = K × (ks×N)^(n-1)
    const gamma_av = ks * N;
    const K_const = p.visc / Math.pow(Math.max(gamma_av, 0.01), n_flow - 1);
    const mu_eff = K_const * Math.pow(gamma_av, n_flow - 1);
    const Re_eff = p.rho * N * p.D * p.D / Math.max(mu_eff, 1e-6);

    // Pompalama debisi ve efektif sirkülasyon
    const Q_pump = Nq * N * Math.pow(p.D, 3); // m³/s
    const Q_eff = 0.32 * Q_pump; // ölü bölge ve kısa devre düzeltmesi
    const V = Math.PI / 4 * p.T * p.T * p.H;
    const t_devridaim = V / Math.max(Q_eff, 1e-6); // saniye

    // N_tur: Re_eff'e göre (Nienow 1997)
    let N_tur;
    if      (Re_eff < 50)    N_tur = 55;
    else if (Re_eff < 100)   N_tur = 45;
    else if (Re_eff < 300)   N_tur = 30;
    else if (Re_eff < 500)   N_tur = 22;
    else if (Re_eff < 1000)  N_tur = 16;
    else if (Re_eff < 3000)  N_tur = 10;
    else if (Re_eff < 10000) N_tur = 6;
    else                     N_tur = 4;

    // H/T > 1.2 düzeltmesi (Rodgers et al. 2011) — üstel 0.67 (aralık 0.5–0.8)
    const HT = p.H / p.T;
    const HT_factor = HT > 1.2 ? Math.pow(HT / 1.2, 0.67) : 1.0;

    const t95_base = N_tur * t_devridaim * HT_factor; // saniye (t95 tabanı)
    // t99 dönüşümü: t99 = ln(100)/ln(20) × t95 = 1.54 × t95
    // Renk kontrolü için t99 standardı — Grenville & Nienow (2004)
    const T99_MULT = Math.log(100) / Math.log(20); // = 1.537
    t99_model = t95_base * T99_MULT;

    // Corrections objesi — UI açıklama kartı için
    CFD._lastCorrections = {
      N_tur,
      Re_eff: Math.round(Re_eff),
      HT_factor,
      HT,
      t99_mult: T99_MULT,
      t_devridaim,
      turb_factor_deff: 1.0 / (1.0 + 6000.0 / Math.max(p.rho * (p.rpm/60) * p.D * p.D / p.visc, 1.0)),
      Re_bulk: Math.round(p.rho * (p.rpm/60) * p.D * p.D / p.visc),
    };
  }
  return { mean, cov, homo, deadPct, t99_model };
}

// ─── Yüzey Vorteksi (girdab) Derinliği ────────────────────────
// Bafflesiz silindirik tankta dönen sıvıda merkezi yüzey çukurlaşması.
// Kaynaklar:
//   • Nagata (1975) "Mixing: Principles and Applications"
//   • Rieger, Ditl & Novák (1979) "Vortex depth in mixed unbaffled vessels"
//     Chem. Eng. Sci. 34(3): 397–403
//   • Markopoulos & Kontogeorgaki (1995)
//
// Yaklaşık formül (türbülanslı, bafflesiz):
//   h_v ≈ π²·N²·D⁴ / (2g·T²) · k_imp · f_turb
// k_imp: pervane tipi katsayısı  (rushton 1.4, propeller 1.0, anchor 0.2 vb.)
// f_turb = Re / (Re + 2000): viskoz rejimde vortex bastırılır
// Baffle varsa h_v *= 0.10  (4-baffle vortex'i pratik olarak yok eder)
function cfdVortexDepth(p) {
  const g = 9.81;
  const N = p.rpm / 60;
  const Re = p.rho * N * p.D * p.D / Math.max(p.visc, 1e-6);
  const f_turb = Re / (Re + 2000);
  const k_imp = ({
    propeller: 1.0, hydrofoil: 0.85, pbtd: 1.05, pbtu: 1.05,
    rushton: 1.40, paddle: 1.10, cowles: 0.90, anchor: 0.20,
  })[p.impeller] || 1.0;
  let h_v = (Math.PI * Math.PI * N * N * Math.pow(p.D, 4))
          / (2 * g * p.T * p.T) * k_imp * f_turb;
  if (p.baffle) h_v *= 0.10;
  return h_v;
}

// Taşma riski: vortex derinliği üstten boşluğu yiyor mu?
function cfdOverflowStatus(p) {
  const h_v = cfdVortexDepth(p);
  const gap = Math.max(0, (p.Htank || p.H) - p.H);     // mevcut üstten boşluk (m)
  const safety = 0.05;                                  // 5 cm güvenlik payı
  let level, msg;
  if (h_v + safety >= gap) {
    level = 'critical';
    msg = `Vortex derinliği (${(h_v*100).toFixed(0)} cm) üstten boşluğu (${(gap*100).toFixed(0)} cm) aşıyor — TAŞMA RİSKİ`;
  } else if (h_v >= 0.6 * gap) {
    level = 'warn';
    msg = `Vortex (${(h_v*100).toFixed(0)} cm) güvenlik payını yiyor — RPM düşürün veya baffle ekleyin`;
  } else {
    level = 'ok';
    msg = `Vortex ${(h_v*100).toFixed(0)} cm, üstten boşluk ${(gap*100).toFixed(0)} cm — güvenli`;
  }
  return { h_v, gap, safety, level, msg };
}

function cfdSampleProbes(p) {
  const { NR, NZ, C } = CFD;
  return CFD.probes.map(pr => {
    const ir = Math.min(NR - 1, Math.max(0, Math.round(pr.rn * (NR - 1))));
    const iz = Math.min(NZ - 1, Math.max(0, Math.round(pr.zn * (NZ - 1))));
    return C[cfdIdx(ir, iz)];
  });
}

function cfdReset() {
  CFD.C.fill(0);
  CFD.C2.fill(0);
  CFD.step = 0;
  CFD.time = 0;
  CFD.t95 = null;
  CFD.covHistory = [];
  CFD.probeData = [[], [], [], []];
}

// ─── Ampirik Ölü Bölge Modeli ─────────────────────────────────
// Kaynak: Nienow (1997), Paul et al. (2004)
// Re arttıkça ölü bölge azalır — RPM, viskozite, yoğunluk, D hepsi Re üzerinden etkili
function cfdDeadZoneModel(p) {
  const N = p.rpm / 60;
  const Re = p.rho * N * p.D * p.D / p.visc;
  const base = { propeller: 5, hydrofoil: 3, pbtd: 6, pbtu: 6, rushton: 10, paddle: 12, anchor: 45, cowles: 8 };
  const b = base[p.impeller] || 8;
  const b_max = b * 8;
  const Re_c = 500, k = 0.8;
  let dead = b + (b_max - b) / (1 + Math.pow(Re / Re_c, k));
  const DT = p.D / p.T;
  dead *= Math.max(0.3, 1.0 - 0.4 * (DT - 0.33));
  if (p.baffle) dead *= 0.80;
  return Math.min(95, Math.max(1, dead));
}

// ─── Görsel Dead Zone Maskesi ─────────────────────────────────
// Stream function'dan türetilen hız şekline göre boyutsuz eşik
function cfdDeadZoneMask(p) {
  const { NR, NZ, vmag } = CFD;
  const N = p.rpm / 60;
  const vtip = Math.PI * p.D * N;

  // Sabit eşik: 300 rpm referansındaki vtip'in %5'i — RPM'den bağımsız
  // Böylece RPM artar → vmag artar → daha az hücre eşiğin altında → ölü bölge küçülür
  // Nienow (1997): iyi karışım için bulk velocity ≥ ~5% vtip_design
  const vtip_ref = Math.PI * p.D * 5; // 300 rpm referansı (sabit)
  const abs_threshold = 0.05 * vtip_ref;

  const mask = new Uint8Array(NR * NZ);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      // Sınır hücrelerini atla — duvar ve taban no-slip, ölü bölge değil
      if (ir === 0 || ir === NR - 1 || iz === 0 || iz === NZ - 1) continue;
      const i = iz * NR + ir;
      if (vmag[i] < abs_threshold) mask[i] = 1;
    }
  }
  return mask;
}

// ─── Fizik Tabanlı Ölü Bölge Fraksiyonu ───────────────────────
// vmag hız alanından r-ağırlıklı (silindirik hacim) ölü bölge %
// cfdDeadZoneModel(Re-empirik) yerine kullanılır — geometri ve pervane
// konumunu zaten içeren stream function'a dayanır.
function cfdDeadZoneFraction(p) {
  const { NR, NZ, vmag } = CFD;
  if (!vmag || vmag.length === 0) return cfdDeadZoneModel(p);

  const vtip_ref  = Math.PI * p.D * 5; // 300 rpm sabit referans (cfdDeadZoneMask ile aynı)
  const threshold = 0.05 * vtip_ref;

  let deadVol = 0, totalVol = 0;
  for (let iz = 1; iz < NZ - 1; iz++) {
    for (let ir = 1; ir < NR - 1; ir++) {
      const r_w = ir + 0.5; // hacim ∝ r·dr·dz (silindirik)
      totalVol += r_w;
      if (vmag[iz * NR + ir] < threshold) deadVol += r_w;
    }
  }

  if (totalVol === 0) return cfdDeadZoneModel(p);
  return Math.min(95, Math.max(0.5, (deadVol / totalVol) * 100));
}

// ─── 3-Bölge Markov Karışım Analizi ──────────────────────────
// Fakheri & Moghaddas (IJCHE 2012) kompartman modelinden türetilmiş.
// Bölgeler: 0=Aktif (vmag>0.3·vtip), 1=Bulk, 2=Ölü (vmag<eşik)
// Q_ij: hız alanından hesaplanan hacimsel akış hızları (m³/s birimi yok —
//        boyutsuz r-ağırlıklı flüks, relative değer önemli)
// Hız matrisi A → eigendeğerler: λ₁=0, λ₂<0, λ₃<0
// |λ₂|: efektif karışım hızı (küçük = yavaş karışım = büyük ölü bölge etkisi)
function cfdMarkovAnalysis(p) {
  const { NR, NZ, vmag, ur, uz } = CFD;
  if (!vmag || vmag.length === 0 || !ur || !uz) return null;

  const N           = p.rpm / 60;
  const vtip        = Math.PI * p.D * N;
  const vtip_ref    = Math.PI * p.D * 5;
  const threshDead  = 0.05 * vtip_ref;
  const threshAct   = 0.30 * vtip;

  // Bölge ataması ve hacim ağırlıkları
  const zone = new Uint8Array(NR * NZ);
  const vol  = new Float64Array(3);
  for (let iz = 1; iz < NZ - 1; iz++) {
    for (let ir = 1; ir < NR - 1; ir++) {
      const i   = iz * NR + ir;
      const r_w = ir + 0.5;
      const v   = vmag[i];
      const z   = v < threshDead ? 2 : v < threshAct ? 1 : 0;
      zone[i] = z;
      vol[z] += r_w;
    }
  }

  // Simetrik akış flüksü matrisi Q[from][to]
  const Q = [[0,0,0],[0,0,0],[0,0,0]];

  // Radyal ara yüzler (ur)
  for (let iz = 1; iz < NZ - 1; iz++) {
    for (let ir = 1; ir < NR - 2; ir++) {
      const zA = zone[iz * NR + ir], zB = zone[iz * NR + ir + 1];
      if (zA !== zB) {
        const f = Math.abs(ur[iz * NR + ir]) * (ir + 1);
        Q[zA][zB] += f; Q[zB][zA] += f;
      }
    }
  }

  // Eksenel ara yüzler (uz)
  for (let iz = 1; iz < NZ - 2; iz++) {
    for (let ir = 1; ir < NR - 1; ir++) {
      const zA = zone[iz * NR + ir], zB = zone[(iz + 1) * NR + ir];
      if (zA !== zB) {
        const f = Math.abs(uz[iz * NR + ir]) * (ir + 0.5);
        Q[zA][zB] += f; Q[zB][zA] += f;
      }
    }
  }

  // Simetrik S matrisi: S[i][j] = Q[i][j]/sqrt(vol[i]*vol[j])
  // Simetri sayesinde tüm özdeğerler gerçek — disc < 0 riski yok.
  // λ₁=0 sağ özvektörü: [√vol[0], √vol[1], √vol[2]]
  const sqv = [Math.sqrt(Math.max(vol[0],1e-20)), Math.sqrt(Math.max(vol[1],1e-20)), Math.sqrt(Math.max(vol[2],1e-20))];
  const S = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++) {
    let dout = 0;
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      S[i][j] = Q[i][j] / (sqv[i] * sqv[j]);
      dout += Q[i][j];
    }
    S[i][i] = vol[i] > 1e-10 ? -dout / vol[i] : 0;
  }

  // λ(λ²−tr(S)·λ+M₂)=0 — simetrik neg-semidefinite için disc=(λ₂−λ₃)²≥0
  const trA = S[0][0] + S[1][1] + S[2][2];
  const M2  = S[0][0]*S[1][1] - S[0][1]*S[1][0]
            + S[0][0]*S[2][2] - S[0][2]*S[2][0]
            + S[1][1]*S[2][2] - S[1][2]*S[2][1];

  const sq   = Math.sqrt(Math.max(0, trA * trA - 4 * M2));
  const lam2 = (trA + sq) / 2; // daha az negatif — yavaş mod
  const lam3 = (trA - sq) / 2;

  const totalVol = vol[0] + vol[1] + vol[2];
  return {
    lambda2:  lam2,
    lambda3:  lam3,
    exchRate: Math.abs(lam2), // efektif karışım hızı (büyük = iyi)
    zoneVols: [
      totalVol > 0 ? vol[0] / totalVol : 0,
      totalVol > 0 ? vol[1] / totalVol : 0,
      totalVol > 0 ? vol[2] / totalVol : 0,
    ],
  };
}

// ─── Web Worker Handler ────────────────────────────────────────
// Bu dosya hem ana thread'de hem Worker olarak yüklenebilir.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  cfdInit();
  let _lastStepInfo = {};

  self.onmessage = function (e) {
    const { type, p, substeps, mode } = e.data;
    switch (type) {
      case 'build': {
        cfdBuildStreamFunction(p);
        self.postMessage({
          type: 'built',
          psi:       new Float64Array(CFD.psi),
          ur:        new Float64Array(CFD.ur),
          uz:        new Float64Array(CFD.uz),
          vmag:      new Float64Array(CFD.vmag),
          shearRate: new Float64Array(CFD.shearRate),
          deadZone:  CFD._deadZoneCache,
        });
        break;
      }
      case 'step': {
        for (let s = 0; s < substeps; s++) {
          _lastStepInfo = cfdSolveStep(p);
          CFD.time += _lastStepInfo.dt;
          CFD.step++;
        }
        const metrics = cfdComputeMetrics(p);
        let covEntry = null;
        if (metrics.mean > 0.001) {
          covEntry = { t: CFD.time, cov: metrics.cov };
          if (CFD.t95 === null && metrics.cov < 0.01) CFD.t95 = CFD.time;
        }
        const probeVals = cfdSampleProbes(p);
        self.postMessage({
          type:        'result',
          C:           new Float64Array(CFD.C),
          step:        CFD.step,
          time:        CFD.time,
          t95:         CFD.t95,
          stepInfo:    _lastStepInfo,
          metrics,
          probeVals,
          covEntry,
          corrections: CFD._lastCorrections || null,
        });
        break;
      }
      case 'inject': {
        cfdInjectTracer(mode);
        self.postMessage({ type: 'injected', C: new Float64Array(CFD.C) });
        break;
      }
      case 'reset': {
        cfdReset();
        self.postMessage({ type: 'reset_done' });
        break;
      }
    }
  };
}
