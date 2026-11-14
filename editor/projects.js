// One atomic browser-storage record keeps project heads and their history together.
export const PROJECTS_KEY = 'edbb_projects_v1';
export const HISTORY_LIMIT = 30;
const copy = value => JSON.parse(JSON.stringify(value));
const name = value => String(value || '').trim().slice(0, 64) || 'bot-project';
const uid = () => crypto.randomUUID();

export class ProjectLibrary {
  constructor(store = localStorage, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    this.raw = store.getItem(PROJECTS_KEY);
    this.data = this.raw ? JSON.parse(this.raw) : { version: 1, activeId: null, projects: [] };
    if (this.data.version !== 1 || !Array.isArray(this.data.projects)
      || this.data.projects.some(p => !p?.id || typeof p.state !== 'string' || !Array.isArray(p.history))
      || (this.data.projects.length && !this.data.projects.some(p => p.id === this.data.activeId))) {
      throw new Error('プロジェクト一覧の保存データを読み込めません。');
    }
  }
  get active() { return this.get(this.data.activeId); }
  list() { return copy(this.data.projects).sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id) { const p = this.data.projects.find(p => p.id === id); return p ? copy(p) : null; }
  commit(action) {
    // A stale tab must never replace changes made by another tab.
    if (this.store.getItem(PROJECTS_KEY) !== this.raw) {
      throw new Error('別のタブでプロジェクトが更新されました。現在の内容をJSONで保存してから再読み込みしてください。');
    }
    const next = copy(this.data);
    const result = action(next);
    const raw = JSON.stringify(next);
    this.store.setItem(PROJECTS_KEY, raw);
    this.data = next;
    this.raw = raw;
    return result;
  }
  checkpoint(project, label, force = false) {
    const last = project.history.at(-1);
    if (!force && last?.state === project.state && last?.title === project.title) return;
    project.history.push({ id: uid(), label, title: project.title, state: project.state, createdAt: this.now() });
    project.history = project.history.slice(-HISTORY_LIMIT);
  }
  create(title, state) {
    JSON.parse(state);
    return this.commit(data => {
      const project = { id: uid(), title: name(title), state, createdAt: this.now(), updatedAt: this.now(), history: [] };
      this.checkpoint(project, '作成時');
      data.projects.push(project);
      data.activeId = project.id;
      return project.id;
    });
  }
  save(state, title, label = '') {
    JSON.parse(state);
    const active = this.active;
    if (!active) return this.create(title, state);
    if (!label && active.state === state && active.title === name(title)) return active.id;
    return this.commit(data => {
      const project = data.projects.find(p => p.id === data.activeId);
      project.state = state;
      project.title = name(title);
      project.updatedAt = this.now();
      if (label || this.now() - (project.history.at(-1)?.createdAt || 0) >= 60000) {
        this.checkpoint(project, label || '自動保存', Boolean(label));
      }
      return project.id;
    });
  }
  activate(id) {
    if (!this.get(id)) throw new Error('プロジェクトが見つかりません。');
    this.commit(data => { data.activeId = id; });
  }
  rename(id, title) {
    this.commit(data => {
      const p = data.projects.find(p => p.id === id);
      if (!p) throw new Error('プロジェクトが見つかりません。');
      p.title = name(title); p.updatedAt = this.now();
    });
  }
  duplicate(id) {
    const project = this.get(id);
    if (!project) throw new Error('プロジェクトが見つかりません。');
    return this.create(`${project.title}（コピー）`, project.state);
  }
  remove(id) {
    this.commit(data => {
      if (data.activeId === id) throw new Error('編集中のプロジェクトは削除できません。別のプロジェクトを開いてください。');
      data.projects = data.projects.filter(p => p.id !== id);
    });
  }
  restore(historyId) {
    return this.commit(data => {
      const p = data.projects.find(p => p.id === data.activeId);
      const entry = p?.history.find(h => h.id === historyId);
      if (!entry) throw new Error('履歴が見つかりません。');
      const target = copy(entry);
      this.checkpoint(p, '履歴の復元前', true);
      p.state = target.state; p.title = target.title; p.updatedAt = this.now();
      this.checkpoint(p, '履歴から復元', true);
    });
  }
}
