// ============================================================
// app-menu.js — Menú principal desplegable (botón 🎹 PianoRoll)
// Extraído de midiGrid.js para que otros módulos (recent-files)
// puedan importar closeAppMenu sin depender del entry point.
// ============================================================

export function toggleAppMenu() {
    const menu  = document.getElementById('appMenu');
    const arrow = document.getElementById('appMenuArrow');
    const open  = menu.style.maxHeight && menu.style.maxHeight !== '0px';
    menu.style.maxHeight  = open ? '0' : '500px';
    arrow.style.transform = open ? '' : 'rotate(180deg)';
}

export function closeAppMenu() {
    const menu  = document.getElementById('appMenu');
    const arrow = document.getElementById('appMenuArrow');
    if (menu)  menu.style.maxHeight  = '0';
    if (arrow) arrow.style.transform = '';
}

// Cerrar el menú al hacer click fuera de él
document.addEventListener('click', function (e) {
    const btn = document.getElementById('appMenuBtn');
    if (btn && !btn.contains(e.target) &&
        !document.getElementById('appMenu')?.contains(e.target)) {
        closeAppMenu();
    }
}, true);
