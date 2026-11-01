(function () {
  "use strict";
  var frame = document.getElementById("igi-siteb-frame");
  var fallback = document.getElementById("igi-proxy-fallback");
  if (!frame) return;
  var loaded = false, observers = [], lastHeight = 0;
  var timeout = window.setTimeout(function () {
    if (!loaded && fallback) fallback.hidden = false;
  }, 30000);
  function currentPath(doc) {
    try { return doc.defaultView.location.pathname.replace(/^\/g(?=\/|$)/, "") || "/"; }
    catch (_) { return "/"; }
  }
  function measure() {
    var doc;
    try { doc = frame.contentDocument; } catch (_) { return; }
    if (!doc || !doc.documentElement) return;
    var root = doc.documentElement, body = doc.body;
    var height = Math.max(root.scrollHeight || 0,root.offsetHeight || 0,
      body ? body.scrollHeight || 0 : 0,body ? body.offsetHeight || 0 : 0,frame.clientHeight || 0);
    var route = currentPath(doc);
    if (/\/(?:play\.html|game\/|missions?\.html|download\.html)$/i.test(route)) {
      height = Math.max(height,window.visualViewport ? window.visualViewport.height : window.innerHeight);
    }
    height = Math.max(Math.ceil(height),Math.ceil(window.innerHeight || 0));
    if (Math.abs(height-lastHeight)>2) { lastHeight=height; frame.style.height=height+"px"; }
  }
  function attachObservers() {
    observers.forEach(function (observer) { try { observer.disconnect(); } catch (_) {} });
    observers=[];
    var doc,view;
    try { doc=frame.contentDocument; view=frame.contentWindow; } catch (_) { return; }
    if (!doc || !doc.documentElement) return;
    if (view && "ResizeObserver" in view) {
      var ro=new view.ResizeObserver(measure);
      ro.observe(doc.documentElement); if(doc.body) ro.observe(doc.body); observers.push(ro);
    }
    if (view && "MutationObserver" in view) {
      var mo=new view.MutationObserver(function(){window.requestAnimationFrame(measure);});
      mo.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,characterData:true}); observers.push(mo);
    }
    if (view) { view.addEventListener("resize",measure,{passive:true}); view.addEventListener("load",measure,true); }
    window.requestAnimationFrame(measure); window.setTimeout(measure,250); window.setTimeout(measure,1000);
  }
  frame.addEventListener("load",function(){
    loaded=true;window.clearTimeout(timeout);
    if(fallback)fallback.hidden=true;
    document.body.classList.remove("igi-portal-loading");
    document.body.classList.add("igi-portal-loaded");
    attachObservers();
  });
  frame.addEventListener("error",function(){if(fallback)fallback.hidden=false;});
  window.addEventListener("resize",measure,{passive:true});
  if(window.visualViewport)window.visualViewport.addEventListener("resize",measure,{passive:true});
  frame.addEventListener("pointerdown",function(){frame.focus();});
})();
