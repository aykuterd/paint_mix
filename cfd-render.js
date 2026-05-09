// ============================================================
// CFD RENDERER — Canvas Drawing + UI Updates
// ============================================================

// ─── Color Maps ──────────────────────────────────────────────
const COLOR_MAPS = {
  jet: [
    [0, 0, 80], [0, 0, 180], [0, 80, 255], [0, 180, 255],
    [0, 255, 200], [80, 255, 80], [200, 255, 0],
    [255, 200, 0], [255, 100, 0], [200, 0, 0],
  ],
  viridis: [
    [68, 1, 84], [72, 36, 117], [64, 67, 135], [52, 94, 141],
    [33, 145, 140], [53, 183, 121], [109, 205, 89],
    [180, 222, 44], [253, 231, 37],
  ],
  inferno: [
    [0, 0, 4], [22, 11, 57], [66, 10, 104], [120, 28, 109],
    [165, 44, 96], [207, 68, 70], [237, 105, 37],
    [251, 155, 6], [252, 206, 37], [252, 255, 164],
  ],
};

function cfdValToColor(val, mode, mapName) {
  val = Math.max(0, Math.min(1, val));
  if (mode === 'deadzone') {
    return val < 0.05
      ? `rgba(239,68,68,${0.4 + val * 8})`
      : `rgba(34,211,238,${0.08 + val * 0.45})`;
  }
  if (mode === 'viscosity') {
    // Low visc = blue, high = red
    const colors = [[30, 58, 138], [14, 165, 233], [74, 222, 128], [251, 191, 36], [239, 68, 68]];
    const i = val * (colors.length - 1);
    const lo = Math.floor(i), hi = Math.min(colors.length - 1, lo + 1), t = i - lo;
    const c = colors[lo].map((v, idx) => Math.round(v + t * (colors[hi][idx] - v)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const colors = COLOR_MAPS[mapName] || COLOR_MAPS.jet;
  const i = val * (colors.length - 1);
  const lo = Math.floor(i), hi = Math.min(colors.length - 1, lo + 1), t = i - lo;
  const c = colors[lo].map((v, idx) => Math.round(v + t * (colors[hi][idx] - v)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ─── Side View (r-z cross section) ──────────────────────────
function cfdDrawSideView(canvas, p) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // ── Ayna görünümü: eksen ortada, iki taraf simetrik ──────────
  // Sol yarı: r=T/2 (duvar) → r=0 (eksen), Sağ yarı: r=0 → r=T/2
  // Böylece pervane (eksen üzerinde) tam ortada görünür

  const pad = { top: 25, bottom: 50, left: 30, right: 30 };
  const dW = W - pad.left - pad.right; // toplam genişlik (iki yarı)
  const dH = H - pad.top - pad.bottom; // tankın toplam yüksekliği (Htank)
  const halfW = dW / 2;               // her yarının genişliği
  const cellW = halfW / CFD.NR;       // her yarıdaki hücre genişliği

  // Sıvı dolgusu (Hliq) tankın altında oturur — hücre yüksekliği sıvı bölgesine göre
  const Htank = p.Htank || p.H;
  const liqFrac = Math.max(0.05, Math.min(1, p.H / Htank));
  const dHliq = dH * liqFrac;            // sıvı bölgesinin px yüksekliği
  const cellH = dHliq / CFD.NZ;          // hücreler sadece sıvı bölgesini kaplar
  const liqTopY = pad.top + (dH - dHliq); // sıvı yüzeyi y-koord (üstten)

  const cx = pad.left + halfW;         // merkez x (eksen)

  // Bombe geometrisi — erken hesaplanır, fill hücrelerden ÖNCE çizilir
  const botY    = pad.top + dH;
  const bombePx = Math.min(Math.round(dH * (p.h_bombe || 0) / (p.Htank || 1)), pad.bottom - 6);
  if (bombePx > 0 && p.Vliq > 0) {
    const bombeAlpha = Math.min(0.15, 0.06 + (p.Vliq / (p.V_bombe || 0.001)) * 0.08);
    ctx.fillStyle = `rgba(56,189,248,${bombeAlpha})`;
    ctx.beginPath();
    ctx.moveTo(pad.left, botY);
    ctx.bezierCurveTo(pad.left, botY+bombePx*0.55, cx-dW*0.08, botY+bombePx, cx, botY+bombePx);
    ctx.bezierCurveTo(cx+dW*0.08, botY+bombePx, pad.left+dW, botY+bombePx*0.55, pad.left+dW, botY);
    ctx.closePath();
    ctx.fill();
  }

  let vmax = 0, cmax = 0;
  for (let i = 0; i < CFD.NR * CFD.NZ; i++) {
    if (CFD.vmag[i] > vmax) vmax = CFD.vmag[i];
    if (CFD.C[i]    > cmax) cmax = CFD.C[i];
  }
  vmax = Math.max(vmax, 1e-10);
  cmax = Math.max(cmax, 1e-6);

  // Sabit referans: 300 rpm'deki vtip — RPM arttıkça renk doygunluğu artar
  // Grenville & Nienow (2004): bulk velocity ~ 0.1–0.3 × vtip, impeller zone ~ 0.5–1.0 × vtip
  const vtip_ref = Math.PI * p.D * 5; // 300 rpm @ impeller D
  const gamma_ref = vtip_ref / (p.D * 0.5); // ≈ 31.4 s⁻¹ @ 300 rpm

  // ── Hücreleri çiz: silindirik bölgeye kırp ──────────────────
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, dW, dH);
  ctx.clip();

  for (let iz = 0; iz < CFD.NZ; iz++) {
    for (let ir = 0; ir < CFD.NR; ir++) {
      const idx = cfdIdx(ir, iz);
      let val;
      // Konsantrasyon: anlık Cmax'a göre normalize.
      // Dağıldıkça Cmax mean'e iner, her hücrenin C/Cmax → 1 olur (her yer kırmızı).
      if (CFD.viewMode === 'concentration') val = CFD.C[idx] / cmax;
      else if (CFD.viewMode === 'velocity') val = Math.min(1, CFD.vmag[idx] / vtip_ref);
      else if (CFD.viewMode === 'viscosity') val = Math.min(1, CFD.shearRate[idx] / gamma_ref);
      else val = Math.min(1, CFD.vmag[idx] / vtip_ref); // deadzone background

      const color = cfdValToColor(val, CFD.viewMode, CFD.colorMap);
      const y = liqTopY + (CFD.NZ - 1 - iz) * cellH;
      const cw = Math.ceil(cellW) + 1;
      const ch = Math.ceil(cellH) + 1;

      // Sağ yarı: eksen → duvar (normal)
      const xR = cx + ir * cellW;
      ctx.fillStyle = color;
      ctx.fillRect(xR | 0, y | 0, cw, ch);

      // Sol yarı: eksen → duvar (ayna — sağdan sola)
      const xL = cx - (ir + 1) * cellW;
      ctx.fillRect(xL | 0, y | 0, cw, ch);
    }
  }

  // ── Dead Zone Overlay ────────────────────────────────────────
  if (CFD.viewMode === 'deadzone') {
    const mask = cfdDeadZoneMask(p);
    for (let iz = 0; iz < CFD.NZ; iz++) {
      for (let ir = 0; ir < CFD.NR; ir++) {
        const y = liqTopY + (CFD.NZ - 1 - iz) * cellH;
        const cw = Math.ceil(cellW) + 1;
        const ch = Math.ceil(cellH) + 1;
        let color;
        if (mask[cfdIdx(ir, iz)]) color = 'rgba(239,68,68,0.70)';
        else if (ir > 0 && ir < CFD.NR-1 && iz > 0 && iz < CFD.NZ-1) color = 'rgba(34,211,238,0.35)';
        else continue;
        ctx.fillStyle = color;
        ctx.fillRect((cx + ir * cellW) | 0, y | 0, cw, ch);
        ctx.fillRect((cx - (ir+1) * cellW) | 0, y | 0, cw, ch);
      }
    }
  }

  // ── ψ=0 izokontur — sirkülasyon sınırı (sarı kesik çizgi) ────
  ctx.strokeStyle = 'rgba(250,204,21,0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  for (let iz = 0; iz < CFD.NZ - 1; iz++) {
    for (let ir = 0; ir < CFD.NR - 1; ir++) {
      const v00 = CFD.psi[cfdIdx(ir, iz)];
      const v10 = CFD.psi[cfdIdx(ir+1, iz)];
      const v01 = CFD.psi[cfdIdx(ir, iz+1)];
      const v11 = CFD.psi[cfdIdx(ir+1, iz+1)];
      const pts = [];
      if (v00*v10 < 0) { const t=v00/(v00-v10); pts.push([t, iz, t, iz]); }
      if (v01*v11 < 0) { const t=v01/(v01-v11); pts.push([t, iz+1, t, iz+1]); }
      if (v00*v01 < 0) { const t=v00/(v00-v01); pts.push([ir, iz+t, ir, iz+t]); }
      if (v10*v11 < 0) { const t=v10/(v10-v11); pts.push([ir+1, iz+t, ir+1, iz+t]); }

      // Basit: sadece alt/üst/sol/sağ kenar geçişlerini çiz
      [[v00,v10,ir,iz,ir+1,iz],[v01,v11,ir,iz+1,ir+1,iz+1],
       [v00,v01,ir,iz,ir,iz+1],[v10,v11,ir+1,iz,ir+1,iz+1]].forEach(([a,b,r1,z1,r2,z2])=>{
        if (a*b < 0) {
          const t = a/(a-b);
          const xC = r1+(r2-r1)*t, zC = z1+(z2-z1)*t;
          const px = cx + xC*cellW;
          const py = liqTopY + (CFD.NZ-1-zC)*cellH;
          // Sağ taraf
          ctx.beginPath(); ctx.arc(px, py, 0.5, 0, Math.PI*2); ctx.stroke();
          // Sol taraf (ayna)
          ctx.beginPath(); ctx.arc(cx-(xC*cellW), py, 0.5, 0, Math.PI*2); ctx.stroke();
        }
      });
    }
  }
  ctx.setLineDash([]);

  // ── Hız vektörleri ───────────────────────────────────────────
  if (CFD.viewMode !== 'deadzone') {
    const skip = 6;
    for (let iz = 2; iz < CFD.NZ-2; iz += skip) {
      for (let ir = 1; ir < CFD.NR-1; ir += skip) {
        const idx = cfdIdx(ir, iz);
        const mag = CFD.vmag[idx];
        if (mag < 1e-7) continue;
        const scale = (cellW * skip * 0.4) / vmax;
        const cy_pt = liqTopY + (CFD.NZ-1-iz+0.5)*cellH;
        const alpha = Math.min(0.7, 0.15 + (mag/vmax)*0.55);
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 1;

        // Sağ taraf
        const cxR = cx + (ir+0.5)*cellW;
        const exR = cxR + CFD.ur[idx]*scale;
        const eyR = cy_pt - CFD.uz[idx]*scale;
        ctx.beginPath(); ctx.moveTo(cxR, cy_pt); ctx.lineTo(exR, eyR); ctx.stroke();
        _drawArrow(ctx, cxR, cy_pt, exR, eyR, alpha);

        // Sol taraf (ur 반전 — radyal yön tersine)
        const cxL = cx - (ir+0.5)*cellW;
        const exL = cxL - CFD.ur[idx]*scale;
        ctx.beginPath(); ctx.moveTo(cxL, cy_pt); ctx.lineTo(exL, eyR); ctx.stroke();
        _drawArrow(ctx, cxL, cy_pt, exL, eyR, alpha);
      }
    }
  }

  // Hücre clip bölgesini kapat
  ctx.restore();

  // ── Streamlines ──────────────────────────────────────────────
  if (CFD.showStreamlines && CFD.viewMode !== 'deadzone') {
    _drawStreamlinesMirror(ctx, pad, dW, dH, cellW, cellH, cx, liqTopY);
  }

  // ── Tank sınırı — hücrelerden sonra çizilir (üstte görünür) ──
  ctx.strokeStyle = 'rgba(100,116,139,0.8)'; ctx.lineWidth = 2;
  // Üst kenar
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left + dW, pad.top);
  ctx.stroke();
  // Sol duvar
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, botY);
  ctx.stroke();
  // Sağ duvar
  ctx.beginPath();
  ctx.moveTo(pad.left + dW, pad.top); ctx.lineTo(pad.left + dW, botY);
  ctx.stroke();

  if (p.geometry === 'square') {
    // Kare: düz alt çizgi
    ctx.beginPath();
    ctx.moveTo(pad.left, botY); ctx.lineTo(pad.left + dW, botY);
    ctx.stroke();
    // Merkez eksen (düz alt kadar)
    ctx.strokeStyle = 'rgba(100,116,139,0.35)'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, pad.top); ctx.lineTo(cx, botY); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Silindirik: torispherical bombe eğrisi (mavi kontur)
    ctx.strokeStyle = 'rgba(100,200,255,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad.left, botY);
    ctx.bezierCurveTo(
      pad.left,       botY + bombePx * 0.55,
      cx - dW * 0.08, botY + bombePx,
      cx,             botY + bombePx
    );
    ctx.bezierCurveTo(
      cx + dW * 0.08, botY + bombePx,
      pad.left + dW,  botY + bombePx * 0.55,
      pad.left + dW,  botY
    );
    ctx.stroke();
    // Merkez eksen (bombe altına kadar uzar)
    ctx.strokeStyle = 'rgba(100,116,139,0.35)'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, pad.top); ctx.lineTo(cx, botY + bombePx); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Pervane + Şaft (ortada) ───────────────────────────────────
  // Pervane fiziksel olarak tabandan impH yüksekliğinde — çizimde Htank'a göre konumlanır
  const impY = pad.top + (1 - p.impH / Htank) * dH;
  const impHalfPx = (p.D / 2 / (p.T / 2)) * halfW; // pervane yarı çapı px cinsinden
  // Pervane (turuncu yatay çizgi, ortalı)
  ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - impHalfPx, impY);
  ctx.lineTo(cx + impHalfPx, impY);
  ctx.stroke();
  // Pervane disk
  ctx.beginPath(); ctx.arc(cx, impY, 4, 0, Math.PI*2);
  ctx.fillStyle = '#f97316'; ctx.fill();
  // Şaft (üstten pervaneye)
  ctx.strokeStyle = 'rgba(249,115,22,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, pad.top); ctx.lineTo(cx, impY); ctx.stroke();

  // ── Baffle ───────────────────────────────────────────────────
  if (p.baffle) {
    ctx.strokeStyle = 'rgba(100,200,255,0.4)'; ctx.lineWidth = 2.5;
    // Dört baffle: 90° açılarla — r-z kesitinde sol ve sağ duvarda
    [[pad.left+3],[pad.left+dW-3]].forEach(([bx])=>{
      ctx.beginPath();
      ctx.moveTo(bx, pad.top+dH*0.05);
      ctx.lineTo(bx, pad.top+dH*0.95);
      ctx.stroke();
    });
  }

  // ── Probe noktaları (P1-P4) ───────────────────────────────────
  // Probe'lar sıvı bölgesi içinde tanımlı (zn ∈ [0,1] sıvı taban→yüzey)
  const probeColors = ['#f97316','#3b82f6','#22c55e','#a855f7'];
  CFD.probes.forEach((pr, i) => {
    const px = cx + pr.rn * halfW; // sağ tarafta göster
    const py = liqTopY + (1 - pr.zn) * dHliq;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2);
    ctx.strokeStyle = probeColors[i]; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.fillStyle = probeColors[i]; ctx.font = 'bold 9px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText(`P${i+1}`, px + 8, py + 3);
  });

  // ── Sıvı yüzeyi (çizgi-çizgi hatched) ─────────────────────────
  // Sıvı seviyesi tankın belirli bir yüksekliğinde — pervaneden bağımsız
  ctx.strokeStyle = 'rgba(34,211,238,0.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.left, liqTopY);
  ctx.lineTo(pad.left + dW, liqTopY);
  ctx.stroke();
  ctx.setLineDash([]);
  // Yüzey üstü hafif tarama (üstten boşluk)
  if (liqTopY > pad.top + 1) {
    ctx.strokeStyle = 'rgba(34,211,238,0.18)';
    ctx.lineWidth = 0.5;
    for (let x = pad.left - dH; x < pad.left + dW; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x + (liqTopY - pad.top), liqTopY);
      ctx.stroke();
    }
  }

  // ── Eksen etiketleri ─────────────────────────────────────────
  ctx.fillStyle = '#94a3b8'; ctx.font = '9px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.fillText('duvar', pad.left + 20, H - 6);
  ctx.fillText('merkez', cx, H - 6);
  ctx.fillText('duvar', pad.left + dW - 20, H - 6);
  ctx.textAlign = 'right';
  ctx.fillText('H_t', pad.left - 4, pad.top + 10);
  ctx.fillText('0', pad.left - 4, pad.top + dH);
  ctx.fillStyle = '#22d3ee'; ctx.textAlign = 'left';
  ctx.fillText('▼ Sıvı Seviyesi (H_l=' + p.H.toFixed(2) + 'm)', pad.left + 4, liqTopY - 3);
  ctx.fillStyle = '#64748b'; ctx.textAlign = 'right';
  ctx.fillText('Tank H=' + Htank.toFixed(2) + 'm', pad.left + dW - 4, pad.top + 10);
  if (p.geometry === 'square') {
    ctx.fillStyle = '#f59e0b'; ctx.textAlign = 'left';
    ctx.fillText(
      'W\xD7L=' + (p.W||0).toFixed(1) + '\xD7' + (p.L||0).toFixed(1) + 'm  T_eq=' + p.T.toFixed(2) + 'm',
      pad.left + 4, pad.top + dH + 12
    );
  }
}

