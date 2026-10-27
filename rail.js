// Layout A's rail (home-layouts-mock 0fcbaa4). A file of its own, not inline, so tools/build_css.mjs, which reads
// index.html for class names, never sees its words: an inline "resize" put Tailwind's .resize into kit.css.
// The section in view is marked in the rail's list: the last one whose heading has passed a line a quarter of the
// way down, or the last one once the page can scroll no further. An entry picked in the list stays marked until the
// reader scrolls by hand, because the short sections at the end only just reach the line the jump lands them on
// (home.css), and the one after a short section reaches the quarter line first. Where a pick lands is marked too: once
// the scroll stops, focus moves to the section's heading and the heading takes .landed, a short cue in home.css. Without
// JavaScript the list still jumps to each section, to the same line.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll(".rail-nav a"));
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
  var picked = -1, lit = null, token = 0;
  function unlight() { if (lit) lit.classList.remove("landed"); lit = null; }
  function land(h) {
    unlight();
    h.focus({ preventScroll: true });
    void h.offsetWidth;
    h.classList.add("landed");
    lit = h;
  }
  function mark(i) {
    links.forEach(function (a, j) {
      if (j === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
  }
  function update() {
    if (picked >= 0) return mark(picked);
    var line = innerHeight / 4, at = 0;
    heads.forEach(function (h, i) { if (h.getBoundingClientRect().top <= line) at = i; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) at = heads.length - 1;
    mark(at);
  }
  // A press or a key comes before the click it makes, so a pick made by pointer or by Enter still holds.
  ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (t) {
    addEventListener(t, function () { picked = -1; unlight(); }, { passive: true });
  });
  heads.forEach(function (h) { h.addEventListener("animationend", function () { if (lit === h) unlight(); }); });
  // The jump itself is the link's own. Its heading is lit when the scroll ends: on scrollend, or once the page has not
  // scrolled for 200 ms, which also covers a page that did not move and a browser with no scrollend.
  links.forEach(function (a, i) {
    a.addEventListener("click", function () {
      picked = i; mark(i);
      var t = ++token, quiet;
      function go() {
        clearTimeout(quiet); removeEventListener("scroll", wait); removeEventListener("scrollend", go);
        if (t === token) land(heads[i]);
      }
      function wait() { clearTimeout(quiet); quiet = setTimeout(go, 200); }
      addEventListener("scroll", wait, { passive: true });
      addEventListener("scrollend", go);
      wait();
    });
  });
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();
