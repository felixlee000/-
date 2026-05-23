// 本地背单词工具
// 第一版完全运行在浏览器本地，所有数据都保存到 localStorage。

const STORAGE_KEY = "local-vocabulary-tool:v1";
const THEME_STORAGE_KEY = "local-vocabulary-tool:theme";

const app = document.querySelector("#app");
const themeToggle = document.querySelector("#themeToggle");

const state = {
  lists: [],
  currentView: "list",
  activeListId: null,
  test: null,
  combinedSettings: {
    selectedListIds: [],
    scope: "all",
    limit: "30",
  },
  helpExpanded: true,
  draggedEntryId: null,
  noteModal: null,
  storageError: "",
};

// ---------- 主题切换 ----------

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn("读取主题设置失败：", error);
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("保存主题设置失败：", error);
  }
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;

  if (!themeToggle) return;

  const isDark = nextTheme === "dark";
  themeToggle.textContent = isDark ? "日间模式" : "夜间模式";
  themeToggle.setAttribute("aria-label", isDark ? "切换到日间模式" : "切换到夜间模式");
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  saveTheme(nextTheme);
}

function initializeTheme() {
  applyTheme(getSavedTheme() || document.documentElement.dataset.theme || "light");
  themeToggle?.addEventListener("click", toggleTheme);
}

// ---------- 基础工具函数 ----------

function createId(prefix) {
  if (window.crypto && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getValidEntries(list, scope = "all") {
  const normalizedScope = scope === true ? "favorite" : scope;

  return list.entries.filter((entry) => {
    if (!isValidWord(entry)) return false;
    if (normalizedScope === "favorite" || normalizedScope === "favorites") return entry.favorite;
    if (normalizedScope === "wrong") return entry.wrongCount > 0;
    if (normalizedScope === "due") return isDueForReview(entry);
    return true;
  });
}

function getWrongEntries(list) {
  return getValidEntries(list, "wrong");
}

function getTestScopeLabel(scope) {
  if (scope === "favorite" || scope === "favorites") return "收藏词条";
  if (scope === "wrong") return "错题本";
  if (scope === "due") return "到期复习词";
  if (scope === "smart") return "智能混合推荐";
  return "全部有效词";
}

function getEmptyTestMessage(scope) {
  if (scope === "favorite") {
    return "收藏词条里还没有可测试的内容。请先收藏，并填写单词和解释。";
  }
  if (scope === "wrong") {
    return "错题本里还没有可测试的内容。答错的完整词条会自动进入错题本。";
  }
  if (scope === "due") {
    return "当前没有到期复习词，可以选择智能混合推荐进行巩固。";
  }
  return "这个词表还没有可测试的内容。请先填写单词和解释。";
}

function getListById(listId) {
  return state.lists.find((list) => list.id === listId);
}

function isValidWord(word) {
  return Boolean(normalizeText(word?.word) && normalizeText(word?.meaning));
}

function getWordBySource(sourceListId, wordId) {
  const list = getListById(sourceListId);
  if (!list) return null;
  return list.entries.find((entry) => entry.id === wordId) || null;
}

function formatDateTime(isoValue) {
  if (!isoValue) return "未复习";
  return new Date(isoValue).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeWordForCompare(value) {
  return normalizeText(value).toLowerCase();
}

function getLevenshteinDistance(a, b) {
  const source = normalizeWordForCompare(a);
  const target = normalizeWordForCompare(b);
  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function getSimilarityHint(answer, correctWord) {
  const source = normalizeWordForCompare(answer);
  const target = normalizeWordForCompare(correctWord);
  const maxLength = Math.max(source.length, target.length);
  if (!maxLength) return "拼写相似度：0%。";

  const distance = getLevenshteinDistance(source, target);
  const similarity = Math.max(0, Math.round((1 - distance / maxLength) * 100));

  if (similarity >= 80) {
    return `拼写很接近，请检查拼写。拼写相似度：${similarity}%。`;
  }
  if (similarity >= 55) {
    return `拼写相似度：${similarity}%，方向接近，可以对照首尾字母再记一次。`;
  }
  return `拼写相似度：${similarity}%，建议重新看一遍词形。`;
}

function getReviewInterval(reviewLevel, isCorrect) {
  const minute = 60 * 1000;
  const day = 24 * 60 * minute;
  if (!isCorrect) return 10 * minute;

  const intervals = [
    10 * minute,
    1 * day,
    2 * day,
    4 * day,
    7 * day,
    15 * day,
    30 * day,
    60 * day,
    120 * day,
  ];
  const safeLevel = Math.max(0, Math.min(Number(reviewLevel) || 0, intervals.length - 1));
  return intervals[safeLevel];
}

function updateReviewSchedule(word, isCorrect) {
  const now = new Date();

  word.totalReviewCount = (Number(word.totalReviewCount) || 0) + 1;
  word.lastReviewedAt = now.toISOString();
  word.lastAnswerCorrect = isCorrect;

  if (isCorrect) {
    word.correctCount = (Number(word.correctCount) || 0) + 1;
    word.consecutiveCorrect = (Number(word.consecutiveCorrect) || 0) + 1;
    word.reviewLevel = Math.min((Number(word.reviewLevel) || 0) + 1, 8);
  } else {
    word.wrongCount = (Number(word.wrongCount) || 0) + 1;
    word.consecutiveCorrect = 0;
    word.reviewLevel = Math.max((Number(word.reviewLevel) || 0) - 2, 0);
  }

  const interval = getReviewInterval(word.reviewLevel, isCorrect);
  word.nextReviewAt = new Date(now.getTime() + interval).toISOString();
}

function getDaysBetween(referenceTime, nowTime = Date.now()) {
  const timestamp = new Date(referenceTime).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (nowTime - timestamp) / (24 * 60 * 60 * 1000));
}

function isDueForReview(word) {
  if (!isValidWord(word)) return false;
  if (!word.lastReviewedAt) return true;
  if (!word.nextReviewAt) return true;
  return new Date(word.nextReviewAt).getTime() <= Date.now();
}

function getDueWordsCount(list) {
  return list.entries.filter(isDueForReview).length;
}

function calculateReviewPriority(word) {
  if (!isValidWord(word)) return -1;

  const now = Date.now();
  let score = 0;

  if (!word.nextReviewAt) score += 60;

  if (word.nextReviewAt && new Date(word.nextReviewAt).getTime() <= now) {
    score += 100;
  }

  if (!word.lastReviewedAt) {
    score += 80;
  }

  const referenceTime = word.lastReviewedAt || word.createdAt;
  const daysPassed = getDaysBetween(referenceTime, now);
  score += word.lastReviewedAt ? daysPassed * 4 : daysPassed * 3;

  const correct = Number(word.correctCount) || 0;
  const wrong = Number(word.wrongCount) || 0;
  const total = correct + wrong;
  const wrongRate = wrong / Math.max(total, 1);

  score += wrongRate * 80;
  score += Math.min(wrong * 8, 40);

  if (word.lastAnswerCorrect === false) {
    score += 30;
  }

  score -= (Number(word.consecutiveCorrect) || 0) * 8;
  return Math.max(score, 0);
}

function getCorrectRate(word) {
  const correct = Number(word.correctCount) || 0;
  const wrong = Number(word.wrongCount) || 0;
  const total = correct + wrong;
  if (!total) return null;
  return correct / total;
}

function formatCorrectRate(word) {
  const rate = getCorrectRate(word);
  if (rate === null) return "未测试";
  return `${Math.round(rate * 100)}%`;
}

function formatReviewTime(isoString) {
  if (!isoString) return "未安排";

  const target = new Date(isoString).getTime();
  if (!Number.isFinite(target)) return "未安排";

  const diff = target - Date.now();
  if (diff <= 0) return "已到期";

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < hour) return `约 ${Math.ceil(diff / minute)} 分钟后`;
  if (diff < day) return `约 ${Math.ceil(diff / hour)} 小时后`;
  if (diff < 7 * day) return `约 ${Math.ceil(diff / day)} 天后`;

  return new Date(isoString).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- 数据读取与保存 ----------

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    state.lists = Array.isArray(parsed?.lists) ? parsed.lists.map(normalizeList) : [];
    state.storageError = "";
    saveData();
  } catch (error) {
    console.error("读取 localStorage 失败：", error);
    state.storageError = "无法读取本地存储，当前数据可能只在本次页面打开期间有效。";
    state.lists = [];
  }
}

function saveData() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lists: state.lists,
        savedAt: nowIso(),
      })
    );
    state.storageError = "";
  } catch (error) {
    console.error("保存到 localStorage 失败：", error);
    state.storageError = "保存到本地存储失败，请确认浏览器允许本地网页使用 localStorage。";
  }
}