function _drawArrow(ctx, x1, y1, x2, y2, alpha) {
  const angle = Math.atan2(y2-y1, x2-x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 3.5*Math.cos(angle-0.45), y2 - 3.5*Math.sin(angle-0.45));
  ctx.lineTo(x2 - 3.5*Math.cos(angle+0.45), y2 - 3.5*Math.sin(angle+0.45));
  ctx.closePath();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fill();
}

function _drawStreamlinesMirror(ctx, pad, dW, dH, cellW, cellH, cx, liqTopY) {
  const { NR, NZ, psi } = CFD;
  const yBase = (typeof liqTopY === 'number') ? liqTopY : pad.top;
  let pmin = Infinity, pmax = -Infinity;
  for (let i = 0; i < NR*NZ; i++) { if(psi[i]<pmin)pmin=psi[i]; if(psi[i]>pmax)pmax=psi[i]; }
  const range = pmax - pmin;
  if (range < 1e-12) return;
  const nLevels = 12;
  ctx.lineWidth = 0.8;
  for (let lev = 1; lev < nLevels; lev++) {
    const target = pmin + (lev/nLevels)*range;
    ctx.strokeStyle = `rgba(255,255,255,${lev===Math.floor(nLevels/2)?0.25:0.10})`;
    for (let iz = 0; iz < NZ-1; iz++) {
      for (let ir = 0; ir < NR-1; ir++) {
        const v00=psi[cfdIdx(ir,iz)]-target, v10=psi[cfdIdx(ir+1,iz)]-target;
        const v01=psi[cfdIdx(ir,iz+1)]-target, v11=psi[cfdIdx(ir+1,iz+1)]-target;
        const pts=[];
        if(v00*v10<0){const t=v00/(v00-v10);pts.push([cx+(ir+t)*cellW, yBase+(NZ-1-iz)*cellH]);}
        if(v01*v11<0){const t=v01/(v01-v11);pts.push([cx+(ir+t)*cellW, yBase+(NZ-2-iz)*cellH]);}
        if(v00*v01<0){const t=v00/(v00-v01);pts.push([cx+ir*cellW, yBase+(NZ-1-iz-t)*cellH]);}
        if(v10*v11<0){const t=v10/(v10-v11);pts.push([cx+(ir+1)*cellW, yBase+(NZ-1-iz-t)*cellH]);}
        if(pts.length>=2){
          // Sağ taraf
          ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); ctx.lineTo(pts[1][0],pts[1][1]); ctx.stroke();
          // Sol taraf (ayna)
          ctx.beginPath();
          ctx.moveTo(2*cx-pts[0][0],pts[0][1]);
          ctx.lineTo(2*cx-pts[1][0],pts[1][1]);
          ctx.stroke();
        }
      }
    }
  }
}

