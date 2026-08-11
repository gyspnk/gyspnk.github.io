/* ===================================================
   PORTAL DIGITAL GYS PONTIANAK
=================================================== */

(function () {
  'use strict';

  /* ---------- Redirect hash Sekolah Minggu lama ----------
     Bookmark lama seperti gyspnk.github.io/#tentang dialihkan
     ke halaman Sekolah Minggu di subfolder baru. */
  var SCHOOL_HASHES = ['home', 'tentang', 'jenjang', 'jadwal', 'galeri', 'kontak'];

  function redirectOldHash() {
    var hash = window.location.hash;
    if (!hash) return;

    var id = hash.slice(1);
    if (SCHOOL_HASHES.indexOf(id) === -1) return;
    if (document.getElementById(id)) return;

    window.location.replace('/sekolahminggu/#' + id);
  }
  redirectOldHash();

  /* ---------- Header scroll ---------- */
  var header = document.getElementById('siteHeader');

  function onScroll() {
    if (!header) return;
    if (window.scrollY > 24) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
    if (backToTop) {
      backToTop.classList.toggle('show', window.scrollY > 600);
    }
  }

  /* ---------- Drawer mobile ---------- */
  var hamburger = document.getElementById('hamburger');
  var drawer = document.getElementById('drawer');

  function toggleDrawer(open) {
    if (!drawer || !hamburger) return;
    drawer.classList.toggle('open', open);
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', function () {
      toggleDrawer(!drawer.classList.contains('open'));
    });
  }
  if (drawer) {
    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { toggleDrawer(false); });
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') toggleDrawer(false);
  });

  /* ---------- Back to top ---------- */
  var backToTop = document.getElementById('backToTop');
  if (backToTop) {
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { observer.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('visible'); });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
