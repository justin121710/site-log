// Gemini 客戶端。這一層只負責發請求，「要不要送」的把關在 UI（送出前預覽）那邊做。
//
// 重要：本檔所有 prompt 都禁止模型自行補充工程見解或規範條號。
// 使用者是新人，最沒有能力分辨模型在唬爛，所以模型的工作只有「整理他說過的話」。

import { getSetting } from './db.js';
import { taxonomyForPrompt } from './taxonomy.js';
import { GLOSSARY_HINT } from './glossary.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_MODEL = 'gemini-3.7-flash';

// 這份清單只是「還沒連線過」時的預設值。Google 換模型的速度比這個 App 改版快得多，
// 所以設定頁有一顆「抓取可用模型」會直接問你的 key 實際拿得到哪些，以那份為準。
export const FALLBACK_MODELS = [
  { id: 'gemini-3.7-flash', label: '推薦' },
  { id: 'gemini-3.6-flash', label: '同價位' },
  { id: 'gemini-3.5-flash-lite', label: '最便宜' },
];

/** 這些是嵌入、語音合成、影像生成之類的，拿來整理文字沒有意義，不要塞進選單。 */
const NOT_FOR_TEXT = /embedding|aqa|tts|live|image|imagen|veo|omni/i;

/**
 * 問 Google 這把 key 現在實際可以用哪些模型。
 * 這是模型清單過期時的正解——不用等我改程式。
 */
export async function listModels(key) {
  const res = await fetch(`${ENDPOINT}?pageSize=200`, {
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* 非 JSON 回應 */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: m.displayName || '' }))
    .filter((m) => !NOT_FOR_TEXT.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
}

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
    // 先看 Google 到底說了什麼，再看 HTTP 狀態碼。反過來的話，「預付額度歸零」
    // 會被 429 那條吃掉，變成叫人「等一下再試」——等到天荒地老也不會好。
    const hint = keyHint(detail);
    if (hint) throw new Error(hint);
    if (res.status === 400 && /API key/i.test(detail)) throw new Error('API key 無效，請到設定頁重貼');
    if (res.status === 401) throw new Error('這把 key 被拒絕了，請到設定頁按「測試連線」看詳細訊息');
    if (res.status === 429) throw new Error('超過用量限制（免費層額度很緊），等一下再試');
    if (res.status === 404) {
      throw new Error(`模型 ${m} 用不了（可能已經退役）。請到設定頁按「抓取可用模型」重新選一個`);
    }
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

/**
 * 分兩段測，因為「key 有問題」跟「模型退役了」是完全不同的事，
 * 混在一起測會讓人以為 key 壞掉，其實只是要換模型。
 * @returns {{ keyOk: boolean, modelOk: boolean, models: number, error?: string, hint?: string }}
 */
export async function testKey(key, modelId) {
  // 第一段：只驗 key，跟模型無關
  try {
    const models = await listModels(key);
    var modelCount = models.length;
  } catch (e) {
    return { keyOk: false, modelOk: false, models: 0, error: e.message, hint: keyHint(e.message) };
  }

  // 第二段：這個模型現在還能不能用
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '回覆「ok」兩個字。' }] }] }),
  });
  if (res.ok) return { keyOk: true, modelOk: true, models: modelCount };

  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* 非 JSON 回應 */ }
  return {
    keyOk: true,
    modelOk: false,
    models: modelCount,
    error: detail || `HTTP ${res.status}`,
    hint: `key 沒問題（可用 ${modelCount} 個模型），是「${modelId}」這個模型用不了。按「抓取可用模型」換一個。`,
  };
}

