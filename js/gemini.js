// Gemini 客戶端。這一層只負責發請求，「要不要送」的把關在 UI（送出前預覽）那邊做。
//
// 重要：本檔所有 prompt 都禁止模型自行補充工程見解或規範條號。
// 使用者是新人，最沒有能力分辨模型在唬爛，所以模型的工作只有「整理他說過的話」。

import { getSetting } from './db.js';
import { taxonomyForPrompt } from './taxonomy.js';
import { GLOSSARY_HINT } from './glossary.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const MODELS = [
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash（推薦，快又便宜）' },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro（比較會整理長內容，較貴）' },
  { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（最便宜）' },
];

const NO_INVENTION = `
嚴格規則（違反就是錯誤輸出）：
- 你只能整理使用者實際說出口的內容。
- 不得補充任何他沒說的工程知識、施工做法、判斷或建議。
- 不得引用任何法規、規範名稱或條號，即使你確定也不行。
- 沒有提到的欄位一律留空字串或空陣列，不要猜、不要填「無」以外的內容。
- 只做這些事：修正語音辨識的錯字、去掉贅字、把口語整理通順、把內容分派到指定欄位。
- 輸出繁體中文（台灣用語）。
`.trim();

async function apiKey() {
  const k = await getSetting('geminiApiKey', '');
  if (!k) throw new Error('還沒設定 Gemini API key，請到「設定」頁貼上');
  return k;
}

async function model() {
  return getSetting('geminiModel', DEFAULT_MODEL);
}

async function call(parts, { schema = null, temperature = 0.2, modelId = null } = {}) {
  const key = await apiKey();
  const m = modelId || (await model());
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
    },
  };

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('連不上 Gemini。工地訊號不好的話，可以先存著，回到有網路的地方再處理。');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || '';
    } catch { /* 回應不是 JSON，維持空字串 */ }
    if (res.status === 400 && /API key/i.test(detail)) throw new Error('API key 無效，請到設定頁重貼');
    if (res.status === 429) throw new Error('超過用量限制（免費層額度很緊），等一下再試');
    if (res.status === 404) throw new Error(`找不到模型 ${m}，請到設定頁換一個`);
    throw new Error(detail || `Gemini 回了 ${res.status}`);
  }

  const json = await res.json();
  const cand = json?.candidates?.[0];
  if (cand?.finishReason === 'SAFETY') throw new Error('內容被 Gemini 的安全機制擋下');
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini 沒有回傳內容');
  return text;
}

async function callJSON(parts, schema, opts = {}) {
  const text = await call(parts, { ...opts, schema });
  try {
    return JSON.parse(text);
  } catch {
    // responseSchema 通常保證是合法 JSON，但偶爾會包在 code fence 裡
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Gemini 回的不是合法 JSON');
  }
}

export async function testKey(key, modelId) {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '回覆「ok」兩個字。' }] }] }),
  });
  if (res.ok) return true;
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* 非 JSON 回應 */ }
  throw new Error(detail || `HTTP ${res.status}`);
}

// ---------- 逐字稿 ----------

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('讀取音訊失敗'));
    r.readAsDataURL(blob);
  });
}

/** 把一段錄音轉成逐字稿。呼叫這個等於把整段音訊上傳，UI 端必須先問過使用者。 */
export async function transcribe(blob) {
  if (blob.size > 15 * 1024 * 1024) {
    throw new Error('錄音檔太大（超過 15MB），請分段錄或改用 iOS 鍵盤聽寫');
  }
  const data = await blobToBase64(blob);
  const mime = (blob.type || 'audio/mp4').split(';')[0];

  const prompt = `
把這段錄音轉成繁體中文逐字稿。這是台灣營建工地的口述筆記，說話者是監造工程師。

${GLOSSARY_HINT}

規則：
- 逐字轉錄，不要摘要、不要改寫、不要補充任何他沒說的內容。
- 明顯的語音辨識錯字（尤其工程術語）請依上面的術語表修正。
- 聽不清楚的地方寫「[聽不清]」，不要猜。
- 只輸出逐字稿本身，不要加任何說明。
`.trim();

  return call([{ text: prompt }, { inlineData: { mimeType: mime, data } }], { temperature: 0.1 });
}

// ---------- 整理 + 欄位抽取 ----------

const ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    tidied: { type: 'string' },
    floor: { type: 'string' },
    gridline: { type: 'string' },
    area: { type: 'string' },
    categoryIds: { type: 'array', items: { type: 'string' } },
    subtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['tidied', 'floor', 'gridline', 'area', 'categoryIds', 'subtags'],
};

/**
 * 把逐字稿整理通順，並抽出樓層／軸線／區域／分類。
 * 圖片不會被送出——模型看不到照片，只看得到這段文字。
 */