function _drawStreamlines(ctx, pad, dW, dH, cellW, cellH) {
  const { NR, NZ, psi } = CFD;
  // Find ψ range
  let pmin = Infinity, pmax = -Infinity;
  for (let i = 0; i < NR * NZ; i++) {
    if (psi[i] < pmin) pmin = psi[i];
    if (psi[i] > pmax) pmax = psi[i];
  }
  const range = pmax - pmin;
  if (range < 1e-12) return;

  // Draw contour lines at fixed ψ levels
  const nLevels = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 0.8;

  for (let lev = 1; lev < nLevels; lev++) {
    const target = pmin + (lev / nLevels) * range;
    // Simple marching: scan rows for sign changes
    for (let iz = 0; iz < NZ - 1; iz++) {
      for (let ir = 0; ir < NR - 1; ir++) {
        const v00 = psi[cfdIdx(ir, iz)] - target;
        const v10 = psi[cfdIdx(ir + 1, iz)] - target;
        const v01 = psi[cfdIdx(ir, iz + 1)] - target;
        const v11 = psi[cfdIdx(ir + 1, iz + 1)] - target;

        const pts = [];
        // Bottom edge
        if (v00 * v10 < 0) {
          const t = v00 / (v00 - v10);
          pts.push([pad.left + (ir + t) * cellW, pad.top + (NZ - 1 - iz) * cellH]);
        }
        // Top edge
        if (v01 * v11 < 0) {
          const t = v01 / (v01 - v11);
          pts.push([pad.left + (ir + t) * cellW, pad.top + (NZ - 2 - iz) * cellH]);
        }
        // Left edge
        if (v00 * v01 < 0) {
          const t = v00 / (v00 - v01);
          pts.push([pad.left + ir * cellW, pad.top + (NZ - 1 - iz - t) * cellH]);
        }
        // Right edge
        if (v10 * v11 < 0) {
          const t = v10 / (v10 - v11);
          pts.push([pad.left + (ir + 1) * cellW, pad.top + (NZ - 1 - iz - t) * cellH]);
        }

        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.stroke();
        }
      }
    }
  }
}