// 归一化可以让后续扩展字段时，旧数据也能继续正常使用。
function normalizeList(list) {
  return {
    id: list.id || createId("list"),
    name: list.name || "新建词表",
    entries: Array.isArray(list.entries) ? list.entries.map(normalizeEntry) : [],
    createdAt: list.createdAt || nowIso(),
    updatedAt: list.updatedAt || nowIso(),
  };
}

function normalizeEntry(entry) {
  const correctCount = Number(entry.correctCount) || 0;
  const wrongCount = Number(entry.wrongCount) || 0;

  return {
    id: entry.id || createId("entry"),
    word: entry.word || "",
    meaning: entry.meaning || "",
    note: entry.note || "",
    favorite: Boolean(entry.favorite),
    correctCount,
    wrongCount,
    lastReviewedAt: entry.lastReviewedAt || null,
    createdAt: entry.createdAt || nowIso(),
    reviewLevel: Math.max(0, Math.min(Number(entry.reviewLevel) || 0, 8)),
    nextReviewAt: entry.nextReviewAt || null,
    consecutiveCorrect: Number(entry.consecutiveCorrect) || 0,
    lastAnswerCorrect:
      typeof entry.lastAnswerCorrect === "boolean" ? entry.lastAnswerCorrect : null,
    totalReviewCount:
      Number(entry.totalReviewCount) || correctCount + wrongCount,
  };
}

function persistAndRender() {
  saveData();
  render();
}

// ---------- 词表管理 ----------

function createList() {
  const list = normalizeList({
    id: createId("list"),
    name: "新建词表",
    entries: [],
  });

  state.lists.unshift(list);
  state.activeListId = list.id;
  state.currentView = "edit";
  saveData();
  render();
}

function renameList(listId) {
  const list = getListById(listId);
  if (!list) return;

  const nextName = prompt("请输入新的词表名称：", list.name);
  if (nextName === null) return;

  const cleanName = normalizeText(nextName);
  if (!cleanName) {
    alert("词表名称不能为空。");
    return;
  }

  list.name = cleanName;
  list.updatedAt = nowIso();
  persistAndRender();
}

function deleteList(listId) {
  const list = getListById(listId);
  if (!list) return;

  const confirmed = confirm(`确定删除词表“${list.name}”吗？这个操作不能撤销。`);
  if (!confirmed) return;

  state.lists = state.lists.filter((item) => item.id !== listId);
  state.activeListId = null;
  state.currentView = "list";
  persistAndRender();
}

function openList(listId) {
  state.activeListId = listId;
  state.currentView = "edit";
  state.test = null;
  state.noteModal = null;
  render();
}

// ---------- 词条编辑 ----------

function addEntry(listId) {
  const list = getListById(listId);
  if (!list) return;

  const entry = normalizeEntry({ id: createId("entry") });
  list.entries.push(entry);
  list.updatedAt = nowIso();
  saveData();
  render();

  // 添加后自动聚焦到新行的单词输入框，减少重复点击。
  requestAnimationFrame(() => {
    focusLastWordInput();
  });
}

function focusLastWordInput() {
  const wordInputs = app.querySelectorAll("[data-entry-word]");
  wordInputs[wordInputs.length - 1]?.focus();
}

function updateEntry(listId, entryId, field, value) {
  const list = getListById(listId);
  const entry = list?.entries.find((item) => item.id === entryId);
  if (!entry) return;

  entry[field] = value;
  list.updatedAt = nowIso();
  saveData();
}

function toggleFavorite(listId, entryId) {
  const list = getListById(listId);
  const entry = list?.entries.find((item) => item.id === entryId);
  if (!entry) return;

  entry.favorite = !entry.favorite;
  list.updatedAt = nowIso();
  persistAndRender();
}

function openNoteModal(listId, entryId) {
  const list = getListById(listId);
  const entry = list?.entries.find((item) => item.id === entryId);
  if (!entry) return;

  state.noteModal = {
    listId,
    entryId,
    draft: entry.note || "",
  };
  render();

  requestAnimationFrame(() => {
    document.querySelector("#noteDraft")?.focus();
  });
}

function closeNoteModal() {
  state.noteModal = null;
  render();
}

function updateNoteDraft(value) {
  if (!state.noteModal) return;
  state.noteModal.draft = value;
}

function saveNoteModal() {
  if (!state.noteModal) return;

  const list = getListById(state.noteModal.listId);
  const entry = list?.entries.find((item) => item.id === state.noteModal.entryId);
  if (!entry) {
    state.noteModal = null;
    render();
    return;
  }

  entry.note = state.noteModal.draft;
  list.updatedAt = nowIso();
  state.noteModal = null;
  saveData();
  render();
}

function deleteEntry(listId, entryId) {
  const list = getListById(listId);
  if (!list) return;

  const confirmed = confirm("确定删除这一条单词吗？");
  if (!confirmed) return;

  list.entries = list.entries.filter((entry) => entry.id !== entryId);
  list.updatedAt = nowIso();
  persistAndRender();
}

function handleDragStart(event, entryId) {
  if (state.currentView !== "edit") {
    event.preventDefault();
    return;
  }

  state.draggedEntryId = entryId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entryId);
  }
  event.target.closest("[data-entry-row]")?.classList.add("dragging");
}

function handleDragOver(event) {
  const row = event.target.closest("[data-entry-row]");
  if (!row || !state.draggedEntryId || row.dataset.entryId === state.draggedEntryId) return;

  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  const rect = row.getBoundingClientRect();
  const position = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  app.querySelectorAll(".drag-over-before, .drag-over-after").forEach((item) => {
    item.classList.remove("drag-over-before", "drag-over-after");
  });
  row.classList.add(position === "after" ? "drag-over-after" : "drag-over-before");
  row.dataset.dropPosition = position;
}

function handleDragLeave(event) {
  const row = event.target.closest("[data-entry-row]");
  if (!row || (event.relatedTarget && row.contains(event.relatedTarget))) return;

  row.classList.remove("drag-over-before", "drag-over-after");
  delete row.dataset.dropPosition;
}

function handleDrop(event, targetEntryId) {
  const row = event.target.closest("[data-entry-row]");
  const dropPosition = row?.dataset.dropPosition || "before";
  event.preventDefault();
  clearDragStateClasses();

  if (!state.draggedEntryId || state.draggedEntryId === targetEntryId) {
    state.draggedEntryId = null;
    return;
  }

  reorderEntries(state.draggedEntryId, targetEntryId, dropPosition);
  state.draggedEntryId = null;
}

function handleDragEnd() {
  state.draggedEntryId = null;
  clearDragStateClasses();
}

