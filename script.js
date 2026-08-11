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

  /* ---------- Drawer mobile (sidebar kiri) ---------- */
  var hamburger = document.getElementById('hamburger');
  var drawer = document.getElementById('drawer');
  var drawerBackdrop = document.getElementById('drawerBackdrop');

  function toggleDrawer(open) {
    if (!drawer || !hamburger) return;
    drawer.classList.toggle('open', open);
    header.classList.toggle('drawer-open', open);
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    if (drawerBackdrop) drawerBackdrop.classList.toggle('show', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', function () {
      toggleDrawer(!drawer.classList.contains('open'));
    });
  }
  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', function () { toggleDrawer(false); });
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

  /* ---------- Slider 10 Dasar Kepercayaan ---------- */
  var beliefViewport = document.getElementById('beliefViewport');
  if (beliefViewport) {
    var beliefTrack = document.getElementById('beliefTrack');
    var beliefPrev = document.getElementById('beliefPrev');
    var beliefNext = document.getElementById('beliefNext');
    var beliefDots = document.getElementById('beliefDots');
    var beliefCards = beliefTrack ? beliefTrack.children : [];
    var beliefTotal = beliefCards.length;

    var beliefPerView = 1;
    var beliefMax = 0;
    var beliefCurrent = 0;
    var beliefDotsArr = [];

    function beliefStep() {
      if (beliefTotal > 1) return beliefCards[1].offsetLeft - beliefCards[0].offsetLeft;
      return beliefCards[0].getBoundingClientRect().width;
    }

    function beliefBuildDots() {
      beliefDots.innerHTML = '';
      beliefDotsArr = [];
      for (var i = 0; i <= beliefMax; i++) {
        (function (idx) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'belief-dot';
          dot.setAttribute('aria-label', 'Kartu ke-' + (idx + 1));
          dot.addEventListener('click', function () { beliefGoTo(idx); });
          beliefDots.appendChild(dot);
          beliefDotsArr.push(dot);
        })(i);
      }
    }

    function beliefUpdate() {
      beliefDotsArr.forEach(function (dot, i) {
        dot.classList.toggle('active', i === beliefCurrent);
      });
      if (beliefPrev) beliefPrev.disabled = beliefCurrent <= 0;
      if (beliefNext) beliefNext.disabled = beliefCurrent >= beliefMax;
    }

    function beliefGoTo(i) {
      beliefCurrent = Math.max(0, Math.min(beliefMax, i));
      beliefViewport.scrollTo({ left: beliefCurrent * beliefStep(), behavior: 'smooth' });
      beliefUpdate();
    }

    function beliefMeasure() {
      var step = beliefStep();
      var perView = Math.max(1, Math.floor((beliefViewport.clientWidth + 24) / step));
      beliefMax = Math.max(0, beliefTotal - perView);
      beliefCurrent = Math.min(beliefCurrent, beliefMax);
      beliefBuildDots();
      beliefUpdate();
    }

    function beliefOnScroll() {
      beliefCurrent = Math.round(beliefViewport.scrollLeft / beliefStep());
      beliefUpdate();
    }

    if (beliefPrev) beliefPrev.addEventListener('click', function () { beliefGoTo(beliefCurrent - 1); });
    if (beliefNext) beliefNext.addEventListener('click', function () { beliefGoTo(beliefCurrent + 1); });

    var beliefScrollRaf = false;
    beliefViewport.addEventListener('scroll', function () {
      if (!beliefScrollRaf) {
        beliefScrollRaf = true;
        requestAnimationFrame(function () {
          beliefScrollRaf = false;
          beliefOnScroll();
        });
      }
    }, { passive: true });

    var beliefDragX = null;
    var beliefDragLeft = 0;
    var beliefDragging = false;
    beliefViewport.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      beliefDragX = e.pageX;
      beliefDragLeft = beliefViewport.scrollLeft;
      beliefDragging = true;
      beliefViewport.classList.add('dragging');
    });
    window.addEventListener('mousemove', function (e) {
      if (!beliefDragging) return;
      beliefViewport.scrollLeft = beliefDragLeft - (e.pageX - beliefDragX);
    });
    window.addEventListener('mouseup', function () {
      if (!beliefDragging) return;
      beliefDragging = false;
      beliefViewport.classList.remove('dragging');
      beliefOnScroll();
    });

    window.addEventListener('resize', beliefMeasure);
    window.addEventListener('load', beliefMeasure);
    beliefMeasure();
  }
})();
