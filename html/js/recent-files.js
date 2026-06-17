// ============================================================
// recent-files.js — Historial de proyectos recientes
// Usa localStorage para persistir hasta _RF_MAX entradas.
// Depende de: state.js, persistence.js, tabs.js
// ============================================================

import { state } from './state.js';
import { _applyProjectData } from './persistence.js';
import { tabNew, tabMarkFileLoaded } from './tabs.js';
import { closeAppMenu } from './app-menu.js';
import { statusSpan } from './dom-refs.js';

const _RF_KEY = 'aTambor_recentFiles';
const _RF_MAX = 10;

function _rfGet() {
    try { return JSON.parse(localStorage.getItem(_RF_KEY) || '[]'); }
    catch { return []; }
}

function _rfSave(list) {
    try { localStorage.setItem(_RF_KEY, JSON.stringify(list)); }
    catch { /* cuota de localStorage superada — descartar silenciosamente */ }
}

/**
 * Añade o actualiza una entrada en el historial.
 * @param {string} name    — nombre del proyecto (sin extensión)
 * @param {Object} content — objeto de proyecto serializable
 */
export function recentFilesAdd(name, content) {
    const list = _rfGet().filter(e => e.name !== name);
    list.unshift({ name, ts: Date.now(), content });
    if (list.length > _RF_MAX) list.length = _RF_MAX;
    _rfSave(list);
}

/** Muestra u oculta la lista inline dentro del menú principal. */
export function toggleRecentInMenu() {
    const panel = document.getElementById('recentInMenuList');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) _rfRender();
}

function _rfRender() {
    const panel = document.getElementById('recentInMenuList');
    if (!panel) return;
    const list = _rfGet();

    if (!list.length) {
        panel.innerHTML = '<div class="rf-empty">Sin archivos recientes</div>';
        return;
    }

    panel.innerHTML =
        list.map((e, i) =>
            `<div class="rf-item" onclick="recentFilesLoad(${i})">
                <span class="rf-name" title="${e.name}">${e.name}</span>
                <span class="rf-age">${_rfAge(e.ts)}</span>
            </div>`
        ).join('') +
        `<div class="rf-clear" onclick="recentFilesClear()">🗑 Borrar historial</div>`;
}

function _rfAge(ts) {
    const d   = Date.now() - ts;
    const min = Math.floor(d / 60000);
    const hr  = Math.floor(d / 3600000);
    const day = Math.floor(d / 86400000);
    if (min < 1)   return 'ahora';
    if (min < 60)  return `hace ${min} min`;
    if (hr  < 24)  return `hace ${hr} h`;
    if (day < 30)  return `hace ${day} día${day !== 1 ? 's' : ''}`;
    return new Date(ts).toLocaleDateString('es-ES');
}

/**
 * Carga el proyecto nº idx del historial.
 * Abre en nueva tab si el tab activo ya tiene contenido.
 */
export function recentFilesLoad(idx) {
    const list  = _rfGet();
    const entry = list[idx];
    if (!entry || !entry.content) return;

    closeAppMenu();

    const hasCont = Object.keys(state.gridData.cells).length > 0 || state.rawEvents.length > 0;
    if (hasCont) tabNew();

    _applyProjectData(entry.content);
    tabMarkFileLoaded(entry.name);
    statusSpan.innerText = `"${entry.name}" cargado desde historial.`;

    // Refrescar timestamp en la lista
    list.splice(idx, 1);
    list.unshift({ ...entry, ts: Date.now() });
    _rfSave(list);
}

/** Borra todo el historial. */
export function recentFilesClear() {
    localStorage.removeItem(_RF_KEY);
    const panel = document.getElementById('recentInMenuList');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
}
