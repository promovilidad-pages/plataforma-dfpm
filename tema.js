/* =============================================
   PLATAFORMA DFPM — Cambio de tema claro / oscuro
   - Se carga en el <head> para aplicar el tema antes de pintar la página.
   - La elección se guarda en este navegador (localStorage "dfpm-tema").
   - Al imprimir siempre usa el tema claro.
   No toca datos ni Supabase.
   ============================================= */
(function () {
  var CLAVE = 'dfpm-tema';
  var root = document.documentElement;

  function leer() { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } }
  function guardar(v) { try { localStorage.setItem(CLAVE, v); } catch (e) {} }
  function esOscuro() { return root.getAttribute('data-theme') === 'dark'; }

  function actualizarPantalla() {
    var oscuro = esOscuro();
    // Logo con letras claras sobre fondo oscuro
    var imgs = document.querySelectorAll('img[src*="logopmv"]');
    for (var i = 0; i < imgs.length; i++) {
      var nuevo = oscuro ? 'assets/logopmv-oscuro.webp' : 'assets/logopmv.webp';
      if (imgs[i].getAttribute('src') !== nuevo) imgs[i].setAttribute('src', nuevo);
    }
    // Botón sol / luna
    var btns = document.querySelectorAll('.btn-tema');
    for (var j = 0; j < btns.length; j++) {
      var txt = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
      btns[j].innerHTML = oscuro ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
      btns[j].title = txt;
      btns[j].setAttribute('aria-label', txt);
    }
  }

  function aplicar(tema) {
    if (tema === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    if (document.readyState !== 'loading') actualizarPantalla();
  }

  // 1) Aplicar de inmediato (evita el destello blanco al cargar)
  aplicar(leer() === 'dark' ? 'dark' : 'light');

  // 2) Cuando la página termine de cargar, ajustar logo y botón
  document.addEventListener('DOMContentLoaded', actualizarPantalla);

  // 3) Clic en el botón sol / luna (sirve también para botones creados después)
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.btn-tema') : null;
    if (!b) return;
    var nuevo = esOscuro() ? 'light' : 'dark';
    guardar(nuevo);
    aplicar(nuevo);
  });

  // 4) Si se cambia en otra pestaña (panel, reportes, gantt), aplicar aquí también
  window.addEventListener('storage', function (ev) {
    if (ev.key === CLAVE) aplicar(ev.newValue === 'dark' ? 'dark' : 'light');
  });

  // 5) Imprimir siempre en claro
  var temaAntesDeImprimir = null;
  window.addEventListener('beforeprint', function () {
    temaAntesDeImprimir = esOscuro() ? 'dark' : 'light';
    aplicar('light');
  });
  window.addEventListener('afterprint', function () {
    if (temaAntesDeImprimir) aplicar(temaAntesDeImprimir);
    temaAntesDeImprimir = null;
  });
})();