function clearDragStateClasses() {
  app.querySelectorAll(".dragging, .drag-over-before, .drag-over-after").forEach((row) => {
    row.classList.remove("dragging", "drag-over-before", "drag-over-after");
    delete row.dataset.dropPosition;
  });
}

function reorderEntries(sourceEntryId, targetEntryId, dropPosition = "before") {
  const list = getListById(state.activeListId);
  if (!list) return;

  const sourceIndex = list.entries.findIndex((entry) => entry.id === sourceEntryId);
  const targetIndex = list.entries.findIndex((entry) => entry.id === targetEntryId);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const [movedEntry] = list.entries.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = list.entries.findIndex((entry) => entry.id === targetEntryId);
  const insertIndex = dropPosition === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
  list.entries.splice(insertIndex, 0, movedEntry);
  list.updatedAt = nowIso();
  saveData();
  render();
}

// ---------- CSV 导入导出 ----------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => normalizeText(value))) rows.push(row);
  return rows;
}

function parseBoolean(value) {
  return ["1", "true", "yes", "y", "是", "收藏"].includes(normalizeText(value).toLowerCase());
}

function parseNullableBoolean(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y", "是", "对", "正确"].includes(text)) return true;
  if (["0", "false", "no", "n", "否", "错", "错误"].includes(text)) return false;
  return null;
}

function parseImportedEntries(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => normalizeText(cell)));
  if (!rows.length) return [];

  const header = rows[0].map((cell) => normalizeText(cell).toLowerCase());
  let wordIndex = header.indexOf("word");
  let meaningIndex = header.indexOf("meaning");
  let startIndex = 1;

  // 如果没有表头，则兼容“第一列单词、第二列解释”的简单 CSV。
  if (wordIndex === -1 || meaningIndex === -1) {
    wordIndex = 0;
    meaningIndex = 1;
    startIndex = 0;
  }

  const favoriteIndex = header.indexOf("favorite");
  const noteIndex = header.indexOf("note");
  const correctIndex = header.indexOf("correctcount");
  const wrongIndex = header.indexOf("wrongcount");
  const reviewedIndex = header.indexOf("lastreviewedat");
  const createdIndex = header.indexOf("createdat");
  const levelIndex = header.indexOf("reviewlevel");
  const nextReviewIndex = header.indexOf("nextreviewat");
  const consecutiveIndex = header.indexOf("consecutivecorrect");
  const lastCorrectIndex = header.indexOf("lastanswercorrect");
  const totalReviewIndex = header.indexOf("totalreviewcount");

  return rows
    .slice(startIndex)
    .map((row) => {
      const word = normalizeText(row[wordIndex]);
      const meaning = normalizeText(row[meaningIndex]);
      if (!word || !meaning) return null;

      return normalizeEntry({
        id: createId("entry"),
        word,
        meaning,
        note: noteIndex >= 0 ? row[noteIndex] || "" : "",
        favorite: favoriteIndex >= 0 ? parseBoolean(row[favoriteIndex]) : false,
        correctCount: correctIndex >= 0 ? Number(row[correctIndex]) || 0 : 0,
        wrongCount: wrongIndex >= 0 ? Number(row[wrongIndex]) || 0 : 0,
        lastReviewedAt: reviewedIndex >= 0 ? normalizeText(row[reviewedIndex]) || null : null,
        createdAt: createdIndex >= 0 ? normalizeText(row[createdIndex]) || nowIso() : nowIso(),
        reviewLevel: levelIndex >= 0 ? Number(row[levelIndex]) || 0 : 0,
        nextReviewAt: nextReviewIndex >= 0 ? normalizeText(row[nextReviewIndex]) || null : null,
        consecutiveCorrect: consecutiveIndex >= 0 ? Number(row[consecutiveIndex]) || 0 : 0,
        lastAnswerCorrect:
          lastCorrectIndex >= 0 ? parseNullableBoolean(row[lastCorrectIndex]) : null,
        totalReviewCount:
          totalReviewIndex >= 0 ? Number(row[totalReviewIndex]) || 0 : undefined,
      });
    })
    .filter(Boolean);
}

function openCsvPicker(listId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) importCsvFile(listId, file);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

function decodeCsvText(buffer) {
  const bytes = new Uint8Array(buffer);
  const bomDecoders = [
    { bom: [0xff, 0xfe], encoding: "utf-16le" },
    { bom: [0xfe, 0xff], encoding: "utf-16be" },
    { bom: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  ];

  for (const { bom, encoding } of bomDecoders) {
    if (bom.every((byte, index) => bytes[index] === byte)) {
      return new TextDecoder(encoding).decode(bytes);
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const chineseEncodings = ["gb18030", "gbk"];
    for (const encoding of chineseEncodings) {
      try {
        return new TextDecoder(encoding).decode(bytes);
      } catch {
        // Some older browsers may not ship every legacy decoder.
      }
    }
  }

  return new TextDecoder("utf-8").decode(bytes);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(file);
  });
}

