/*
 * store.js — Local persistence layer.
 * All data lives in the browser via localStorage. No server, no accounts.
 * This module is the single source of truth the rest of the app talks to.
 */
const Store = (() => {
  const KEY = "hospitalDashboard.v1";

  // Safe storage: real localStorage when available, else an in-memory
  // fallback. Some browsers block localStorage on file:// pages, so this
  // keeps the app working even when opened by double-clicking the file.
  const _mem = {};
  const _ls = {
    getItem(k) {
      try { return localStorage.getItem(k); } catch (e) { return k in _mem ? _mem[k] : null; }
    },
    setItem(k, v) {
      try { localStorage.setItem(k, v); } catch (e) { _mem[k] = v; }
    },
  };

  function _clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function load() {
    const raw = _ls.getItem(KEY);
    if (!raw) {
      const seeded = _clone(SEED_DATA);
      save(seeded);
      return seeded;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Corrupt store, reseeding.", e);
      const seeded = _clone(SEED_DATA);
      save(seeded);
      return seeded;
    }
  }

  function save(data) {
    _ls.setItem(KEY, JSON.stringify(data));
  }

  function reset() {
    const seeded = _clone(SEED_DATA);
    save(seeded);
    return seeded;
  }

  // Generate a short unique id.
  function newId() {
    return "e" + Date.now().toString(36) + Math.floor(Math.random() * 1000);
  }

  function upsertEmployee(data, emp) {
    const idx = data.employees.findIndex((e) => e.id === emp.id);
    if (idx >= 0) data.employees[idx] = emp;
    else data.employees.push(emp);
    save(data);
    return data;
  }

  function deleteEmployee(data, id) {
    data.employees = data.employees.filter((e) => e.id !== id);
    save(data);
    return data;
  }

  function addDepartment(data, name) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!data.departments.some((d) => d.id === id)) {
      data.departments.push({ id, name });
      save(data);
    }
    return id;
  }

  return { load, save, reset, newId, upsertEmployee, deleteEmployee, addDepartment };
})();
