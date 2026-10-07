// Läuft im <head>, damit beim Laden kein falsches Farbschema aufblitzt.
(function () {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');
  // Browserleiste (Handy) in der gewählten Farbe – nicht nur nach der Systemeinstellung
  var FARBE = { light: '#f6f4ef', dark: '#121210' };
  window.mediThemaFarbe = function (thema) {
    if (!FARBE[thema]) return;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', FARBE[thema]);
  };
  try {
    var saved = localStorage.getItem('medi-theme');
    if (saved === 'light' || saved === 'dark') {
      root.setAttribute('data-theme', saved);
      window.mediThemaFarbe(saved);
    }
  } catch (e) {
    // Speicher gesperrt (z. B. privater Modus): Systemeinstellung gilt.
  }
})();