/** 把 Google 的英文錯誤翻成「所以我到底該做什麼」。 */
export function keyHint(msg) {
  if (/API key not valid/i.test(msg)) {
    return 'key 本身不對——可能複製時漏字或多了空白。回 Google AI Studio 重新複製一次。';
  }
  if (/OAuth 2 access token|ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(msg)) {
    return 'Google 把這串當成 OAuth token 而不是 API key。AQ. 開頭的新格式金鑰目前有部分帳號會踩到這個問題，'
      + '不是這個 App 的錯。解法是到 Google Cloud Console 的「API 和服務 → 憑證」另外建一把 AIza 開頭的金鑰'
      + '（記得先啟用 Generative Language API）。';
  }
  if (/PERMISSION_DENIED|SERVICE_DISABLED/i.test(msg)) {
    return '這把 key 所屬的專案還沒啟用 Generative Language API，去 Google Cloud Console 開啟它。';
  }
  if (/prepayment credits are depleted|prepay/i.test(msg)) {
    return '這個專案的預付額度歸零了。Google 的規則是餘額一到 0，'
      + '該帳單帳戶底下所有專案的 key 會同時停止運作，而且「不會」自動退回免費層。'
      + '兩條路：到 AI Studio 的 Billing 頁按 Buy credits 加值（最低 10 美元），'
      + '或把這個專案的帳單停用，同一把 key 就退回免費層（但免費層的內容 Google 可能人工審閱）。'
      + '不想處理的話，設定最上面把 AI 關掉就好，記錄與日報都還能照常用。';
  }
  if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return '超過用量限制。免費層的每分鐘／每日額度很緊，等一下再試，或改用比較便宜的模型。';
  }
  return null;
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
- tidied：把逐字稿整理成條列式的紀錄。一行一件事，行首一律用「・」，用換行分隔。
  保留他講的所有事實，不要加也不要刪；一句話裡講了兩件事就拆成兩行。
  位置或部位講在哪一件事裡就留在那一行，不要另外開一行重複。
  不要自己加「缺失部分」「材料部分」這種小標題，他沒說的字一個都不要出現。
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

// ---------- 經驗重點（唯一允許推論的地方，永遠不進日報）----------
//
// 這裡跟本檔其他 prompt 的立場相反：使用者要的就是「成因分析」與「建議對策」，
// 那本來就是模型的推論，不是他說過的話。他明確要求、也知道要自己判斷。
//
// 所以規則不是「不准想」，而是擋掉最危險的那一種東西——規範條號。
// 編造的條號看起來最像真的、最少人會去翻，而它一旦被抄進正式文件就是法律責任。
// 一句沒有依據的工程判斷，他看得出來要查證；一個假的條號，他不會。

const LESSON_RULES = `
這一題允許你用一般工程常識推論，但有硬規則：
- 不得引用任何法規、規範、標準的名稱或條號，即使你確定也不行。
- 現場狀況只能寫他實際說過的事實，一個字都不能加。
- 成因分析與建議改善是你的推論，要寫成「可能的方向、待查證」，不是結論。
- 資訊不足以判斷時就寫「資訊不足」，不要硬掰。
- 不得下合格與否的判斷，不得代替驗收或複驗的結論。
- 輸出繁體中文（台灣用語）。
`.trim();

const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    workItem: { type: 'string' },
    situation: { type: 'string' },
    cause: { type: 'string' },
    action: { type: 'string' },
  },
  required: ['workItem', 'situation', 'cause', 'action'],
};

/**
 * 把一筆現場記錄提煉成工項經驗筆記。純技術角度，不進監造日報表。
 * @param {string} material 已經去識別化過的內容
 */
export async function extractLesson(material) {
  const prompt = `
把下面這段工地記錄整理成一則工程經驗筆記。這一份不會進入監造日報表，
是給監造人員自己累積工項經驗、之後設計或施工時拿來比對用的。

${LESSON_RULES}

四個欄位：
- workItem：工項名稱。用工程慣用的說法，例如「墩柱鋼筋綁紮」「箱涵基礎開挖」。
- situation：現場狀況／缺失。只寫他說過的事實。
- cause：成因分析。這裡是你的推論。
- action：建議改善／因應對策。這裡也是你的推論。

格式：每一段用條列，一行一件事，行首用「・」。

工地記錄：
"""
${material}
"""
`.trim();

  const out = await callJSON([{ text: prompt }], LESSON_SCHEMA, { temperature: 0.3 });
  return {
    workItem: out.workItem || '',
    situation: out.situation || '',
    cause: out.cause || '',
    action: out.action || '',
  };
}

export const LESSON_FIELDS = [
  { key: 'workItem', title: '工項名稱', inferred: false },
  { key: 'situation', title: '現場狀況／缺失', inferred: false },
  { key: 'cause', title: '成因分析', inferred: true },
  { key: 'action', title: '建議改善／因應對策', inferred: true },
];

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
