import React, { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

const GOOGLE_API_KEY  = "AIzaSyDQ6fgoFNQBqMdu6gOwp1Eaz_mO45Rn8WM";
const DRIVE_PROXY_URL = "https://script.google.com/macros/s/AKfycbwX-g48ltzrCQAF6LdHX0kvycOrZEQGZUtlWYXbuDuYGJU8rktKncKxlcgbazCOx9zJ/exec";

const TOOLS = [
  { id: "fleet",  icon: "✈",  label: "Filo",          labelEn: "Fleet",           color: "#38bdf8" },
  { id: "amp",    icon: "⚙️", label: "AMP Analizi",   labelEn: "AMP Analysis",    color: "#f59e0b" },
  { id: "ad",     icon: "📋", label: "AD Takibi",     labelEn: "AD Tracking",     color: "#06b6d4" },
  { id: "doc",    icon: "📖", label: "AMM/SRM Bot",   labelEn: "Doc Q&A",         color: "#10b981" },
  { id: "defect", icon: "⚠️", label: "Arıza Analizi", labelEn: "Defect Analysis", color: "#ef4444" },
  { id: "llp",    icon: "🔩", label: "LLP Takibi",    labelEn: "LLP Tracker",     color: "#a78bfa" },
];

const buildSystemPrompt = (toolId, aircraft, fileCtx) => {
  const ac = aircraft ? `\n\nAKTİF UÇAK:\n- Tescil: ${aircraft.registration}\n- Tip: ${aircraft.type}\n- MSN: ${aircraft.msn}\n- TSH: ${aircraft.tsh} saat | Siklus: ${aircraft.cycles}\n- Motor 1: ${aircraft.eng1model||"—"} | TSN: ${aircraft.eng1tsn||"—"} | TSO: ${aircraft.eng1tso||"—"}\n- Motor 2: ${aircraft.eng2model||"—"} | TSN: ${aircraft.eng2tsn||"—"} | TSO: ${aircraft.eng2tso||"—"}\n- Pervane: ${aircraft.propModel||"—"} | TSN: ${aircraft.propTSN||"—"} | TSO: ${aircraft.propTSO||"—"}` : "";
  const doc = fileCtx ? `\n\nYÜKLENEN DOKÜMAN (${fileCtx.name}):\n---\n${fileCtx.content}\n---\nBu dokümana göre analiz yap ve cevap ver.` : "";
  const bases = {
    amp:    "Sen EASA Part-M/CAME kapsamında AMP analizi konusunda uzman bir CAMO mühendisisin. Bakım görevleri, aralıklar, MPD kalemleri ve AMP uyumluluğu konularında yardım et.",
    ad:     "Sen EASA/FAA/TCAA kapsamında AD uyumluluğu konusunda uzman bir uçuşa elverişlilik mühendisisin. AD uygulanabilirliği, uyum durumu, sonlandırıcı/tekrarlayan eylemler konularında yardım et.",
    doc:    "Sen AMM, SRM, CMM ve diğer teknik dokümantasyon konusunda derin bilgiye sahip bir uçak bakım mühendisisin. Teknisyenlere prosedür bulmada, teknik veriyi yorumlamada yardım et.",
    defect: "Sen arıza yönetimi, MEL/CDL uygulamaları ve güvenilirlik analizi konusunda uzman bir CAMO mühendisisin. Arızaları analiz et, düzeltici eylemler öner, uçuşa elverişlilik etkisini değerlendir.",
    llp:    "Sen EASA yönetmelikleri kapsamında LLP yönetimi konusunda uzman bir CAMO mühendisisin. Parça siklus/saat takibi, değişim planlaması, mevzuat uyumluluğu konularında yardım et.",
  };
  return (bases[toolId]||"") + " Kullanıcının yazdığı dilde (Türkçe veya İngilizce) cevap ver." + ac + doc;
};

const PLACEHOLDERS = {
  amp:    "AMP görev aralığı, MPD item analizi veya bakım programı sorusu...",
  ad:     "AD numarası, uygulanabilirlik veya uyum durumu sorusu...",
  doc:    "AMM bölümü, SRM prosedürü veya teknik doküman sorusu...",
  defect: "Arıza kodu veya defect tanımını girin, analiz edelim...",
  llp:    "LLP part numarası, kalan ömür veya replacement planning sorusu...",
};

const EMPTY_AC = { id:"",registration:"",type:"",msn:"",tsh:"",cycles:"",eng1model:"",eng1tsn:"",eng1tso:"",eng2model:"",eng2tsn:"",eng2tso:"",propModel:"",propTSN:"",propTSO:"", files:{} };
const genId = () => "ac_" + Date.now();

function Field({ label, value, onChange, placeholder="", half=false }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"4px", flex:half?"0 0 calc(50% - 6px)":"1 1 100%" }}>
      <label style={{ fontSize:"9px", color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em" }}>{label}</label>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", padding:"8px 10px", color:"#e5e7eb", fontSize:"13px", fontFamily:"'DM Sans',sans-serif", outline:"none", width:"100%" }} />
    </div>
  );
}