export async function tidyAndExtract(transcript) {
  const prompt = `
下面是一位台灣監造工程師在工地的口述筆記逐字稿。請整理並抽出欄位。

${NO_INVENTION}

可用的分類 id（categoryIds 只能從這裡面選，最多 3 個，選不出來就給空陣列）：
${taxonomyForPrompt()}

欄位說明：
- tidied：把逐字稿整理成通順的紀錄文字。保留他講的所有事實，不要加也不要刪。
- floor：樓層，例如「B2F」「3F」「RF」。沒提到就空字串。
- gridline：軸線或編號，例如「X3-Y5」「C12柱」。沒提到就空字串。
- area：區域或部位描述，例如「東側」「電梯機房」。沒提到就空字串。
- subtags：他實際講到的具體工項關鍵詞，最多 5 個，用他自己的用語。

${GLOSSARY_HINT}

逐字稿：
"""
${transcript}
"""
`.trim();

  const out = await callJSON([{ text: prompt }], ENTRY_SCHEMA);
  return {
    tidied: out.tidied || '',
    floor: out.floor || '',
    gridline: out.gridline || '',
    area: out.area || '',
    categoryIds: Array.isArray(out.categoryIds) ? out.categoryIds.slice(0, 3) : [],
    subtags: Array.isArray(out.subtags) ? out.subtags.slice(0, 5) : [],
  };
}

// ---------- 日報 ----------

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    s1: { type: 'string' },
    s2: { type: 'string' },
    s3: { type: 'string' },
    s4: { type: 'string' },
    s5: { type: 'string' },
    freeSummary: { type: 'string' },
  },
  required: ['s1', 's2', 's3', 's4', 's5', 'freeSummary'],
};

export const REPORT_SECTIONS = [
  { key: 's1', title: '一、工程進行情況（含約定之重要施工項目及數量）' },
  { key: 's2', title: '二、監督依照設計圖說及核定施工圖說施工（含檢驗停留點及施工抽查等情形）' },
  { key: 's3', title: '三、查核材料規格及品質（含材料設備管制及檢（試）驗等抽驗情形）' },
  { key: 's4', title: '四、督導工地職業安全衛生事項' },
  { key: 's5', title: '五、其他約定監造事項（含重要事項紀錄、主辦機關指示及通知廠商辦理事項等）' },
];

/**
 * 產生公共工程監造日報表的五段內容 + 一段自由摘要。
 * @param {string} material 已經去識別化過的當日內容
 */
export async function makeReport(material) {
  const prompt = `
你要把一位台灣監造工程師當天的現場筆記，整理成「公共工程監造日報表」的五個欄位。

${NO_INVENTION}
- 這一份是正式表報，特別重要：任何他沒寫、沒說的事情都不能出現。
- 某一段在他的筆記裡找不到對應內容時，該段一律只寫「本日無」四個字。不要延伸、不要客套話。

五個欄位：
一、工程進行情況（含約定之重要施工項目及數量）
二、監督依照設計圖說及核定施工圖說施工（含檢驗停留點及施工抽查等情形）
三、查核材料規格及品質（含材料設備管制及檢（試）驗等抽驗情形）
四、督導工地職業安全衛生事項
五、其他約定監造事項（含重要事項紀錄、主辦機關指示及通知廠商辦理事項等）

另外再寫一段 freeSummary：給他自己看的「今日心得・待追蹤」，
條列他今天記下但還沒弄懂、或明確說要再確認的事情。同樣不得補充你自己的工程見解。
如果沒有這類內容就給空字串。

格式：每一段用條列，一行一件事，行首用「・」。

當天的現場筆記：
"""
${material}
"""
`.trim();

  const out = await callJSON([{ text: prompt }], REPORT_SCHEMA, { temperature: 0.15 });
  return {
    s1: out.s1 || '本日無',
    s2: out.s2 || '本日無',
    s3: out.s3 || '本日無',
    s4: out.s4 || '本日無',
    s5: out.s5 || '本日無',
    freeSummary: out.freeSummary || '',
  };
}

// ---------- 單張照片（預設關閉，必須使用者手動開啟並逐張確認）----------

export async function describeImage(blob, question) {
  const data = await blobToBase64(blob);
  const prompt = `
${NO_INVENTION}
（這一題例外：使用者主動拿一張照片來問你。你可以描述你在照片上「看到什麼」，
但不得下工程合格與否的判斷、不得引用規範條號。看不清楚就說看不清楚。）

使用者的問題：${question || '這張照片裡看到什麼？'}
`.trim();

  return call([{ text: prompt }, { inlineData: { mimeType: blob.type || 'image/jpeg', data } }],
    { temperature: 0.2 });
}