function importCsvFile(listId, file) {
  const list = getListById(listId);
  if (!list) return;

  readFileAsArrayBuffer(file)
    .then((buffer) => {
      const entries = parseImportedEntries(decodeCsvText(buffer));
      if (!entries.length) {
        alert("没有找到可导入的词条。请确认 CSV 至少包含 word 和 meaning 两列。");
        return;
      }

      list.entries.push(...entries);
      list.updatedAt = nowIso();
      saveData();
      render();
      alert(`已导入 ${entries.length} 条词条。`);
    })
    .catch((error) => {
      console.error("导入 CSV 失败：", error);
      alert("导入 CSV 失败，请检查文件格式或文件编码。");
    });
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function sanitizeFileName(value) {
  return normalizeText(value).replace(/[\\/:*?"<>|]/g, "_") || "word-list";
}

function exportCsv(listId) {
  const list = getListById(listId);
  if (!list) return;

  const rows = [
    [
      "word",
      "meaning",
      "note",
      "favorite",
      "correctCount",
      "wrongCount",
      "lastReviewedAt",
      "createdAt",
      "reviewLevel",
      "nextReviewAt",
      "consecutiveCorrect",
      "lastAnswerCorrect",
      "totalReviewCount",
    ],
    ...list.entries.map((entry) => [
      entry.word,
      entry.meaning,
      entry.note || "",
      entry.favorite ? "true" : "false",
      entry.correctCount,
      entry.wrongCount,
      entry.lastReviewedAt || "",
      entry.createdAt || "",
      entry.reviewLevel || 0,
      entry.nextReviewAt || "",
      entry.consecutiveCorrect || 0,
      entry.lastAnswerCorrect === null ? "" : String(Boolean(entry.lastAnswerCorrect)),
      entry.totalReviewCount || 0,
    ]),
  ];
  const csvText = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csvText}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${sanitizeFileName(list.name)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------- 测试模式 ----------

function createTestWordRef(list, entry, extra = {}) {
  return {
    sourceListId: list.id,
    sourceListName: list.name,
    wordId: entry.id,
    ...extra,
  };
}

function getTestWordKey(ref) {
  return `${ref.sourceListId}::${ref.wordId}`;
}

function getCurrentTestRef() {
  return state.test?.words?.[state.test.index] || null;
}

function getCurrentTestList() {
  const ref = getCurrentTestRef();
  return ref ? getListById(ref.sourceListId) : null;
}

function getCurrentTestWord() {
  const ref = getCurrentTestRef();
  return ref ? getWordBySource(ref.sourceListId, ref.wordId) : null;
}

function startTest(listId, scope = "all") {
  const list = getListById(listId);
  if (!list) return;

  const normalizedScope = scope === true ? "favorite" : scope || "all";
  const entries = getValidEntries(list, normalizedScope);
  if (entries.length === 0) {
    alert(getEmptyTestMessage(normalizedScope));
    return;
  }

  state.activeListId = listId;
  state.currentView = "test";
  state.noteModal = null;
  state.test = {
    type: "single",
    listId,
    scope: normalizedScope,
    favoritesOnly: normalizedScope === "favorite",
    title: `${list.name}：背诵测试`,
    words: shuffle(entries.map((entry) => createTestWordRef(list, entry))),
    index: 0,
    correct: 0,
    wrong: 0,
    checked: false,
    feedback: "",
    feedbackType: "",
    lastAnswer: "",
    answeredMap: {},
    restartConfig: { type: "single", listId, scope: normalizedScope },
    finished: false,
  };
  render();

  requestAnimationFrame(() => {
    document.querySelector("#answerInput")?.focus();
  });
}

function getCurrentTestEntry() {
  return getCurrentTestWord();
}

function checkAnswer(event) {
  event?.preventDefault();
  if (!state.test || state.test.finished) return;

  const ref = getCurrentTestRef();
  const list = getCurrentTestList();
  const entry = getCurrentTestEntry();
  if (!ref || !list || !entry) return;

  const answerKey = getTestWordKey(ref);
  const existingAnswer = state.test.answeredMap?.[answerKey];
  if (existingAnswer) {
    applyAnswerRecord(existingAnswer);
    render();
    return;
  }

  const answer = normalizeText(document.querySelector("#answerInput")?.value);

  if (!answer) {
    state.test.feedback = "请先输入答案。";
    state.test.feedbackType = "";
    render();
    requestAnimationFrame(() => document.querySelector("#answerInput")?.focus());
    return;
  }

  const isCorrect = answer.toLowerCase() === normalizeText(entry.word).toLowerCase();
  const feedback = isCorrect
    ? "回答正确。"
    : `回答错误。正确答案是：${entry.word}。${getSimilarityHint(answer, entry.word)}`;
  const feedbackType = isCorrect ? "correct" : "wrong";

  if (isCorrect) {
    state.test.correct += 1;
  } else {
    state.test.wrong += 1;
  }

  updateReviewSchedule(entry, isCorrect);
  state.test.answeredMap[answerKey] = {
    userAnswer: answer,
    isCorrect,
    feedback,
    feedbackType,
    answeredAt: nowIso(),
  };
  state.test.checked = true;
  state.test.lastAnswer = answer;
  state.test.feedback = feedback;
  state.test.feedbackType = feedbackType;
  list.updatedAt = nowIso();
  saveData();
  render();
}

function applyAnswerRecord(record) {
  state.test.checked = true;
  state.test.lastAnswer = record.userAnswer || "";
  state.test.feedback = record.feedback || "";
  state.test.feedbackType = record.feedbackType || (record.isCorrect ? "correct" : "wrong");
}

function clearCurrentAnswerState() {
  state.test.checked = false;
  state.test.feedback = "";
  state.test.feedbackType = "";
  state.test.lastAnswer = "";
}

function syncCurrentAnswerState() {
  const ref = getCurrentTestRef();
  const record = ref ? state.test.answeredMap?.[getTestWordKey(ref)] : null;
  if (record) {
    applyAnswerRecord(record);
  } else {
    clearCurrentAnswerState();
  }
}

function getAnsweredCount() {
  return Object.keys(state.test?.answeredMap || {}).length;
}

function nextQuestion() {
  if (!state.test) return;

  const nextIndex = state.test.index + 1;
  if (nextIndex >= state.test.words.length) {
    state.test.finished = true;
  } else {
    state.test.index = nextIndex;
    state.test.finished = false;
    syncCurrentAnswerState();
  }

  render();
  requestAnimationFrame(() => {
    document.querySelector("#answerInput")?.focus();
  });
}

function previousQuestion() {
  if (!state.test || state.test.index <= 0) return;

  state.test.index -= 1;
  state.test.finished = false;
  syncCurrentAnswerState();
  render();
  requestAnimationFrame(() => {
    document.querySelector("#answerInput")?.focus();
  });
}

function restartCurrentTest() {
  if (!state.test) return;
  const restartConfig = state.test.restartConfig;
  if (restartConfig?.type === "combined") {
    startCombinedTest(restartConfig.config);
    return;
  }

  startTest(
    restartConfig?.listId || state.activeListId,
    restartConfig?.scope || state.test.scope || (state.test.favoritesOnly ? "favorite" : "all")
  );
}

function normalizeCombinedLimit(value) {
  if (value === "all") return "all";
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 30;
  return Math.floor(number);
}

function applyQuestionLimit(words, limit) {
  const normalizedLimit = normalizeCombinedLimit(limit);
  if (normalizedLimit === "all") return words;
  return words.slice(0, normalizedLimit);
}

function collectWordsFromLists(selectedListIds) {
  return selectedListIds.flatMap((listId) => {
    const list = getListById(listId);
    if (!list) return [];

    return list.entries
      .filter(isValidWord)
      .map((entry) => createTestWordRef(list, entry, {
        priorityScore: calculateReviewPriority(entry),
      }));
  });
}

function filterWordsByScope(words, scope) {
  if (scope === "smart") return words;

  return words.filter((ref) => {
    const word = getWordBySource(ref.sourceListId, ref.wordId);
    if (!word || !isValidWord(word)) return false;
    if (scope === "favorites") return word.favorite;
    if (scope === "wrong") return (Number(word.wrongCount) || 0) > 0;
    if (scope === "due") return isDueForReview(word);
    return true;
  });
}

function getSmartRecommendedWords(options = {}) {
  const selectedListIds = options.selectedListIds?.length
    ? options.selectedListIds
    : state.lists.map((list) => list.id);
  const words = collectWordsFromLists(selectedListIds)
    .filter((ref) => ref.priorityScore >= 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  return applyQuestionLimit(words, options.limit ?? 30);
}

function openCombinedTestSettings() {
  state.currentView = "combined";
  state.activeListId = null;
  state.test = null;
  state.noteModal = null;

  const existingSelection = state.combinedSettings.selectedListIds.filter((listId) =>
    getListById(listId)
  );
  state.combinedSettings = {
    selectedListIds: existingSelection.length ? existingSelection : state.lists.map((list) => list.id),
    scope: state.combinedSettings.scope || "all",
    limit: String(state.combinedSettings.limit || "30"),
  };
  render();
}

function setCombinedListSelected(listId, selected) {
  const selectedIds = new Set(state.combinedSettings.selectedListIds);
  if (selected) {
    selectedIds.add(listId);
  } else {
    selectedIds.delete(listId);
  }
  state.combinedSettings.selectedListIds = [...selectedIds].filter((id) => getListById(id));
  render();
}

function setAllCombinedLists(selected) {
  state.combinedSettings.selectedListIds = selected ? state.lists.map((list) => list.id) : [];
  render();
}

function updateCombinedScope(scope) {
  state.combinedSettings.scope = scope || "all";
  render();
}

function updateCombinedLimit(limit) {
  state.combinedSettings.limit = String(normalizeCombinedLimit(limit));
  render();
}

function startSmartReviewFromHome() {
  const selectedListIds = state.lists.map((list) => list.id);
  startCombinedTest({
    selectedListIds,
    scope: "smart",
    limit: 30,
    auto: true,
  });
}

function startCombinedTest(config) {
  const selectedListIds = (config.selectedListIds || []).filter((listId) => getListById(listId));
  if (!selectedListIds.length) {
    alert("请至少选择一个词表。");
    return;
  }

  const allWords = collectWordsFromLists(selectedListIds);
  if (!allWords.length) {
    alert("没有可测试词条，请先添加单词和解释。");
    return;
  }

  const scope = config.scope || "all";
  const dueCount = allWords.filter((ref) => {
    const word = getWordBySource(ref.sourceListId, ref.wordId);
    return word && isDueForReview(word);
  }).length;

  let selectedWords;
  if (scope === "smart") {
    selectedWords = getSmartRecommendedWords({
      selectedListIds,
      limit: config.limit ?? 30,
    });

    if (!dueCount && selectedWords.length) {
      alert("当前没有明显到期的词，已为你选择优先级最高的词进行巩固。");
    }
  } else {
    selectedWords = filterWordsByScope(allWords, scope);
    if (!selectedWords.length) {
      if (scope === "favorites") alert("所选词表没有可测试的收藏词。");
      else if (scope === "wrong") alert("所选词表没有可测试的错题词。");
      else if (scope === "due") alert("没有到期词，可选择智能混合推荐。");
      else alert("没有可测试词条，请先添加单词和解释。");
      return;
    }
    selectedWords = applyQuestionLimit(shuffle(selectedWords), config.limit ?? 30);
  }

  if (!selectedWords.length) {
    alert("没有可测试词条，请先添加单词和解释。");
    return;
  }

  const normalizedConfig = {
    selectedListIds,
    scope,
    limit: normalizeCombinedLimit(config.limit ?? 30),
    auto: Boolean(config.auto),
  };

  state.activeListId = null;
  state.currentView = "test";
  state.noteModal = null;
  state.test = {
    type: "combined",
    listId: null,
    scope,
    title: "综合测试",
    words: selectedWords,
    index: 0,
    correct: 0,
    wrong: 0,
    checked: false,
    feedback: "",
    feedbackType: "",
    lastAnswer: "",
    answeredMap: {},
    restartConfig: { type: "combined", config: normalizedConfig },
    finished: false,
  };
  render();

  requestAnimationFrame(() => {
    document.querySelector("#answerInput")?.focus();
  });
}

function toggleHelpSection() {
  state.helpExpanded = !state.helpExpanded;
  render();
}

// ---------- 视图渲染 ----------

function render() {
  if (state.currentView === "edit") {
    renderEditView();
    return;
  }

  if (state.currentView === "combined") {
    renderCombinedTestSettingsPage();
    return;
  }

  if (state.currentView === "test") {
    renderTestView();
    return;
  }

  renderListView();
}

function renderListView() {
  const totalEntries = state.lists.reduce((sum, list) => sum + list.entries.length, 0);
  const totalFavorites = state.lists.reduce(
    (sum, list) => sum + list.entries.filter((entry) => entry.favorite).length,
    0
  );

  app.innerHTML = `
    <section class="view">
      ${renderStorageWarning()}
      ${renderHelpSection()}
      ${renderCombinedTestEntry()}

      <div class="panel toolbar">
        <div>
          <h2>词表列表</h2>
          <p class="muted">创建词表，添加单词和解释，然后开始随机测试。</p>
        </div>
        <button class="button" data-action="create-list">+ 新建词表</button>
      </div>

      <div class="stats-grid" aria-label="整体统计">
        <div class="stat"><strong>${state.lists.length}</strong><span>词表</span></div>
        <div class="stat"><strong>${totalEntries}</strong><span>词条</span></div>
        <div class="stat"><strong>${totalFavorites}</strong><span>收藏</span></div>
      </div>

      ${state.lists.length ? renderListCards() : renderEmptyListState()}
    </section>
  `;
}

function renderCombinedTestEntry() {
  const totalValid = state.lists.reduce((sum, list) => sum + getValidEntries(list).length, 0);
  const totalDue = state.lists.reduce((sum, list) => sum + getDueWordsCount(list), 0);
  const hasLists = state.lists.length > 0;
  const hasValidWords = totalValid > 0;

  return `
    <section class="panel combined-entry">
      <div>
        <h2>综合测试</h2>
        <p class="muted">跨词表进行总复习。你可以手动选择词表，也可以让系统根据记忆情况自动推荐需要复习的词。</p>
        <div class="meta-row">
          <span class="badge">${state.lists.length} 个词表</span>
          <span class="badge">${totalValid} 个有效词</span>
          <span class="badge">${totalDue} 个建议复习</span>
        </div>
      </div>
      <div class="row-actions">
        <button class="button" data-action="open-combined-settings" ${hasLists ? "" : "disabled"}>手动选择词表</button>
        <button class="button ghost" data-action="smart-combined-test" ${hasValidWords ? "" : "disabled"}>智能复习推荐</button>
      </div>
      ${
        hasLists
          ? ""
          : `<p class="muted combined-hint">还没有词表，先新建词表并添加单词后就可以使用综合测试。</p>`
      }
    </section>
  `;
}

function renderCombinedTestSettingsPage() {
  const selectedIds = new Set(state.combinedSettings.selectedListIds);
  const allSelected = state.lists.length > 0 && state.lists.every((list) => selectedIds.has(list.id));
  const selectedCount = state.combinedSettings.selectedListIds.length;

  app.innerHTML = `
    <section class="view">
      ${renderStorageWarning()}

      <div class="panel view-title-row">
        <div>
          <h2>综合测试设置</h2>
          <p class="muted">选择要参与测试的词表，设置范围和本轮抽题数量。</p>
        </div>
        <div class="row-actions">
          <button class="button secondary" data-action="back-list">返回主页</button>
          <button class="button" data-action="start-combined-test" ${selectedCount ? "" : "disabled"}>开始综合测试</button>
        </div>
      </div>

      <section class="panel combined-settings">
        <div class="combined-section-header">
          <div>
            <h3>选择要参与测试的词表</h3>
            <p class="muted">已选择 ${selectedCount} / ${state.lists.length} 个词表。</p>
          </div>
          <div class="row-actions">
            <button class="button small ghost" data-action="select-all-combined" ${allSelected ? "disabled" : ""}>全选词表</button>
            <button class="button small ghost" data-action="clear-combined-selection" ${selectedCount ? "" : "disabled"}>取消全选</button>
          </div>
        </div>
        ${
          state.lists.length
            ? renderCombinedListOptions(selectedIds)
            : `<div class="empty-state"><h3>还没有词表</h3><p class="muted">请先返回主页创建词表。</p></div>`
        }
      </section>

      <section class="panel combined-options">
        <div>
          <h3>测试范围</h3>
          <div class="scope-options">
            ${renderScopeOption("all", "全部有效词")}
            ${renderScopeOption("favorites", "只测收藏词")}
            ${renderScopeOption("wrong", "只测错题词")}
            ${renderScopeOption("due", "只测到期复习词")}
            ${renderScopeOption("smart", "智能混合推荐")}
          </div>
        </div>
        <div>
          <h3>抽题数量</h3>
          <select class="limit-select" data-combined-limit>
            ${["10", "20", "30", "50", "100", "all"]
              .map(
                (value) =>
                  `<option value="${value}" ${String(state.combinedSettings.limit) === value ? "selected" : ""}>${
                    value === "all" ? "全部" : value
                  }</option>`
              )
              .join("")}
          </select>
        </div>
      </section>
    </section>
  `;
}

function renderCombinedListOptions(selectedIds) {
  return `
    <div class="combined-list-options">
      ${state.lists
        .map((list) => {
          const validCount = getValidEntries(list).length;
          const favoriteCount = getValidEntries(list, "favorite").length;
          const wrongCount = getWrongEntries(list).length;
          const dueCount = getDueWordsCount(list);

          return `
            <label class="combined-list-option">
              <input
                type="checkbox"
                data-combined-list-id="${list.id}"
                ${selectedIds.has(list.id) ? "checked" : ""}
              />
              <span>
                <strong>${escapeHtml(list.name)}</strong>
                <span class="combined-list-meta">
                  有效 ${validCount} · 收藏 ${favoriteCount} · 错题 ${wrongCount} · 到期 ${dueCount}
                </span>
              </span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderScopeOption(value, label) {
  return `
    <label class="scope-option">
      <input
        type="radio"
        name="combinedScope"
        value="${value}"
        data-combined-scope
        ${state.combinedSettings.scope === value ? "checked" : ""}
      />
      <span>${label}</span>
    </label>
  `;
}

function renderHelpSection() {
  return `
    <section class="panel help-panel" aria-labelledby="helpTitle">
      <div class="help-header">
        <div>
          <h2 id="helpTitle">使用说明</h2>
          <p class="muted">快速了解词表、练习、收藏和 CSV 导入导出。</p>
        </div>
        <button
          class="button small ghost"
          data-action="toggle-help"
          aria-expanded="${state.helpExpanded}"
          aria-controls="helpContent"
        >${state.helpExpanded ? "收起说明" : "展开说明"}</button>
      </div>

      ${
        state.helpExpanded
          ? `<div id="helpContent" class="help-content">
              <div class="help-item">
                <h3>1. 新建词表</h3>
                <p>点击“新建词表”创建一个新的单词本。每个词表可以单独重命名、编辑和练习。</p>
              </div>
              <div class="help-item">
                <h3>2. 添加词条</h3>
                <p>进入词表后，可以逐行输入“单词”和“解释”。也可以使用快捷键快速添加新词条：Windows / Linux：Ctrl + Enter；macOS：Command + Enter。</p>
              </div>
              <div class="help-item">
                <h3>3. 开始练习</h3>
                <p>点击“全部练习”后，系统会随机打乱当前词表中的有效词条。练习时页面会显示解释，你需要输入对应的单词。</p>
              </div>
              <div class="help-item">
                <h3>4. 答案判断</h3>
                <p>答案判断不区分大小写，并会自动忽略前后空格。如果拼写非常接近，系统会提示“拼写很接近，请检查拼写”，但仍然算作错误。</p>
              </div>
              <div class="help-item">
                <h3>5. 收藏词</h3>
                <p>你可以在编辑页、测试页、测试结果区收藏或取消收藏当前词。收藏词可以用于之后的专项练习。</p>
              </div>
              <div class="help-item">
                <h3>6. 错题本</h3>
                <p>答错过的词会自动进入错题本。可以点击“练习错题”只复习答错过的词。</p>
              </div>
              <div class="help-item">
                <h3>7. CSV 导入导出</h3>
                <p>可以在词表编辑页导入或导出 CSV 文件。CSV 至少需要包含两列：word 和 meaning。</p>
              </div>
            </div>`
          : ""
      }
    </section>
  `;
}

function renderListCards() {
  const cards = state.lists
    .map((list) => {
      const validCount = getValidEntries(list).length;
      const favoriteCount = list.entries.filter((entry) => entry.favorite).length;
      const wrongCount = getWrongEntries(list).length;
      const dueCount = getDueWordsCount(list);
      return `
        <article class="list-card">
          <div class="list-card-header">
            <div class="list-card-title">
              <h3>${escapeHtml(list.name)}</h3>
              <p class="muted">最近更新：${formatDateTime(list.updatedAt)}</p>
            </div>
            <span class="badge">${list.entries.length} 条</span>
          </div>
          <div class="meta-row">
            <span class="badge">${validCount} 条可测</span>
            <span class="badge">${favoriteCount} 条收藏</span>
            <span class="badge">${wrongCount} 条错题</span>
            <span class="badge">${dueCount} 条待复习</span>
          </div>
          <div class="row-actions">
            <button class="button small" data-action="open-list" data-list-id="${list.id}">打开</button>
            <button class="button small ghost" data-action="start-test" data-list-id="${list.id}">全部练习</button>
            <button class="button small ghost" data-action="start-favorite-test" data-list-id="${list.id}">只练收藏</button>
            <button class="button small ghost" data-action="start-wrong-test" data-list-id="${list.id}">练错题</button>
            <button class="button small secondary" data-action="rename-list" data-list-id="${list.id}">重命名</button>
            <button class="button small danger" data-action="delete-list" data-list-id="${list.id}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  return `<div class="list-grid">${cards}</div>`;
}

function renderEmptyListState() {
  return `
    <div class="empty-state">
      <h3>还没有词表</h3>
      <p class="muted">先新建一个词表，再把六级单词慢慢放进去。</p>
      <button class="button" data-action="create-list">+ 新建词表</button>
    </div>
  `;
}

function renderEditView() {
  const list = getListById(state.activeListId);
  if (!list) {
    state.currentView = "list";
    renderListView();
    return;
  }
  const wrongCount = getWrongEntries(list).length;

  app.innerHTML = `
    <section class="view">
      ${renderStorageWarning()}

      <div class="panel view-title-row">
        <div>
          <h2>${escapeHtml(list.name)}</h2>
          <p class="muted">${list.entries.length} 条词条，${getValidEntries(list).length} 条已填写完整，${wrongCount} 条错题。</p>
        </div>
        <div class="row-actions">
          <button class="button secondary" data-action="back-list">返回词表列表</button>
          <button class="button ghost" data-action="import-csv" data-list-id="${list.id}">导入 CSV</button>
          <button class="button ghost" data-action="export-csv" data-list-id="${list.id}">导出 CSV</button>
          <button class="button ghost" data-action="start-favorite-test" data-list-id="${list.id}">只练收藏</button>
          <button class="button ghost" data-action="start-wrong-test" data-list-id="${list.id}">练错题</button>
          <button class="button ghost" data-action="start-test" data-list-id="${list.id}">全部练习</button>
          <button class="button" data-action="add-entry" data-list-id="${list.id}">+ 添加新词条</button>
        </div>
      </div>

      ${
        list.entries.length
          ? renderEntryTable(list)
          : `<div class="empty-state">
              <h3>这个词表还是空的</h3>
              <p class="muted">添加第一条词条，填写单词和解释后就可以开始测试。</p>
              <button class="button" data-action="add-entry" data-list-id="${list.id}">+ 添加新词条</button>
            </div>`
      }
      ${renderWrongBook(list)}
    </section>
    ${renderNoteModal()}
  `;
}

function renderEntryTable(list) {
  const rows = list.entries
    .map(
      (entry, index) => `
        <tr data-entry-row data-entry-id="${entry.id}">
          <td class="drag-cell">
            <button
              class="drag-handle"
              type="button"
              draggable="true"
              title="拖动排序"
              aria-label="拖动排序"
              data-drag-handle
              data-entry-id="${entry.id}"
            >↕</button>
          </td>
          <td class="index-cell">${index + 1}</td>
          <td>
            <input
              value="${escapeHtml(entry.word)}"
              placeholder="例如：achieve"
              data-entry-word="${entry.id}"
              data-action="update-entry"
              data-list-id="${list.id}"
              data-entry-id="${entry.id}"
              data-field="word"
            />
            <span class="review-counts">正确 ${entry.correctCount} / 错误 ${entry.wrongCount}</span>
          </td>
          <td>
            <textarea
              placeholder="例如：实现；达成"
              data-action="update-entry"
              data-list-id="${list.id}"
              data-entry-id="${entry.id}"
              data-field="meaning"
            >${escapeHtml(entry.meaning)}</textarea>
            <span class="review-counts">上次复习：${formatDateTime(entry.lastReviewedAt)}</span>
          </td>
          <td class="review-cell">
            ${renderEntryReviewInfo(entry)}
          </td>
          <td class="favorite-cell">
            <button
              class="favorite-button ${entry.favorite ? "active" : ""}"
              title="${entry.favorite ? "取消收藏" : "收藏"}"
              aria-label="${entry.favorite ? "取消收藏" : "收藏"}"
              data-action="toggle-favorite"
              data-list-id="${list.id}"
              data-entry-id="${entry.id}"
            >${entry.favorite ? "★" : "☆"}</button>
          </td>
          <td class="note-cell">
            ${renderEntryNoteButton(list, entry)}
          </td>
          <td class="delete-cell">
            <button
              class="button small danger"
              data-action="delete-entry"
              data-list-id="${list.id}"
              data-entry-id="${entry.id}"
            >删除</button>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="table-wrap">
      <table class="word-table">
        <thead>
          <tr>
            <th class="drag-cell">排序</th>
            <th>序号</th>
            <th>单词</th>
            <th>解释</th>
            <th>复习信息</th>
            <th>收藏状态</th>
            <th>笔记</th>
            <th>删除</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderEntryReviewInfo(entry) {
  if (!isValidWord(entry)) {
    return `<div class="review-info"><span>填写完整后开始安排复习</span></div>`;
  }

  const due = isDueForReview(entry);
  const total = (Number(entry.correctCount) || 0) + (Number(entry.wrongCount) || 0);

  return `
    <div class="review-info">
      <span>正确率：<strong>${formatCorrectRate(entry)}</strong></span>
      <span>等级：<strong>${entry.reviewLevel || 0}</strong></span>
      <span>复习：<strong>${formatReviewTime(entry.nextReviewAt)}</strong></span>
      <span class="review-status ${due ? "due" : "scheduled"}">${due ? "建议复习" : "已安排"}</span>
      <span class="review-total">累计 ${total} 次</span>
    </div>
  `;
}

function renderWrongBook(list) {
  const wrongEntries = getWrongEntries(list).sort((a, b) => b.wrongCount - a.wrongCount);

  if (!wrongEntries.length) {
    return `
      <section class="panel wrong-book">
        <div class="view-title-row">
          <div>
            <h3>错题本</h3>
            <p class="muted">测试中答错的完整词条会自动出现在这里。</p>
          </div>
        </div>
      </section>
    `;
  }

  const items = wrongEntries
    .map(
      (entry) => `
        <li class="wrong-item">
          <div>
            <strong>${escapeHtml(entry.word)}</strong>
            <p>${escapeHtml(entry.meaning)}</p>
          </div>
          <span class="badge">错 ${entry.wrongCount} / 对 ${entry.correctCount}</span>
        </li>
      `
    )
    .join("");

  return `
    <section class="panel wrong-book">
      <div class="view-title-row">
        <div>
          <h3>错题本</h3>
          <p class="muted">${wrongEntries.length} 条错题，按错误次数保存在当前词表中。筛选模式下暂不支持拖动排序，请切换到全部词条后排序。</p>
        </div>
        <button class="button ghost" data-action="start-wrong-test" data-list-id="${list.id}">只练错题</button>
      </div>
      <ul class="wrong-list">${items}</ul>
    </section>
  `;
}

function renderTestView() {
  if (!state.test) {
    state.currentView = "list";
    renderListView();
    return;
  }

  const list = state.test.type === "single" ? getListById(state.test.listId || state.activeListId) : null;
  if (state.test.type === "single" && !list) {
    state.currentView = "list";
    renderListView();
    return;
  }

  app.innerHTML = `
    <section class="view">
      ${renderStorageWarning()}

      <div class="panel view-title-row">
        <div>
          <h2>${escapeHtml(state.test.title || `${list.name}：背诵测试`)}</h2>
          <p class="muted">测试模式：${getTestModeLabel()}</p>
        </div>
        <div class="row-actions">
          ${
            state.test.type === "combined"
              ? `<button class="button secondary" data-action="open-combined-settings">返回设置</button>`
              : `<button class="button secondary" data-action="open-list" data-list-id="${list.id}">返回编辑</button>`
          }
          <button class="button ghost" data-action="restart-test">重新开始</button>
          <button class="button ghost" data-action="back-list">返回词表列表</button>
        </div>
      </div>

      ${state.test.finished ? renderFinishedTest() : renderActiveTest()}
    </section>
    ${renderNoteModal()}
  `;
}

function renderStorageWarning() {
  if (!state.storageError) return "";
  return `<div class="storage-warning" role="alert">${escapeHtml(state.storageError)}</div>`;
}

function getTestModeLabel() {
  const scopeLabel = getTestScopeLabel(state.test.scope || (state.test.favoritesOnly ? "favorite" : "all"));
  return state.test.type === "combined" ? `综合测试 - ${scopeLabel}` : scopeLabel;
}

function renderActiveTest() {
  const ref = getCurrentTestRef();
  const list = getCurrentTestList();
  const entry = getCurrentTestEntry();
  if (!ref || !list || !entry) {
    return `<div class="empty-state"><h3>当前题目不可用</h3><p class="muted">这个词条可能已经被删除，请重新开始测试。</p></div>`;
  }

  const total = state.test.words.length;
  const current = state.test.index + 1;
  const answeredCount = getAnsweredCount();
  const progress = Math.round((answeredCount / total) * 100);
  const feedbackClass = state.test.feedbackType || "";

  return `
    <div class="test-layout">
      <div class="test-card">
        <div class="progress" aria-label="测试进度">
          <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
        <div class="test-question-row">
          <div>
            <p class="muted">第 ${current} / ${total} 题</p>
            ${
              state.test.type === "combined"
                ? `<p class="source-list-label">来源词表：${escapeHtml(ref.sourceListName || list.name)}</p>`
                : ""
            }
          </div>
          ${renderTestFavoriteButton(list, entry)}
        </div>

        <div class="prompt-box">
          <p class="label">请根据解释输入对应单词</p>
          <p class="meaning-text">${escapeHtml(entry.meaning)}</p>
        </div>

        <form data-action="check-answer">
          <input
            id="answerInput"
            class="answer-input"
            type="text"
            autocomplete="off"
            placeholder="输入单词后按 Enter"
            value="${escapeHtml(state.test.lastAnswer)}"
            ${state.test.checked ? "disabled" : ""}
          />
          <div class="test-actions">
            <button class="button secondary" type="button" data-action="previous-question" ${state.test.index > 0 ? "" : "disabled"}>
              上一个词
            </button>
            <button class="button" type="submit" ${state.test.checked ? "disabled" : ""}>检查答案</button>
            <button class="button secondary" type="button" data-action="next-question" ${state.test.checked ? "" : "disabled"}>
              ${current === total ? "查看结果" : "下一题"}
            </button>
          </div>
        </form>

        <div class="feedback ${feedbackClass}" role="status">${renderFeedbackContent(list, entry)}</div>
      </div>

      <aside class="panel">
        <h3>本轮统计</h3>
        <ul class="sidebar-list">
          <li><span>正确</span><strong>${state.test.correct}</strong></li>
          <li><span>错误</span><strong>${state.test.wrong}</strong></li>
          <li><span>已答</span><strong>${answeredCount}</strong></li>
          <li><span>剩余</span><strong>${total - answeredCount}</strong></li>
        </ul>
      </aside>
    </div>
  `;
}

function renderTestFavoriteButton(list, entry) {
  return `
    <button
      class="favorite-button test-favorite-button ${entry.favorite ? "active" : ""}"
      title="${entry.favorite ? "取消收藏" : "收藏当前词"}"
      aria-label="${entry.favorite ? "取消收藏" : "收藏当前词"}"
      data-action="toggle-favorite"
      data-list-id="${list.id}"
      data-entry-id="${entry.id}"
    >${entry.favorite ? "★" : "☆"}</button>
  `;
}

function renderFeedbackContent(list, entry) {
  const message = state.test.feedback || "提交后会在这里显示即时反馈。";
  if (!state.test.checked) return escapeHtml(message);

  return `
    <p class="feedback-message">${escapeHtml(message)}</p>
    <div class="feedback-actions">
      ${renderResultFavoriteButton(list, entry)}
      ${renderResultNoteButton(list, entry)}
    </div>
  `;
}

function renderResultFavoriteButton(list, entry) {
  return `
    <button
      class="button small result-favorite-button ${entry.favorite ? "secondary" : ""}"
      type="button"
      data-action="toggle-favorite"
      data-list-id="${list.id}"
      data-entry-id="${entry.id}"
    >${entry.favorite ? "取消收藏" : "收藏当前词"}</button>
  `;
}

function renderEntryNoteButton(list, entry) {
  const hasNote = normalizeText(entry.note);

  return `
    <button
      class="note-button ${hasNote ? "active" : ""}"
      type="button"
      title="${hasNote ? "查看或编辑笔记" : "添加笔记"}"
      aria-label="${hasNote ? "查看或编辑笔记" : "添加笔记"}"
      data-action="open-note"
      data-list-id="${list.id}"
      data-entry-id="${entry.id}"
    >笔记</button>
  `;
}

function renderResultNoteButton(list, entry) {
  const hasNote = normalizeText(entry.note);

  return `
    <button
      class="button small ghost result-note-button"
      type="button"
      data-action="open-note"
      data-list-id="${list.id}"
      data-entry-id="${entry.id}"
    >${hasNote ? "查看笔记" : "记笔记"}</button>
  `;
}

function renderNoteModal() {
  if (!state.noteModal) return "";

  const list = getListById(state.noteModal.listId);
  const entry = list?.entries.find((item) => item.id === state.noteModal.entryId);
  if (!entry) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="note-modal" role="dialog" aria-modal="true" aria-labelledby="noteModalTitle">
        <div class="note-modal-header">
          <div>
            <p class="eyebrow">Word Note</p>
            <h2 id="noteModalTitle">${escapeHtml(entry.word || "未填写单词")}</h2>
          </div>
          <button class="button small ghost" type="button" data-action="close-note">取消</button>
        </div>
        <p class="note-meaning">${escapeHtml(entry.meaning || "还没有填写解释。")}</p>
        <textarea
          id="noteDraft"
          class="note-textarea"
          placeholder="可以写记忆方法、例句、易错拼写、近义词，或者任何对你有帮助的内容。"
          data-note-draft
        >${escapeHtml(state.noteModal.draft)}</textarea>
        <div class="note-modal-actions">
          <button class="button secondary" type="button" data-action="close-note">取消</button>
          <button class="button" type="button" data-action="save-note">保存笔记</button>
        </div>
      </section>
    </div>
  `;
}

function renderFinishedTest() {
  const total = state.test.words.length;
  const accuracy = total ? Math.round((state.test.correct / total) * 100) : 0;

  return `
    <div class="test-card">
      <h2>本轮完成</h2>
      <p class="muted">${escapeHtml(state.test.title || "本轮测试")} 已经结束。</p>
      <div class="finish-score">
        <div class="score-box"><strong>${state.test.correct}</strong><span>正确</span></div>
        <div class="score-box"><strong>${state.test.wrong}</strong><span>错误</span></div>
        <div class="score-box"><strong>${total}</strong><span>总题数</span></div>
        <div class="score-box"><strong>${accuracy}%</strong><span>正确率</span></div>
      </div>
      <div class="row-actions">
        <button class="button" data-action="restart-test">再测一轮</button>
        ${
          state.test.type === "combined"
            ? `<button class="button secondary" data-action="open-combined-settings">回到综合设置</button>`
            : `<button class="button secondary" data-action="open-list" data-list-id="${state.test.listId}">回到词表</button>`
        }
      </div>
    </div>
  `;
}

// ---------- 事件委托 ----------

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const { action, listId, entryId } = target.dataset;

  if (action === "create-list") createList();
  if (action === "open-list") openList(listId);
  if (action === "rename-list") renameList(listId);
  if (action === "delete-list") deleteList(listId);
  if (action === "toggle-help") toggleHelpSection();
  if (action === "open-combined-settings") openCombinedTestSettings();
  if (action === "smart-combined-test") startSmartReviewFromHome();
  if (action === "select-all-combined") setAllCombinedLists(true);
  if (action === "clear-combined-selection") setAllCombinedLists(false);
  if (action === "start-combined-test") startCombinedTest(state.combinedSettings);
  if (action === "open-note") openNoteModal(listId, entryId);
  if (action === "close-note") closeNoteModal();
  if (action === "save-note") saveNoteModal();
  if (action === "back-list") {
    state.currentView = "list";
    state.activeListId = null;
    state.test = null;
    state.noteModal = null;
    render();
  }
  if (action === "add-entry") addEntry(listId);
  if (action === "toggle-favorite") toggleFavorite(listId, entryId);
  if (action === "delete-entry") deleteEntry(listId, entryId);
  if (action === "import-csv") openCsvPicker(listId);
  if (action === "export-csv") exportCsv(listId);
  if (action === "start-test") startTest(listId, false);
  if (action === "start-favorite-test") startTest(listId, "favorite");
  if (action === "start-wrong-test") startTest(listId, "wrong");
  if (action === "restart-test") restartCurrentTest();
  if (action === "previous-question") previousQuestion();
  if (action === "next-question") nextQuestion();
});

app.addEventListener("input", (event) => {
  const noteDraft = event.target.closest("[data-note-draft]");
  if (noteDraft) {
    updateNoteDraft(noteDraft.value);
    return;
  }

  if (event.target.id === "answerInput" && state.test && !state.test.checked) {
    state.test.lastAnswer = event.target.value;
    return;
  }

  const target = event.target.closest('[data-action="update-entry"]');
  if (!target) return;

  updateEntry(target.dataset.listId, target.dataset.entryId, target.dataset.field, target.value);
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest('[data-action="check-answer"]');
  if (!form) return;

  checkAnswer(event);
});

app.addEventListener("change", (event) => {
  const listCheckbox = event.target.closest("[data-combined-list-id]");
  if (listCheckbox) {
    setCombinedListSelected(listCheckbox.dataset.combinedListId, listCheckbox.checked);
    return;
  }

  const scopeInput = event.target.closest("[data-combined-scope]");
  if (scopeInput) {
    updateCombinedScope(scopeInput.value);
    return;
  }

  const limitInput = event.target.closest("[data-combined-limit]");
  if (limitInput) {
    updateCombinedLimit(limitInput.value);
  }
});

app.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-drag-handle]");
  if (!handle) return;

  handleDragStart(event, handle.dataset.entryId);
});

app.addEventListener("dragover", (event) => {
  handleDragOver(event);
});

app.addEventListener("dragleave", (event) => {
  handleDragLeave(event);
});

app.addEventListener("drop", (event) => {
  const row = event.target.closest("[data-entry-row]");
  if (!row) return;

  handleDrop(event, row.dataset.entryId);
});

app.addEventListener("dragend", handleDragEnd);

document.addEventListener("keydown", handleGlobalShortcut);

function handleGlobalShortcut(event) {
  if (state.noteModal) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNoteModal();
    }
    return;
  }

  const isAddShortcut = event.key === "Enter" && (event.ctrlKey || event.metaKey);
  if (!isAddShortcut || state.currentView !== "edit") return;

  const list = getListById(state.activeListId);
  if (!list) return;

  event.preventDefault();
  addEntry(list.id);
}

// ---------- 启动应用 ----------

initializeTheme();
loadData();
render();
