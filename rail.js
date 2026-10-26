// Layout A's rail (home-layouts-mock 0fcbaa4). A file of its own, not inline, so tools/build_css.mjs, which reads
// index.html for class names, never sees its words: an inline "resize" put Tailwind's .resize into kit.css.
// The section in view is marked in the rail's list: the last one whose heading has passed a line a quarter of the
// way down, or the last one once the page can scroll no further. An entry picked in the list stays marked until the
// reader scrolls by hand, because the short sections at the end can never bring their heading up to that line, and
// the one after a short section reaches it first. Without JavaScript the list still jumps to each section.
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll(".rail-nav a"));
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
  var picked = -1;
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
    addEventListener(t, function () { picked = -1; }, { passive: true });
  });
  links.forEach(function (a, i) { a.addEventListener("click", function () { picked = i; mark(i); }); });
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();
