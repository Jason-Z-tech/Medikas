// Läuft im <head>, damit beim Laden kein falsches Farbschema aufblitzt.
(function () {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');
  try {
    var saved = localStorage.getItem('medi-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {
    // Speicher gesperrt (z. B. privater Modus): Systemeinstellung gilt.
  }
})();