// ─── Top View (polar projection from axisymmetric data) ─────
function cfdDrawTopView(canvas, p) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;

  const iz_imp = Math.min(CFD.NZ - 1, Math.max(0, Math.round((p.impH / p.H) * (CFD.NZ - 1))));
  let vmax = 0, cmax = 0;
  for (let i = 0; i < CFD.NR * CFD.NZ; i++) {
    if (CFD.vmag[i] > vmax) vmax = CFD.vmag[i];
    if (CFD.C[i]    > cmax) cmax = CFD.C[i];
  }
  vmax = Math.max(vmax, 1e-10);
  cmax = Math.max(cmax, 1e-6);

  const vtip_ref = Math.PI * p.D * 5; // 300 rpm sabit referans
  const gamma_ref = vtip_ref / (p.D * 0.5);

  const nBlades = p.impeller === 'rushton' ? 6 : p.impeller === 'anchor' ? 2 : 4;
  const rot = (CFD.time * p.rpm / 60 * 2 * Math.PI) % (2 * Math.PI);

  if (p.geometry === 'square') {
    const wVal = p.W || 1, lVal = p.L || p.W || 1;
    const aspect = lVal / wVal;
    const maxHalfW = Math.min((W - 40) / 2, (H - 40) / (2 * aspect));
    const maxHalfH = maxHalfW * aspect;

    // Concentric rectangles outside-in (outer fill, inner overwrites → ring effect)
    for (let ir = CFD.NR - 1; ir >= 0; ir--) {
      const idx = cfdIdx(ir, iz_imp);
      let val;
      if (CFD.viewMode === 'concentration') val = CFD.C[idx] / cmax;
      else if (CFD.viewMode === 'viscosity') val = Math.min(1, CFD.shearRate[idx] / gamma_ref);
      else val = Math.min(1, CFD.vmag[idx] / vtip_ref); // velocity + deadzone background
      ctx.fillStyle = cfdValToColor(val, CFD.viewMode, CFD.colorMap);
      const f = (ir + 1) / CFD.NR;
      ctx.fillRect(cx - f * maxHalfW, cy - f * maxHalfH, f * maxHalfW * 2, f * maxHalfH * 2);
    }

    // Dead zone overlay (kare) — ring başına evenodd clip ile çiz
    if (CFD.viewMode === 'deadzone') {
      const mask = cfdDeadZoneMask(p);
      for (let ir = 0; ir < CFD.NR; ir++) {
        if (!mask[cfdIdx(ir, iz_imp)]) continue;
        const f  = (ir + 1) / CFD.NR;
        const fi = ir / CFD.NR;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - f * maxHalfW, cy - f * maxHalfH, f * maxHalfW * 2, f * maxHalfH * 2);
        if (fi > 0) ctx.rect(cx - fi * maxHalfW, cy - fi * maxHalfH, fi * maxHalfW * 2, fi * maxHalfH * 2);
        ctx.clip('evenodd');
        ctx.fillStyle = 'rgba(239,68,68,0.65)';
        ctx.fillRect(cx - f * maxHalfW, cy - f * maxHalfH, f * maxHalfW * 2, f * maxHalfH * 2);
        ctx.restore();
      }
    }

    // Tank wall
    ctx.strokeStyle = 'rgba(100,116,139,0.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(cx - maxHalfW, cy - maxHalfH, maxHalfW * 2, maxHalfH * 2);

    // Impeller blades
    const impR = (p.D / 2 / (p.T / 2)) * maxHalfW;
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
    for (let b = 0; b < nBlades; b++) {
      const angle = rot + (b * 2 * Math.PI) / nBlades;
      ctx.beginPath();
      ctx.moveTo(cx + 5 * Math.cos(angle), cy + 5 * Math.sin(angle));
      ctx.lineTo(cx + impR * Math.cos(angle), cy + impR * Math.sin(angle));
      ctx.stroke();
    }

    // Shaft center
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316'; ctx.fill();

    // Baffles: marks at midpoints of each wall side
    if (p.baffle) {
      ctx.strokeStyle = 'rgba(100,200,255,0.4)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy - maxHalfH + 8); ctx.lineTo(cx, cy - maxHalfH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + maxHalfH - 8); ctx.lineTo(cx, cy + maxHalfH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - maxHalfW + 8, cy); ctx.lineTo(cx - maxHalfW, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + maxHalfW - 8, cy); ctx.lineTo(cx + maxHalfW, cy); ctx.stroke();
    }

    ctx.fillStyle = '#94a3b8'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText('ÜSTTEN BAKIŞ (z=pervane)  W\xD7L=' + wVal.toFixed(1) + '\xD7' + lVal.toFixed(1) + 'm', cx, H - 4);

  } else {
    const maxR = Math.min(W, H) / 2 - 20;
    const nTheta = 72;
    const dTheta = (2 * Math.PI) / nTheta;

    for (let ir = 0; ir < CFD.NR; ir++) {
      const r1 = (ir / CFD.NR) * maxR;
      const r2 = ((ir + 1) / CFD.NR) * maxR;
      const idx = cfdIdx(ir, iz_imp);

      let val;
      if (CFD.viewMode === 'concentration') val = CFD.C[idx] / cmax;
      else if (CFD.viewMode === 'viscosity') val = Math.min(1, CFD.shearRate[idx] / gamma_ref);
      else val = Math.min(1, CFD.vmag[idx] / vtip_ref); // velocity + deadzone background

      ctx.fillStyle = cfdValToColor(val, CFD.viewMode, CFD.colorMap);

      for (let it = 0; it < nTheta; it++) {
        const a1 = it * dTheta;
        const a2 = (it + 1) * dTheta;
        ctx.beginPath();
        ctx.moveTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
        ctx.arc(cx, cy, r2, a1, a2);
        ctx.arc(cx, cy, r1, a2, a1, true);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Dead zone overlay (silindirik)
    if (CFD.viewMode === 'deadzone') {
      const mask = cfdDeadZoneMask(p);
      for (let ir = 0; ir < CFD.NR; ir++) {
        if (!mask[cfdIdx(ir, iz_imp)]) continue;
        const r1 = (ir / CFD.NR) * maxR;
        const r2 = ((ir + 1) / CFD.NR) * maxR;
        for (let it = 0; it < nTheta; it++) {
          const a1 = it * dTheta;
          const a2 = (it + 1) * dTheta;
          ctx.fillStyle = 'rgba(239,68,68,0.65)';
          ctx.beginPath();
          ctx.moveTo(cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1));
          ctx.arc(cx, cy, r2, a1, a2);
          ctx.arc(cx, cy, r1, a2, a1, true);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Tank wall
    ctx.strokeStyle = 'rgba(100,116,139,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.stroke();

    // Impeller blades
    const impR = (p.D / 2 / (p.T / 2)) * maxR;
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3;
    for (let b = 0; b < nBlades; b++) {
      const angle = rot + (b * 2 * Math.PI) / nBlades;
      ctx.beginPath();
      ctx.moveTo(cx + 5 * Math.cos(angle), cy + 5 * Math.sin(angle));
      ctx.lineTo(cx + impR * Math.cos(angle), cy + impR * Math.sin(angle));
      ctx.stroke();
    }

    // Shaft center
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316'; ctx.fill();

    // Baffle positions
    if (p.baffle) {
      ctx.strokeStyle = 'rgba(100,200,255,0.4)'; ctx.lineWidth = 3;
      for (let b = 0; b < 4; b++) {
        const angle = (b * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(cx + (maxR - 8) * Math.cos(angle), cy + (maxR - 8) * Math.sin(angle));
        ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#94a3b8'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText('ÜSTTEN BAKIŞ (z = pervane)', cx, H - 4);
  }
}

// ─── CoV-Time Graph ─────────────────────────────────────────
function cfdDrawCovGraph(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad = { top: 15, bottom: 25, left: 45, right: 15 };
  const dW = W - pad.left - pad.right;
  const dH = H - pad.top - pad.bottom;
  const hist = CFD.covHistory;
  if (hist.length < 2) {
    ctx.fillStyle = '#334155'; ctx.font = '11px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText('Tracer enjekte edip simülasyonu başlatın...', W / 2, H / 2);
    return;
  }

  const maxT = Math.max(hist[hist.length - 1].t, 1);
  const xS = t => pad.left + (t / maxT) * dW;
  const yS = v => pad.top + (1 - v) * dH;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * dH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + dW, y); ctx.stroke();
  }

  // CoV = 0.05 target line
  const ty = yS(0.05);
  ctx.strokeStyle = 'rgba(34,197,94,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.left, ty); ctx.lineTo(pad.left + dW, ty); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#4ade80'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'left';
  ctx.fillText('CoV=0.05 (t₉₅)', pad.left + 4, ty - 4);

  // CoV curve
  ctx.beginPath(); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
  hist.forEach((h, i) => {
    const x = xS(h.t), y = yS(Math.min(1, h.cov));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under
  ctx.beginPath();
  hist.forEach((h, i) => {
    const x = xS(h.t), y = yS(Math.min(1, h.cov));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xS(hist[hist.length - 1].t), pad.top + dH);
  ctx.lineTo(pad.left, pad.top + dH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + dH);
  grad.addColorStop(0, 'rgba(34,211,238,0.15)'); grad.addColorStop(1, 'rgba(34,211,238,0)');
  ctx.fillStyle = grad; ctx.fill();

  // Probe curves
  const probeColors = ['#f97316', '#3b82f6', '#22c55e', '#a855f7'];
  CFD.probeData.forEach((pd, pi) => {
    if (pd.length < 2) return;
    ctx.beginPath(); ctx.strokeStyle = probeColors[pi]; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
    pd.forEach((h, i) => {
      const x = xS(h.t), y = yS(Math.min(1, h.v));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  });

  // t95 marker
  if (CFD.t95 !== null) {
    const tx = xS(CFD.t95);
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(tx, pad.top); ctx.lineTo(tx, pad.top + dH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 9px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText(`t₉₅ = ${CFD.t95.toFixed(1)}s`, tx, pad.top - 3);
  }

  // Axes
  ctx.fillStyle = '#94a3b8'; ctx.font = '8px JetBrains Mono';
  ctx.textAlign = 'right';
  ctx.fillText('1.0', pad.left - 4, pad.top + 4);
  ctx.fillText('0.5', pad.left - 4, pad.top + dH / 2 + 3);
  ctx.fillText('0', pad.left - 4, pad.top + dH + 3);
  ctx.textAlign = 'center';
  ctx.fillText('0s', pad.left, H - 3);
  ctx.fillText(`${maxT.toFixed(0)}s`, pad.left + dW, H - 3);
  ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 8px JetBrains Mono';
  ctx.fillText('CoV / Konsantrasyon vs Zaman', pad.left + dW / 2, H - 2);
}

// ─── Velocity Profile ────────────────────────────────────────
function cfdDrawVelProfile(canvas, p) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#070c1a';
  ctx.fillRect(0, 0, W, H);

  const pad = { top: 36, bottom: 42, left: 70, right: 24 };
  const dW = W - pad.left - pad.right, dH = H - pad.top - pad.bottom;

  const iz_imp = Math.round((p.impH / p.H) * (CFD.NZ - 1));
  const ur_vals = [], uz_vals = [];
  for (let ir = 0; ir < CFD.NR; ir++) {
    const idx = cfdIdx(ir, Math.min(iz_imp, CFD.NZ - 1));
    ur_vals.push(CFD.ur[idx]);
    uz_vals.push(CFD.uz[idx]);
  }

  const vmax = Math.max(...[...ur_vals, ...uz_vals].map(Math.abs), 1e-8);
  const xS = ir => pad.left + (ir / (CFD.NR - 1)) * dW;
  const yS = v  => pad.top + dH / 2 - (v / vmax) * (dH / 2 * 0.88);
  const yZero = pad.top + dH / 2;

  // Grid yatay çizgiler (25%, 50%, 75% seviyeleri)
  [0.5, -0.5, 1, -1].forEach(frac => {
    const yy = yZero - frac * (dH / 2 * 0.88);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(pad.left + dW, yy); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Grid dikey çizgiler (T/4 ve T/2)
  [0.25, 0.5, 0.75].forEach(frac => {
    const xx = pad.left + frac * dW;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(xx, pad.top); ctx.lineTo(xx, pad.top + dH); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Sıfır çizgisi
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(pad.left, yZero); ctx.lineTo(pad.left + dW, yZero); ctx.stroke();

  // uz alanı dolgusu
  ctx.beginPath();
  uz_vals.forEach((v, ir) => ir === 0 ? ctx.moveTo(xS(ir), yS(v)) : ctx.lineTo(xS(ir), yS(v)));
  ctx.lineTo(xS(CFD.NR - 1), yZero);
  ctx.lineTo(xS(0), yZero);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,211,238,0.08)';
  ctx.fill();

  // uz eğrisi
  ctx.beginPath(); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5;
  uz_vals.forEach((v, ir) => ir === 0 ? ctx.moveTo(xS(ir), yS(v)) : ctx.lineTo(xS(ir), yS(v)));
  ctx.stroke();

  // ur alanı dolgusu
  ctx.beginPath();
  ur_vals.forEach((v, ir) => ir === 0 ? ctx.moveTo(xS(ir), yS(v)) : ctx.lineTo(xS(ir), yS(v)));
  ctx.lineTo(xS(CFD.NR - 1), yZero);
  ctx.lineTo(xS(0), yZero);
  ctx.closePath();
  ctx.fillStyle = 'rgba(249,115,22,0.07)';
  ctx.fill();

  // ur eğrisi
  ctx.beginPath(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]);
  ur_vals.forEach((v, ir) => ir === 0 ? ctx.moveTo(xS(ir), yS(v)) : ctx.lineTo(xS(ir), yS(v)));
  ctx.stroke(); ctx.setLineDash([]);

  // Çerçeve
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, dW, dH);

  // Y ekseni etiketleri
  ctx.font = 'bold 12px JetBrains Mono'; ctx.textAlign = 'right';
  const yLabels = [
    { frac:  1,   label: `+${vmax.toFixed(2)}`, color: '#94a3b8' },
    { frac:  0.5, label: `+${(vmax*0.5).toFixed(2)}`, color: '#64748b' },
    { frac:  0,   label: '0', color: '#e2e8f0' },
    { frac: -0.5, label: `−${(vmax*0.5).toFixed(2)}`, color: '#64748b' },
    { frac: -1,   label: `−${vmax.toFixed(2)}`, color: '#94a3b8' },
  ];
  yLabels.forEach(({ frac, label, color }) => {
    const yy = yZero - frac * (dH / 2 * 0.88);
    ctx.fillStyle = color;
    ctx.fillText(label, pad.left - 8, yy + 4);
  });

  // Y ekseni başlık
  ctx.save();
  ctx.translate(14, pad.top + dH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = 'bold 12px JetBrains Mono';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'center';
  ctx.fillText('Hız (m/s)', 0, 0);
  ctx.restore();

  // X ekseni etiketleri
  ctx.font = 'bold 12px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillStyle = '#94a3b8';
  ctx.fillText('r = 0', pad.left, H - 6);
  ctx.fillText('T/4', pad.left + dW * 0.25, H - 6);
  ctx.fillText('T/2', pad.left + dW * 0.5, H - 6);
  ctx.fillText('3T/4', pad.left + dW * 0.75, H - 6);
  ctx.fillText('r = T/2 (duvar)', pad.left + dW, H - 6);

  // X ekseni alt başlık
  ctx.font = '11px JetBrains Mono'; ctx.fillStyle = '#475569';
  ctx.fillText('← Merkez (eksen)                                           Duvar →', pad.left + dW / 2, H - 24);

  // Başlık
  ctx.font = 'bold 13px JetBrains Mono'; ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'left';
  ctx.fillText('Pervane Yüksekliği: ' + (p.impH !== undefined ? p.impH.toFixed(2) + ' m' : '-- m'), pad.left + 4, 20);

  // Sağ üst — vmax kutusu
  const vmaxLabel = `vmax = ${vmax.toFixed(3)} m/s`;
  ctx.font = 'bold 12px JetBrains Mono';
  const lw = ctx.measureText(vmaxLabel).width + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(pad.left + dW - lw, 6, lw, 22);
  ctx.fillStyle = '#fbbf24';
  ctx.textAlign = 'right';
  ctx.fillText(vmaxLabel, pad.left + dW - 8, 21);
}