// ─── Fleet Panel ──────────────────────────────────────────────────────────────
function FleetPanel({ fleet, setFleet, selectedAcId, setSelectedAcId }) {
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(EMPTY_AC);
  const [saved, setSaved]           = useState(false);
  const [llpFilling, setLlpFilling] = useState(false);
  const [folderInput, setFolderInput] = useState("1NUFBJZOp3-CtWkEdZWg7vuGOsHTJUgrp");
  const [driveFiles, setDriveFiles]   = useState([]);   // tüm drive dosyaları
  const [scanning, setScanning]       = useState(false);
  const [scanError, setScanError]     = useState(null);
  const [showDrive, setShowDrive]     = useState(false);

  // storage'dan klasör ID'yi yükle
  useEffect(()=>{
    (async()=>{
      try { const v=localStorage.getItem("camo_folder_id"); if(v) setFolderInput(v); } catch {}
    })();
  },[]);

  // JSONP - CORS sorununu aşar
  const fetchJSONP = (url) => new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now();
    const script = document.createElement("script");
    script.src = url + "&callback=" + cb;
    window[cb] = (data) => { delete window[cb]; document.head.removeChild(script); resolve(data); };
    script.onerror = () => { delete window[cb]; reject(new Error("Script yüklenemedi")); };
    document.head.appendChild(script);
    setTimeout(() => { delete window[cb]; reject(new Error("Zaman aşımı")); }, 15000);
  });

  const scanFolder = async () => {
    setScanning(true); setScanError(null); setDriveFiles([]);
    try {
      const data = await fetchJSONP(`${DRIVE_PROXY_URL}?action=list`);
      if (data.error) throw new Error(data.error);
      setDriveFiles(data.files || []);
      if ((data.files||[]).length === 0) setScanError("Klasörde dosya bulunamadı.");
    } catch(e) {
      setScanError("Hata: " + e.message);
    }
    setScanning(false);
  };

  const fetchDriveFile = async (file) => {
    try {
      const data = await fetchJSONP(`${DRIVE_PROXY_URL}?action=read&fileId=${file.id}`);
      if (data.error) throw new Error(data.error);
      return { name: data.name, content: data.content };
    } catch(e) {
      return { name: file.name, content: `[Okuma hatası: ${e.message}]` };
    }
  };

  // Dosyayı uçak+araç'a ata
  const assignFile = async (driveFile, acId, toolId) => {
    const fileData = await fetchDriveFile(driveFile);
    const updated = fleet.map(a => a.id===acId
      ? {...a, files:{...(a.files||{}), [toolId]: fileData}}
      : a);
    setFleet(updated);
    try { localStorage.setItem("camo_fleet", JSON.stringify(updated)); } catch(e) {}
  };

  const iconFor = m => m?.includes("spreadsheet")||m?.includes("xlsx")?"📊":m?.includes("document")?"📝":m?.includes("pdf")?"📄":m?.includes("folder")?"📁":"📎";

  const fillFromLLP = async () => {
    const ac = fleet.find(a => a.id === editing || (!editing && a.id === form.id));
    const llpFile = ac?.files?.llp;
    if (!llpFile) return;
    setLlpFilling(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 500,
          messages: [{ role: "user", content:
            `Bu LLP/bakım listesinden aşağıdaki uçak verilerini çıkar. Sadece JSON döndür, başka hiçbir şey yazma:\n{\n  "tsh": "toplam uçuş saati (sadece sayı)",\n  "cycles": "toplam siklus (sadece sayı)",\n  "eng1model": "motor 1 modeli",\n  "eng1tsn": "motor 1 TSN (sadece sayı)",\n  "eng1tso": "motor 1 TSO (sadece sayı)",\n  "eng2model": "motor 2 modeli veya boş",\n  "eng2tsn": "motor 2 TSN veya boş",\n  "eng2tso": "motor 2 TSO veya boş",\n  "propModel": "pervane modeli",\n  "propTSN": "pervane TSN veya boş",\n  "propTSO": "pervane TSO veya boş"\n}\nBulamazsan o alanı boş string bırak.\n\nDosya içeriği:\n${llpFile.content}`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      setForm(prev => ({
        ...prev,
        ...(parsed.tsh       && !prev.tsh       ? {tsh:       parsed.tsh}       : {}),
        ...(parsed.cycles    && !prev.cycles    ? {cycles:    parsed.cycles}    : {}),
        ...(parsed.eng1model && !prev.eng1model ? {eng1model: parsed.eng1model} : {}),
        ...(parsed.eng1tsn   && !prev.eng1tsn   ? {eng1tsn:   parsed.eng1tsn}   : {}),
        ...(parsed.eng1tso   && !prev.eng1tso   ? {eng1tso:   parsed.eng1tso}   : {}),
        ...(parsed.eng2model && !prev.eng2model ? {eng2model: parsed.eng2model} : {}),
        ...(parsed.eng2tsn   && !prev.eng2tsn   ? {eng2tsn:   parsed.eng2tsn}   : {}),
        ...(parsed.eng2tso   && !prev.eng2tso   ? {eng2tso:   parsed.eng2tso}   : {}),
        ...(parsed.propModel && !prev.propModel ? {propModel: parsed.propModel} : {}),
        ...(parsed.propTSN   && !prev.propTSN   ? {propTSN:   parsed.propTSN}   : {}),
        ...(parsed.propTSO   && !prev.propTSO   ? {propTSO:   parsed.propTSO}   : {}),
      }));
    } catch(e) { console.error(e); }
    setLlpFilling(false);
  };
  const openNew  = () => { setForm({...EMPTY_AC,id:genId()}); setEditing(null); setShowForm(true); };
  const openEdit = ac  => { setForm({...ac}); setEditing(ac.id); setShowForm(true); };
  const save = async () => {
    const updated = editing ? fleet.map(a=>a.id===editing?form:a) : [...fleet,form];
    setFleet(updated);
    try { localStorage.setItem("camo_fleet", JSON.stringify(updated)); } catch(e) {}
    setSaved(true); setTimeout(()=>setSaved(false),2000); setShowForm(false);
  };
  const remove = async id => {
    const updated = fleet.filter(a=>a.id!==id);
    setFleet(updated); if(selectedAcId===id) setSelectedAcId(null);
    try { localStorage.setItem("camo_fleet", JSON.stringify(updated)); } catch(e) {}
  };
  const f = k => v => setForm(p=>({...p,[k]:v}));

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <div style={{padding:"16px 24px",borderBottom:"1px solid rgba(56,189,248,0.2)",background:"linear-gradient(90deg,rgba(56,189,248,0.08),transparent)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:"16px",fontWeight:"700",color:"#38bdf8",fontFamily:"'Space Grotesk',sans-serif"}}>✈ Filo Yönetimi</div>
          <div style={{fontSize:"11px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em"}}>FLEET MANAGEMENT · {fleet.length} UÇAK</div>
        </div>
        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={openNew} style={{padding:"8px 16px",borderRadius:"8px",border:"1px solid rgba(56,189,248,0.4)",background:"rgba(56,189,248,0.1)",color:"#38bdf8",fontSize:"12px",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600",cursor:"pointer"}}>+ Uçak Ekle</button>
          <button onClick={()=>setShowDrive(p=>!p)} style={{padding:"8px 14px",borderRadius:"8px",border:`1px solid ${driveFiles.length?"rgba(16,185,129,0.4)":"rgba(255,255,255,0.1)"}`,background:driveFiles.length?"rgba(16,185,129,0.08)":"rgba(255,255,255,0.03)",color:driveFiles.length?"#10b981":"#9ca3af",fontSize:"12px",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600",cursor:"pointer"}}>
            {driveFiles.length?`📂 Drive (${driveFiles.length})`:"📂 Drive Klasörü"}
          </button>
        </div>
      </div>

      {/* Drive Klasör Paneli */}
      {showDrive && (
        <div style={{margin:"0 24px",padding:"14px",background:"rgba(16,185,129,0.05)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:"10px",flexShrink:0}}>
          <div style={{fontSize:"10px",color:"#10b981",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em",marginBottom:"10px"}}>GOOGLE DRIVE KLASÖR ENTEGRASYONU</div>
          <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
            <input value={folderInput} onChange={e=>setFolderInput(e.target.value)} placeholder="Klasör ID yapıştırın (Drive URL'deki /folders/XXXXX kısmı)" style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"8px",padding:"8px 12px",color:"#e5e7eb",fontSize:"12px",fontFamily:"'DM Sans',sans-serif",outline:"none"}}
              onKeyDown={e=>e.key==="Enter"&&scanFolder()} />
            <button onClick={()=>scanFolder()} disabled={scanning||!folderInput.trim()} style={{padding:"8px 16px",borderRadius:"8px",border:"1px solid rgba(16,185,129,0.4)",background:"rgba(16,185,129,0.1)",color:"#10b981",fontSize:"12px",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600",cursor:"pointer",whiteSpace:"nowrap"}}>
              {scanning?"⟳ Taranıyor...":"🔍 Tara"}
            </button>
          </div>
          {scanError && <div style={{fontSize:"11px",color:"#f87171",fontFamily:"'DM Sans',sans-serif",marginBottom:"8px",padding:"8px",background:"rgba(239,68,68,0.08)",borderRadius:"6px"}}>⚠ {scanError}</div>}
          {driveFiles.length>0 && (
            <>
              <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",marginBottom:"6px"}}>{driveFiles.length} DOSYA BULUNDU — Bir uçak ve araç seçerek atayın</div>
              <div style={{maxHeight:"200px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"4px"}}>
                {driveFiles.map(file=>(
                  <div key={file.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",background:"rgba(255,255,255,0.03)",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <span style={{fontSize:"14px",flexShrink:0}}>{iconFor(file.mimeType)}</span>
                    <span style={{flex:1,fontSize:"11px",color:"#e5e7eb",fontFamily:"'DM Sans',sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{file.name}</span>
                    <select defaultValue="" onChange={async e=>{
                      const [acId,toolId]=e.target.value.split("|");
                      if(acId&&toolId){ e.target.disabled=true; await assignFile(file,acId,toolId); e.target.disabled=false; e.target.value=""; }
                    }} style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"6px",padding:"3px 6px",color:"#9ca3af",fontSize:"10px",fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",maxWidth:"160px"}}>
                      <option value="">Uçak → Araç seç...</option>
                      {fleet.map(ac=>(
                        <optgroup key={ac.id} label={ac.registration||"Adsız"}>
                          {TOOLS.filter(t=>t.id!=="fleet").map(t=>(
                            <option key={t.id} value={`${ac.id}|${t.id}`}>{t.label}{ac.files?.[t.id]?" ✓":""}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}


      <div style={{flex:1,overflowY:"auto",padding:"16px 24px"}}>
        {showForm && (
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(56,189,248,0.25)",borderRadius:"12px",padding:"20px",marginBottom:"20px",animation:"fadeIn 0.2s ease"}}>
            <div style={{fontSize:"13px",fontWeight:"600",color:"#38bdf8",fontFamily:"'Space Grotesk',sans-serif",marginBottom:"16px"}}>{editing?"✏️ Düzenle":"➕ Yeni Uçak"}</div>
            
            <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em",marginBottom:"10px"}}>TEMEL BİLGİLER</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"12px",marginBottom:"16px"}}>
              <Field label="REGISTRATION / KUYRUK NO" value={form.registration} onChange={f("registration")} placeholder="TC-ABC" half />
              <Field label="TİP & MODEL" value={form.type} onChange={f("type")} placeholder="C172, PA-28, B737..." half />
              <Field label="MSN / SERİ NO" value={form.msn} onChange={f("msn")} placeholder="12345" half />
              <Field label="TOPLAM UÇUŞ SAATİ" value={form.tsh} onChange={f("tsh")} placeholder="1250.5" half />
              <Field label="TOPLAM SİKLUS" value={form.cycles} onChange={f("cycles")} placeholder="980" half />
            </div>

            <div style={{fontSize:"9px",color:"#f59e0b",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em",marginBottom:"10px"}}>MOTOR #1</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"12px",marginBottom:"16px"}}>
              <Field label="MODEL" value={form.eng1model} onChange={f("eng1model")} placeholder="Lycoming O-360" half />
              <Field label="TSN (saat)" value={form.eng1tsn} onChange={f("eng1tsn")} placeholder="1250" half />
              <Field label="TSO (saat)" value={form.eng1tso} onChange={f("eng1tso")} placeholder="450" half />
            </div>

            <div style={{fontSize:"9px",color:"#f59e0b",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em",marginBottom:"10px"}}>MOTOR #2 (varsa)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"12px",marginBottom:"16px"}}>
              <Field label="MODEL" value={form.eng2model} onChange={f("eng2model")} placeholder="—" half />
              <Field label="TSN" value={form.eng2tsn} onChange={f("eng2tsn")} placeholder="" half />
              <Field label="TSO" value={form.eng2tso} onChange={f("eng2tso")} placeholder="" half />
            </div>

            <div style={{fontSize:"9px",color:"#a78bfa",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em",marginBottom:"10px"}}>PERVANE / PROPELLER</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"12px",marginBottom:"20px"}}>
              <Field label="MODEL" value={form.propModel} onChange={f("propModel")} placeholder="Hartzell HC-C2YK" half />
              <Field label="TSN" value={form.propTSN} onChange={f("propTSN")} placeholder="1250" half />
              <Field label="TSO" value={form.propTSO} onChange={f("propTSO")} placeholder="200" half />
            </div>

            <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center"}}>
              <button onClick={save} style={{padding:"10px 20px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#38bdf8,#0ea5e9)",color:"#fff",fontSize:"13px",fontWeight:"600",fontFamily:"'Space Grotesk',sans-serif",cursor:"pointer"}}>{saved?"✓ Kaydedildi!":"💾 Kaydet"}</button>
              <button onClick={()=>setShowForm(false)} style={{padding:"10px 20px",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"#9ca3af",fontSize:"13px",fontFamily:"'Space Grotesk',sans-serif",cursor:"pointer"}}>İptal</button>
              {(() => { const ac = fleet.find(a=>a.id===(editing||form.id)); return ac?.files?.llp ? (
                <button onClick={fillFromLLP} disabled={llpFilling} style={{padding:"10px 20px",borderRadius:"8px",border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.1)",color:"#a78bfa",fontSize:"13px",fontWeight:"600",fontFamily:"'Space Grotesk',sans-serif",cursor:"pointer",display:"flex",alignItems:"center",gap:"8px"}}>
                  {llpFilling ? "⟳ Okunuyor..." : "🔩 LLP'den Doldur"}
                </button>
              ) : null; })()}
            </div>
          </div>
        )}

        {fleet.length===0&&!showForm ? (
          <div style={{textAlign:"center",padding:"60px 20px",opacity:0.4}}>
            <div style={{fontSize:"48px",marginBottom:"12px"}}>✈</div>
            <div style={{fontSize:"13px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>Henüz uçak eklenmedi.<br/>Yukarıdaki "+ Uçak Ekle" butonuna tıklayın.</div>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {fleet.map(ac=>(
              <div key={ac.id} onClick={()=>setSelectedAcId(ac.id===selectedAcId?null:ac.id)} style={{background:selectedAcId===ac.id?"rgba(56,189,248,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${selectedAcId===ac.id?"rgba(56,189,248,0.4)":"rgba(255,255,255,0.07)"}`,borderRadius:"12px",padding:"14px 18px",cursor:"pointer",transition:"all 0.2s",boxShadow:selectedAcId===ac.id?"0 0 20px rgba(56,189,248,0.1)":"none"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                    <div style={{width:"40px",height:"40px",borderRadius:"10px",background:selectedAcId===ac.id?"rgba(56,189,248,0.2)":"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px"}}>✈</div>
                    <div>
                      <div style={{fontSize:"16px",fontWeight:"700",color:selectedAcId===ac.id?"#38bdf8":"#f9fafb",fontFamily:"'Space Grotesk',sans-serif"}}>{ac.registration||"—"}</div>
                      <div style={{fontSize:"11px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{ac.type||"Bilinmiyor"} · MSN: {ac.msn||"—"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                    {selectedAcId===ac.id&&<div style={{padding:"3px 8px",borderRadius:"20px",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",fontSize:"9px",color:"#10b981",fontFamily:"'IBM Plex Mono',monospace"}}>● AKTİF</div>}
                    <button onClick={e=>{e.stopPropagation();openEdit(ac);}} style={{width:"28px",height:"28px",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.08)",background:"transparent",color:"#9ca3af",fontSize:"12px",cursor:"pointer"}}>✏</button>
                    <button onClick={e=>{e.stopPropagation();remove(ac.id);}} style={{width:"28px",height:"28px",borderRadius:"6px",border:"1px solid rgba(239,68,68,0.2)",background:"transparent",color:"#ef4444",fontSize:"12px",cursor:"pointer"}}>✕</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:"20px",marginTop:"12px",paddingTop:"12px",borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                  {[{l:"UÇUŞ SAATİ",v:ac.tsh?ac.tsh+" saat":"—"},{l:"SİKLUS",v:ac.cycles||"—"},{l:"MOTOR TSO",v:ac.eng1tso?ac.eng1tso+" s":"—"},{l:"PERVANE TSO",v:ac.propTSO?ac.propTSO+" s":"—"}].map(s=>(
                    <div key={s.l}>
                      <div style={{fontSize:"8px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em"}}>{s.l}</div>
                      <div style={{fontSize:"13px",color:"#e5e7eb",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600"}}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message ──────────────────────────────────────────────────────────────────
function Message({ msg }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:msg.role==="user"?"flex-end":"flex-start",marginBottom:"16px"}}>
      <div style={{fontSize:"10px",color:"#6b7280",marginBottom:"4px",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.05em",paddingLeft:msg.role==="user"?0:"8px",paddingRight:msg.role==="user"?"8px":0}}>{msg.role==="user"?"SİZ":"CAMO AI"}</div>
      <div style={{maxWidth:"85%",padding:"12px 16px",borderRadius:msg.role==="user"?"16px 4px 16px 16px":"4px 16px 16px 16px",background:msg.role==="user"?"linear-gradient(135deg,#1e3a5f,#1e40af)":"rgba(255,255,255,0.05)",border:msg.role==="user"?"1px solid rgba(59,130,246,0.4)":"1px solid rgba(255,255,255,0.08)",color:msg.role==="user"?"#e0f2fe":"#d1d5db",fontSize:"14px",lineHeight:"1.7",fontFamily:"'DM Sans',sans-serif",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{msg.content}</div>
    </div>
  );
}

// ─── AI Tool Panel ────────────────────────────────────────────────────────────
function ToolPanel({ tool, fleet, setFleet, selectedAcId, setActiveTool }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [dragging, setDragging] = useState(false);
  const bottomRef  = useRef(null);
  const fileRef    = useRef(null);
  const aircraft   = fleet.find(a=>a.id===selectedAcId)||null;
  const activeFile = aircraft?.files?.[tool.id] || null;

  const setActiveFile = async (file) => {
    if (!aircraft) return;
    const updated = fleet.map(a => a.id===aircraft.id
      ? {...a, files: {...(a.files||{}), [tool.id]: file }}
      : a);
    setFleet(updated);
    try { localStorage.setItem("camo_fleet", JSON.stringify(updated)); } catch(e) {}
  };

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  const readFile = (file) => {
    const isExcel = /\.(xlsx|xls|ods)$/i.test(file.name);
    if (isExcel) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
          let content = `Excel Dosyası: ${file.name}\nSayfa Sayısı: ${wb.SheetNames.length}\n\n`;
          wb.SheetNames.forEach(sheetName => {
            const ws = wb.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
            if (csv.trim()) content += `=== SAYFA: ${sheetName} ===\n${csv}\n\n`;
          });
          setActiveFile({ name: file.name, content: content.slice(0, 12000) });
        } catch(err) {
          setActiveFile({ name: file.name, content: `[Excel okuma hatası: ${err.message}]` });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => setActiveFile({ name: file.name, content: e.target.result.slice(0, 8000) });
      reader.readAsText(file, "UTF-8");
    }
  };

  const onDrop = e => { e.preventDefault(); setDragging(false); const f=e.dataTransfer.files[0]; if(f) readFile(f); };

  const sendMessage = async () => {
    if (!input.trim()||loading) return;
    const userMsg = {role:"user",content:input.trim()};
    setMessages(prev=>[...prev,userMsg]); setInput(""); setLoading(true);
    try {
      const history = [...messages,userMsg].map(m=>({role:m.role,content:m.content}));
      const res = await fetch("/api/claude",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:buildSystemPrompt(tool.id,aircraft,activeFile), messages:history })
      });
      const data = await res.json();
      setMessages(prev=>[...prev,{role:"assistant",content:data.content?.map(b=>b.text||"").join("")||"Yanıt alınamadı."}]);
    } catch { setMessages(prev=>[...prev,{role:"assistant",content:"⚠️ Bağlantı hatası. Lütfen tekrar deneyin."}]); }
    setLoading(false);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}>
      {/* Header */}
      <div style={{padding:"14px 24px",borderBottom:`1px solid ${tool.color}33`,background:`linear-gradient(90deg,${tool.color}11,transparent)`,display:"flex",alignItems:"center",gap:"12px",flexShrink:0}}>
        <span style={{fontSize:"22px"}}>{tool.icon}</span>
        <div>
          <div style={{fontSize:"16px",fontWeight:"700",color:tool.color,fontFamily:"'Space Grotesk',sans-serif"}}>{tool.label}</div>
          <div style={{fontSize:"11px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em"}}>AI-POWERED · {tool.labelEn.toUpperCase()}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.xlsx,.xls,.ods" style={{display:"none"}} onChange={e=>{ if(e.target.files[0]) readFile(e.target.files[0]); e.target.value=""; }} />
          {activeFile ? (
            <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 10px",borderRadius:"20px",background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)"}}>
              <span style={{fontSize:"11px"}}>{/xlsx|xls|ods/i.test(activeFile.name)?"📊":"📄"}</span>
              <span style={{fontSize:"10px",color:"#10b981",fontFamily:"'DM Sans',sans-serif",maxWidth:"100px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeFile.name}</span>
              <button onClick={()=>setActiveFile(null)} style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:"11px",lineHeight:1}}>✕</button>
            </div>
          ) : (
            <button onClick={()=>fileRef.current?.click()} style={{padding:"5px 12px",borderRadius:"20px",border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"#9ca3af",fontSize:"10px",fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer"}}>📎 Dosya Yükle</button>
          )}
          {/* Aircraft badge */}
          {aircraft ? (
            <div style={{padding:"6px 12px",borderRadius:"20px",background:"rgba(56,189,248,0.1)",border:"1px solid rgba(56,189,248,0.3)",display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#38bdf8",boxShadow:"0 0 6px #38bdf8"}}/>
              <span style={{fontSize:"12px",color:"#38bdf8",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600"}}>{aircraft.registration}</span>
              <span style={{fontSize:"10px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{aircraft.type}</span>
            </div>
          ) : (
            <div onClick={()=>setActiveTool("fleet")} style={{padding:"6px 12px",borderRadius:"20px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",fontSize:"10px",color:"#ef4444",fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",whiteSpace:"nowrap"}}>⚠ Uçak seç →</div>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {dragging && (
        <div style={{position:"absolute",inset:0,background:"rgba(56,189,248,0.1)",border:"2px dashed #38bdf8",borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50}}>
          <div style={{fontSize:"16px",color:"#38bdf8",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600"}}>📄 Dosyayı bırakın</div>
        </div>
      )}

      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 24px",scrollbarWidth:"thin",scrollbarColor:"#374151 transparent",position:"relative"}}>
        {messages.length===0 && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:"16px",opacity:0.4}}>
            <div style={{fontSize:"48px"}}>{tool.icon}</div>
            <div style={{fontSize:"13px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",textAlign:"center",lineHeight:"1.9",maxWidth:"360px"}}>
              {aircraft
                ? `${aircraft.registration} için ${tool.label} asistanı hazır.\n\n📊 Excel, CSV, TXT dosyası yükleyebilirsiniz.\n📎 "Dosya Yükle" butonunu kullanın\nveya dosyayı bu alana sürükleyin.`
                : `Önce sol taraftan ✈ Filo panelini açın\nve bir uçak seçin.`}
            </div>
          </div>
        )}
        {messages.map((msg,i)=><Message key={i} msg={msg}/>)}
        {loading && (
          <div style={{display:"flex",alignItems:"center",gap:"12px",paddingLeft:"8px"}}>
            <div style={{display:"flex",gap:"4px"}}>{[0,1,2].map(i=><div key={i} style={{width:"6px",height:"6px",borderRadius:"50%",background:tool.color,animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}</div>
            <span style={{fontSize:"11px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>ANALİZ EDİLİYOR...</span>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{padding:"14px 24px",borderTop:"1px solid rgba(255,255,255,0.06)",flexShrink:0,background:"rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",gap:"10px",alignItems:"flex-end"}}>
          <textarea
            value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();} }}
            placeholder={PLACEHOLDERS[tool.id]} rows={2} disabled={loading}
            style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",padding:"12px 16px",color:"#e5e7eb",fontSize:"14px",fontFamily:"'DM Sans',sans-serif",resize:"none",outline:"none",minHeight:"48px",maxHeight:"120px",lineHeight:"1.5"}}
          />
          <button onClick={sendMessage} disabled={loading||!input.trim()} style={{width:"48px",height:"48px",borderRadius:"12px",border:"none",background:loading||!input.trim()?"rgba(255,255,255,0.05)":`linear-gradient(135deg,${tool.color},${tool.color}cc)`,color:loading||!input.trim()?"#6b7280":"#fff",fontSize:"20px",cursor:loading||!input.trim()?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
            {loading?"⟳":"↑"}
          </button>
        </div>
        <div style={{fontSize:"10px",color:"#4b5563",fontFamily:"'IBM Plex Mono',monospace",marginTop:"6px"}}>ENTER → GÖNDER · SHIFT+ENTER → YENİ SATIR · TXT/CSV DOSYASI SÜRÜKLEYEBİLİRSİNİZ</div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTool, setActiveTool]     = useState("fleet");
  const [fleet, setFleet]               = useState([]);
  const [selectedAcId, setSelectedAcId] = useState(null);
  const [loaded, setLoaded]             = useState(false);

  useEffect(()=>{
    (async()=>{
      try { const v=localStorage.getItem("camo_fleet"); if(v) setFleet(JSON.parse(v)); } catch {}
      setLoaded(true);
    })();
  },[]);

  const active     = TOOLS.find(t=>t.id===activeTool);
  const selectedAc = fleet.find(a=>a.id===selectedAcId);

  if (!loaded) return (
    <div style={{width:"100%",height:"100vh",background:"#080b14",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"#38bdf8",fontFamily:"'IBM Plex Mono',monospace",fontSize:"12px",letterSpacing:"0.1em"}}>CAMO.AI YÜKLENİYOR...</div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#374151;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        textarea:focus{border-color:rgba(255,255,255,.25)!important}
        input[type=text]:focus,input:not([type=file]):focus{border-color:rgba(56,189,248,.4)!important}
        input::placeholder,textarea::placeholder{color:#4b5563}
      `}</style>

      <div style={{width:"100%",height:"100vh",background:"#080b14",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative",fontFamily:"'DM Sans',sans-serif"}}>
        <div style={{position:"absolute",inset:0,background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.03) 2px,rgba(0,0,0,.03) 4px)",pointerEvents:"none",zIndex:0}}/>

        {/* Top bar */}
        <div style={{display:"flex",alignItems:"center",padding:"0 24px",height:"56px",borderBottom:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.5)",backdropFilter:"blur(20px)",flexShrink:0,position:"relative",zIndex:10}}>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <div style={{width:"32px",height:"32px",background:"linear-gradient(135deg,#f59e0b,#ef4444)",borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",boxShadow:"0 0 16px rgba(245,158,11,.4)"}}>✈</div>
            <div>
              <div style={{fontSize:"14px",fontWeight:"700",color:"#f9fafb",fontFamily:"'Space Grotesk',sans-serif",letterSpacing:"0.04em"}}>CAMO<span style={{color:"#f59e0b"}}>.AI</span></div>
              <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em"}}>AIRWORTHINESS MANAGEMENT SUITE</div>
            </div>
          </div>

          <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",gap:"24px"}}>
            {[
              {l:"FİLO",v:fleet.length+" UÇAK",c:"#10b981"},
              {l:"AKTİF UÇAK",v:selectedAc?.registration||"—",c:selectedAc?"#38bdf8":"#6b7280"},
              {l:"DOKÜMANLAR",v:selectedAc?Object.keys(selectedAc.files||{}).length+" dosya":"—",c:selectedAc&&Object.keys(selectedAc.files||{}).length>0?"#10b981":"#6b7280"},
            ].map(s=>(
              <div key={s.l} style={{textAlign:"center"}}>
                <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.08em"}}>{s.l}</div>
                <div style={{fontSize:"10px",color:s.c,fontFamily:"'IBM Plex Mono',monospace",fontWeight:"500"}}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{marginLeft:"auto"}}>
            <div style={{padding:"4px 10px",background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",borderRadius:"20px",fontSize:"10px",color:"#10b981",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em"}}>● AI ONLINE</div>
          </div>
        </div>

        <div style={{display:"flex",flex:1,overflow:"hidden",position:"relative",zIndex:1}}>
          {/* Sidebar */}
          <div style={{width:"72px",borderRight:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.3)",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:"8px",flexShrink:0}}>
            {TOOLS.map(tool=>(
              <button key={tool.id} onClick={()=>setActiveTool(tool.id)} title={tool.label} style={{width:"48px",height:"48px",borderRadius:"12px",border:activeTool===tool.id?`1px solid ${tool.color}66`:"1px solid transparent",background:activeTool===tool.id?`${tool.color}18`:"transparent",fontSize:"20px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",transition:"all 0.2s",boxShadow:activeTool===tool.id?`0 0 16px ${tool.color}30`:"none"}}>
                {tool.icon}
                {activeTool===tool.id&&<div style={{position:"absolute",left:"-1px",top:"50%",transform:"translateY(-50%)",width:"3px",height:"24px",borderRadius:"0 2px 2px 0",background:tool.color,boxShadow:`0 0 8px ${tool.color}`}}/>}
                {tool.id==="fleet"&&fleet.length>0&&<div style={{position:"absolute",top:"4px",right:"4px",width:"14px",height:"14px",borderRadius:"50%",background:"#38bdf8",fontSize:"8px",color:"#000",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"700",fontFamily:"'IBM Plex Mono',monospace"}}>{fleet.length}</div>}
              </button>
            ))}
          </div>

          {/* Main panel */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",animation:"fadeIn 0.25s ease",position:"relative"}} key={activeTool}>
            {activeTool==="fleet"
              ? <FleetPanel fleet={fleet} setFleet={setFleet} selectedAcId={selectedAcId} setSelectedAcId={setSelectedAcId}/>
              : <ToolPanel tool={active} fleet={fleet} setFleet={setFleet} selectedAcId={selectedAcId} setActiveTool={setActiveTool}/>
            }
          </div>

          {/* Right info panel */}
          <div style={{width:"196px",borderLeft:"1px solid rgba(255,255,255,.06)",background:"rgba(0,0,0,.2)",padding:"16px 12px",flexShrink:0,overflowY:"auto"}}>
            <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.1em",marginBottom:"12px"}}>ARAÇLAR / TOOLS</div>
            {TOOLS.map(tool=>(
              <div key={tool.id} onClick={()=>setActiveTool(tool.id)} style={{padding:"10px",borderRadius:"8px",marginBottom:"4px",background:activeTool===tool.id?`${tool.color}15`:"transparent",border:`1px solid ${activeTool===tool.id?tool.color+"44":"transparent"}`,cursor:"pointer",transition:"all 0.2s"}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontSize:"14px"}}>{tool.icon}</span>
                  <div>
                    <div style={{fontSize:"11px",fontWeight:"600",color:activeTool===tool.id?tool.color:"#9ca3af",fontFamily:"'Space Grotesk',sans-serif"}}>{tool.label}</div>
                    <div style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{tool.labelEn}</div>
                  </div>
                  {/* Show dot if this tool has a file for selected aircraft */}
                  {selectedAc?.files?.[tool.id] && <div style={{width:"6px",height:"6px",borderRadius:"50%",background:tool.color,marginLeft:"auto",boxShadow:`0 0 4px ${tool.color}`}}/>}
                </div>
              </div>
            ))}

            {selectedAc && (
              <div style={{marginTop:"16px",padding:"10px",background:"rgba(56,189,248,.06)",border:"1px solid rgba(56,189,248,.2)",borderRadius:"8px"}}>
                <div style={{fontSize:"9px",color:"#38bdf8",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em",marginBottom:"6px"}}>AKTİF UÇAK</div>
                <div style={{fontSize:"15px",color:"#38bdf8",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"700"}}>{selectedAc.registration}</div>
                <div style={{fontSize:"10px",color:"#9ca3af",fontFamily:"'IBM Plex Mono',monospace",marginBottom:"8px"}}>{selectedAc.type}</div>
                {[{k:"SAAT",v:selectedAc.tsh?selectedAc.tsh+" s":"—"},{k:"SİKLUS",v:selectedAc.cycles||"—"},{k:"ENG TSO",v:selectedAc.eng1tso?selectedAc.eng1tso+" s":"—"}].map(r=>(
                  <div key={r.k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                    <span style={{fontSize:"9px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace"}}>{r.k}</span>
                    <span style={{fontSize:"10px",color:"#e5e7eb",fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600"}}>{r.v}</span>
                  </div>
                ))}
              </div>
            )}

            {selectedAc && Object.keys(selectedAc.files||{}).length > 0 && (
              <div style={{marginTop:"12px",padding:"10px",background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.2)",borderRadius:"8px"}}>
                <div style={{fontSize:"9px",color:"#10b981",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em",marginBottom:"6px"}}>YÜKLÜ DOKÜMANLAR</div>
                {TOOLS.filter(t=>t.id!=="fleet"&&selectedAc.files?.[t.id]).map(t=>(
                  <div key={t.id} style={{display:"flex",alignItems:"center",gap:"6px",padding:"3px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                    <span style={{fontSize:"10px"}}>{t.icon}</span>
                    <span style={{fontSize:"9px",color:"#9ca3af",fontFamily:"'DM Sans',sans-serif",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selectedAc.files[t.id].name}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{marginTop:"12px",padding:"10px",background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.15)",borderRadius:"8px"}}>
              <div style={{fontSize:"9px",color:"#f59e0b",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.06em",marginBottom:"6px"}}>REGULATORY</div>
              {["EASA Part-M","Part-145","Part-66","CS-25","ICAO Ann.6"].map(r=>(
                <div key={r} style={{fontSize:"10px",color:"#6b7280",fontFamily:"'IBM Plex Mono',monospace",padding:"2px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>· {r}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
