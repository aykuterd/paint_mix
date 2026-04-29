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
  // Amplitüd: A = Q — stream function boyutu m³/s, vmag makul m/s değerlerinde
  const A = Q;

  const dr = R / NR;
  const dz = H / NZ;
  const z_imp = p.impH;

  for (let iz = 0; iz < NZ; iz++) {
    for (let ir = 0; ir < NR; ir++) {
      const r = (ir + 0.5) * dr;
      const z = (iz + 0.5) * dz;
      const rn = r / R;
      const idx = cfdIdx(ir, iz);

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
        // Wall-dominated flow
        const wall_fr = Math.pow(rn, 3) * Math.pow(1 - rn, 0.3);
        const zn = z / H;
        psi = A * 0.4 * wall_fr * Math.sin(Math.PI * zn);

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
    propeller: 0.50, hydrofoil: 0.55, paddle: 0.35,
    rushton: 0.72, anchor: 0.05, pbtu: 0.45,
    pbtd: 0.50, cowles: 0.30,
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
  // Türbülanslı viskozite: ν_t = 0.01 * vtip * D  (Nienow & Miles 1978)
  // Skaler difüzivite: D_turb = ν_t / Sc_t, Sc_t=0.7
  // Faktör: Re>1000'de tam etkili
  const turb_factor = Math.min(1.0, Re / 1000);
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
  const n = NR * NZ;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) { sum += C[i]; sum2 += C[i] * C[i]; }
  const mean = sum / n;
  const variance = sum2 / n - mean * mean;
  const cov = mean > 0.001 ? Math.sqrt(Math.max(0, variance)) / mean : (sum > 0.001 ? 1.0 : 0);
  const homo = mean > 0.001 ? Math.max(0, Math.min(100, (1 - Math.min(cov, 1)) * 100)) : 0;
  const deadPct = p ? cfdDeadZoneModel(p) : 50;

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
  let t95_model = null;
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

    // H/T > 1.2 düzeltmesi (Rodgers et al. 2011)
    const HT = p.H / p.T;
    const HT_factor = HT > 1.2 ? Math.pow(HT, 1.0) : 1.0;

    t95_model = N_tur * t_devridaim * HT_factor; // saniye
  }
  return { mean, cov, homo, deadPct, t95_grenville: t95_model };
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

  // Mutlak eşik: vtip'in %5'i [m/s] — pervane tipine bağımsız, boyutsal
  // Sınır hücreleri (no-slip duvar) hariç — bunlar her zaman sıfır, ölü bölge değil
  const abs_threshold = 0.02 * vtip;

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
